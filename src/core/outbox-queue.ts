/**
 * Durable Shuttle message outbox (issue #63 v0, bounded slice).
 *
 * A Human-authored message whose *actuation time* was delegated to Shuttle. The
 * queue state lives here and nowhere else: it is NOT Run state and NOT the Work
 * Item Inbox. Delivery itself is not implemented here — every actuation goes
 * through a `SubmissionOperation` of kind `OUTBOX_MESSAGE` on the existing
 * ledger. This module only owns identity, ordering, revisions, and the
 * provenance-bound Run reservation the ledger cannot express.
 *
 * Two invariants carry the whole design:
 *
 * 1. **Revision freeze.** An item is editable only while pre-claim
 *    (`QUEUED`/`BLOCKED`). Editing advances `revision` and replaces `payload`,
 *    `payloadFingerprint` and `createdAt` together, so the `OUTBOX_MESSAGE`
 *    compiled at dispatch is byte-identical to the revision it was compiled
 *    from. Once an item is `DISPATCHING` or later the payload is frozen: there
 *    is no edit path, only explicit cancel of an unresolved item.
 *
 * 2. **Provenance-bound reservation.** `reservationRunId` and
 *    `submissionOperationId` are written in the same durable record before the
 *    provider is touched. Read back through `expectedUserTurnAccounting`, they
 *    turn a queued Human turn into an *earned* `+1` for exactly that Run epoch —
 *    never a loose count offset. An operation that never reaches a
 *    success-terminal state contributes nothing, so the baseline can never hide
 *    a later genuine Human intervention.
 */
import type { SubmissionOperation, SubmissionOperationState } from "./submission-operation";

export const OUTBOX_STORE_KEY = "noosOutboxQueue";
/** How many times one item may be re-dispatched after a proven-not-accepted attempt before it parks. */
export const OUTBOX_MAX_ATTEMPTS = 2;

export type OutboxItemState =
  /** Never claimed; eligible for dispatch once the gate opens. */
  | "QUEUED"
  /** An `OUTBOX_MESSAGE` operation is claimed for this item and owns execution. */
  | "DISPATCHING"
  /** The operation proved acceptance: the message is in the conversation. */
  | "DELIVERED"
  /** The dispatch or its acceptance is ambiguous. Head-of-line blocking. */
  | "UNCERTAIN"
  /** Proven-not-accepted and out of attempts, or otherwise not dispatchable. Parks the head. */
  | "BLOCKED"
  /** Cancelled before delivery; never actuated. */
  | "CANCELLED";

/**
 * Derived, never stored: what the queue is waiting on. `WAIT` covers "the
 * destination is not open" and "the composer is busy" alike — the UI must not
 * imply delivery happened.
 */
export type OutboxBlockReason =
  | "conversation_absent"
  | "carrier_not_ready"
  | "composer_not_empty"
  | "submission_in_flight"
  | "lease_not_held"
  | "attempt_failed";

export type OutboxQueueStatus =
  | { kind: "IDLE" }
  | { kind: "WAIT"; itemId: string; reason: OutboxBlockReason }
  | { kind: "DISPATCHING"; itemId: string }
  | { kind: "BLOCKED_UNCERTAIN"; itemId: string };

export interface OutboxItem {
  itemId: string;
  /** Target logical-thread identity: the item only ever actuates into this conversation. */
  logicalThreadId: string;
  providerConversationRef: string;
  payload: string;
  payloadFingerprint: string;
  /** Revision of `payload`; advances on every pre-claim edit. */
  revision: number;
  createdAt: number;
  updatedAt: number;
  /** Monotonic queue order (arrival sequence). */
  sequence: number;
  state: OutboxItemState;
  /** Durable reservation: present from the moment dispatch is decided. */
  submissionOperationId?: string;
  reservationRunId?: string;
  dispatchedAt?: number;
  deliveredAt?: number;
  uncertaintySince?: number;
  /** Proven-not-accepted attempts; resets the item to QUEUED until the cap. */
  attempts: number;
  /** Why the item left the head when it did (proven rejection). */
  lastOutcome?: "PROVEN_NOT_ACCEPTED";
  /**
   * The operation's own pre-submit observed user-turn count. Written with the
   * delivery so the Run accounting baseline is durable evidence, not an
   * in-memory counter that a reload would have to guess at.
   */
  baselineUserMessageCount?: number;
  /**
   * The observed user-turn count at the instant this reservation was made — the
   * baseline the Run's accounting uses *before* the delivery is proven. Written
   * with the reservation, before the provider is touched, because that is what
   * makes the reservation an expectation rather than a hindsight claim.
   */
  reservedAtUserMessageCount?: number;
}

export interface OutboxQueueState {
  revision: number;
  sequence: number;
  paused: boolean;
  items: OutboxItem[];
}

export interface EnqueueOutboxItemInput {
  itemId: string;
  logicalThreadId: string;
  providerConversationRef: string;
  payload: string;
  now: number;
}

export interface OutboxDispatchReservation {
  itemId: string;
  revision: number;
  submissionOperationId: string;
  runId?: string;
  expectedOperationKind: "OUTBOX_MESSAGE";
  /**
   * Present when the Run epoch this reservation is for has an ACTIVE run to
   * answer to. Carried on the reservation rather than looked up later so the
   * expectation is durable at the same moment the reservation is.
   */
  observedUserMessageCount?: number;
}

/**
 * One reservation per item, recorded before actuation; the caller must persist
 * the returned state before the provider is touched.
 */
export interface OutboxDispatchInput {
  operationId: string;
  reservation?: OutboxDispatchReservation;
  now: number;
}

/** What a queued reservation currently answers for, for one Run epoch. */
export interface OutboxRunAccounting {
  /** Turns this epoch's queued deliveries have *proven* they authored. */
  delivered: number;
  /**
   * True while exactly one reservation for this epoch is claimed and unresolved
   * — the state delta 3 requires the Run to treat as an expected Human turn.
   */
  reserved: boolean;
  /**
   * True when that unresolved reservation is ambiguous (its operation's outcome
   * is unknown), so the turn cannot be attributed either way. The Run must
   * neither cancel on it nor advance past it (#57 Q3).
   */
  ambiguous: boolean;
}

/** The Run-facing view of one epoch's queued turns. */
export interface OutboxRunExpectation {
  /** The user-turn count the reservation was recorded against. */
  baseline: number;
  /**
   * Baseline + proven deliveries + at most one tolerated in-flight turn. Only
   * ever raises a Run's expectation; a Run's own governed bump is never undone.
   */
  expectedUserMessageCount: number;
  /** True when the tolerated turn is a reservation whose delivery is not yet proven. */
  provisional: boolean;
  /**
   * True when that reservation is unresolved *and* ambiguous, so the turn cannot
   * be attributed to Shuttle or to a Human. Never a licence to cancel a Run.
   */
  ambiguous: boolean;
}

export interface OutboxSubmissionOutcome {
  operationId: string;
  /** Success-terminal states count as delivered; everything else is not delivery. */
  state: SubmissionOperationState;
  /** The operation's own pre-submit observed user turn count, the accounting baseline. */
  baselineUserMessageCount?: number;
  now: number;
  uncertain?: boolean;
  /** When the ambiguity was first recorded, for the degraded-state surface. */
  uncertaintySince?: number;
}

export type OutboxMutation =
  | { type: "list" }
  | { type: "enqueue"; input: EnqueueOutboxItemInput }
  | { type: "edit"; itemId: string; expectedRevision: number; payload: string; now: number }
  | { type: "cancel"; itemId: string; now: number }
  | { type: "pause"; paused: boolean; now: number }
  | { type: "claim_dispatch"; itemId: string; input: OutboxDispatchInput }
  | { type: "record_submission"; outcome: OutboxSubmissionOutcome }
  | { type: "release_attempt"; itemId: string; reason: "PROVEN_NOT_ACCEPTED"; now: number };

export interface OutboxMutationResult {
  ok: boolean;
  error?: string;
  item?: OutboxItem;
  state: OutboxQueueState;
}

const CLAIMED_STATES: ReadonlySet<OutboxItemState> = new Set<OutboxItemState>(["DISPATCHING", "DELIVERED", "UNCERTAIN"]);
const ACTIVE_STATES: ReadonlySet<OutboxItemState> = new Set<OutboxItemState>(["DISPATCHING", "UNCERTAIN"]);
const SUCCESS_TERMINAL: ReadonlySet<SubmissionOperationState> = new Set<SubmissionOperationState>(["OBSERVED_ACCEPTED", "COMPLETED"]);

export function emptyOutboxQueueState(): OutboxQueueState {
  return { revision: 0, sequence: 0, paused: false, items: [] };
}

/** `blocked` is derived from gate evidence, never from a stored state. */
export function canEditOutboxItem(item: OutboxItem): boolean {
  return item.state === "QUEUED" || item.state === "BLOCKED";
}

export function orderedOutboxItems(state: OutboxQueueState): OutboxItem[] {
  return [...state.items].sort((left, right) => left.sequence - right.sequence);
}

export function headOutboxItem(state: OutboxQueueState): OutboxItem | undefined {
  return orderedOutboxItems(state).find(item => item.state !== "CANCELLED");
}

/**
 * Head-of-line classification. An unresolved head suspends the whole queue: it
 * is never skipped and no later item may be delivered while it stands.
 */
export function outboxQueueStatus(state: OutboxQueueState): OutboxQueueStatus {
  const ordered = orderedOutboxItems(state);
  const head = ordered.find(item => item.state !== "CANCELLED");
  if (!head) return { kind: "IDLE" };
  if (head.state === "UNCERTAIN") return { kind: "BLOCKED_UNCERTAIN", itemId: head.itemId };
  if (head.state === "DISPATCHING") return { kind: "DISPATCHING", itemId: head.itemId };
  if (state.paused) return { kind: "IDLE" };
  return { kind: "WAIT", itemId: head.itemId, reason: blockReasonFor(head) };
}

/**
 * A parked head is not dispatchable at all — attempts spent, or a reservation
 * retired by policy — and the only ways forward are to rewrite it or cancel it.
 * A queued head, by contrast, is waiting on the delivery gate.
 */
function blockReasonFor(head: OutboxItem): OutboxBlockReason {
  return head.state === "BLOCKED" ? "attempt_failed" : "conversation_absent";
}

/**
 * What the queue answers for, for one Run epoch.
 *
 * This is the *only* admissible way a queued Human turn may soften a Run's
 * intervention rule, and it is deliberately two-sided:
 *
 *  - A **proven delivery** raises the floor permanently. Its baseline comes from
 *    the operation's own pre-submit evidence, and it counts only as a
 *    contiguous prefix — nothing behind an unresolved head can be counted,
 *    because the queue cannot have delivered it.
 *  - A **live reservation** tolerates exactly one more turn, and nothing else.
 *    Without this the Run is cancelled in the gap between the turn appearing in
 *    the provider and the ledger proving it: the carrier's reconcile and the
 *    background's fold take at least a probe cycle each, while the Run's watcher
 *    ticks faster than either. Reserving the turn is precisely what delta 3
 *    asks for — "durably reserve that one specific operation *is an expected
 *    Human turn*" — and the tolerance is withdrawn the moment the item leaves
 *    the reservation without proving acceptance, so nothing is *left* behind.
 *
 * `undefined` means the queue says nothing about this epoch, and the Run's own
 * rule applies unchanged.
 */
export function expectedUserTurnAccounting(
  state: OutboxQueueState,
  runId: string,
  providerConversationRef: string
): OutboxRunExpectation | undefined {
  const ordered = orderedOutboxItems(state).filter(item => item.state !== "CANCELLED");
  const mine = (item: OutboxItem) => item.reservationRunId === runId && item.providerConversationRef === providerConversationRef;
  let baseline: number | undefined;
  let delivered = 0;
  let provisional = false;
  let ambiguous = false;
  for (const item of ordered) {
    if (item.state === "DELIVERED") {
      if (mine(item)) {
        baseline ??= item.baselineUserMessageCount;
        delivered += 1;
      }
      // A delivery from another epoch still occupies the prefix, but is not ours.
      continue;
    }
    // The first unresolved (or unclaimed) item ends the prefix: nothing behind it
    // can have been delivered. A reservation that is still claimed — including
    // one whose outcome is ambiguous — is exactly the turn the Run is told to
    // expect, so it tolerates one and nothing more.
    if (mine(item) && (item.state === "DISPATCHING" || item.state === "UNCERTAIN")) {
      baseline ??= item.reservedAtUserMessageCount;
      provisional = true;
      ambiguous = item.state === "UNCERTAIN";
    }
    break;
  }
  if (baseline === undefined) return undefined;
  return {
    baseline,
    expectedUserMessageCount: baseline + delivered + (provisional ? 1 : 0),
    provisional,
    ambiguous
  };
}

/**
 * The policy for cancelling an UNRESOLVED item (issue #63 delta 7: an ambiguous
 * head may be "cancelled by authorized policy"; in this tree the authorized
 * actor is the Human).
 *
 * The queue's reducer is a pure state machine and cannot see the ledger, so the
 * background consults this before issuing the cancel. The order it prescribes is
 * load-bearing: retire the operation FIRST, then cancel the item. A crash after
 * the retire but before the cancel converges on the next probe (the fold sees a
 * CANCELLED operation and parks the item); the reverse order would leave an
 * execution-owning operation orphaned forever, blocking every later dispatch to
 * that target — the very wedge this exists to remove.
 */
export type UncertainCancelDecision =
  | { allowed: true; retireOperationId?: string }
  | { allowed: false; reason: "delivery_accepted" };

export function planUncertainCancel(item: OutboxItem, operation: SubmissionOperation | undefined): UncertainCancelDecision {
  // Other states are governed by the reducer alone; this plan is only
  // authoritative for the one state that needs the ledger's side of the story.
  if (item.state !== "UNCERTAIN") return { allowed: true };
  if (!operation) return { allowed: true };
  if (operation.state === "OBSERVED_ACCEPTED" || operation.state === "COMPLETED") {
    // The ledger has proof the turn landed. Cancelling now would claim a
    // delivery never happened; the next probe's fold converges the item to
    // DELIVERED instead. Honest refusal, not a silent no-op.
    return { allowed: false, reason: "delivery_accepted" };
  }
  if (operation.state === "UNCERTAIN" || operation.state === "DISPATCHING") {
    // Still execution-owning: it must be retired or it blocks every later
    // dispatch to this target forever. `record(CANCELLED)` is a legal
    // transition from both states.
    return { allowed: true, retireOperationId: operation.operationId };
  }
  // FAILED_SAFE/CANCELLED are terminal and not execution-owning: nothing to
  // retire, the item can simply be cancelled.
  return { allowed: true };
}

/** True when the queue still holds a reservation this Run epoch has not accounted for. */
export function hasOutstandingOutboxReservation(state: OutboxQueueState, runId: string): boolean {
  return state.items.some(item => item.reservationRunId === runId && item.state !== "DELIVERED" && item.state !== "CANCELLED");
}

/**
 * The richer view the Run's decision needs: how much is proven, and whether an
 * unresolved reservation is currently standing in for it.
 */
export function outboxRunAccounting(
  state: OutboxQueueState,
  runId: string,
  providerConversationRef: string
): OutboxRunAccounting | undefined {
  const ordered = orderedOutboxItems(state).filter(item => item.state !== "CANCELLED");
  const mine = (item: OutboxItem) => item.reservationRunId === runId && item.providerConversationRef === providerConversationRef;
  let delivered = 0;
  let reserved = false;
  let ambiguous = false;
  for (const item of ordered) {
    if (item.state === "DELIVERED") {
      if (mine(item)) delivered += 1;
      continue;
    }
    if (mine(item) && (item.state === "DISPATCHING" || item.state === "UNCERTAIN")) {
      reserved = true;
      ambiguous = item.state === "UNCERTAIN";
    }
    break;
  }
  if (delivered === 0 && !reserved) return undefined;
  return { delivered, reserved, ambiguous };
}

/**
 * Pure queue reducer. Storage, the authority lock, and the round-trip to the
 * provider all live with the caller.
 */
export function reduceOutboxQueue(state: OutboxQueueState, mutation: OutboxMutation): OutboxMutationResult {
  switch (mutation.type) {
    case "list":
      return { ok: true, state };
    case "enqueue": {
      const { input } = mutation;
      if (!isStableId(input.itemId)) return fail(state, "item_id_invalid");
      if (!isNonEmpty(input.logicalThreadId)) return fail(state, "logical_thread_id_required");
      if (!isNonEmpty(input.providerConversationRef)) return fail(state, "conversation_ref_required");
      if (!isValidPayload(input.payload)) return fail(state, "payload_invalid");
      if (state.items.some(item => item.itemId === input.itemId)) return fail(state, "item_id_reuse_conflict");
      const item: OutboxItem = {
        itemId: input.itemId,
        logicalThreadId: input.logicalThreadId,
        providerConversationRef: input.providerConversationRef,
        payload: normalizePayload(input.payload),
        payloadFingerprint: fingerprintOutboxPayload(normalizePayload(input.payload)),
        revision: 1,
        createdAt: input.now,
        updatedAt: input.now,
        sequence: state.sequence + 1,
        state: "QUEUED",
        attempts: 0
      };
      return commit(state, [item], item);
    }
    case "edit": {
      const item = findItem(state, mutation.itemId);
      if (!item) return fail(state, "item_not_found");
      if (CLAIMED_STATES.has(item.state)) return fail(state, "edit_after_claim_forbidden");
      if (item.state === "CANCELLED") return fail(state, "item_cancelled");
      if (item.revision !== mutation.expectedRevision) return fail(state, "revision_conflict");
      if (!isValidPayload(mutation.payload)) return fail(state, "payload_invalid");
      const payload = normalizePayload(mutation.payload);
      // A rewrite that changes nothing but whitespace is still a new revision:
      // the fingerprint changes, so the operation identity must too.
      const rewritten = fingerprintOutboxPayload(payload) !== item.payloadFingerprint;
      // createdAt is refreshed with the revision so a dispatch can never compile
      // the previous revision's payload under this revision's fingerprint.
      const edited: OutboxItem = {
        ...item,
        payload,
        payloadFingerprint: fingerprintOutboxPayload(payload),
        revision: item.revision + 1,
        createdAt: mutation.now,
        updatedAt: mutation.now,
        lastOutcome: undefined
      };
      // A parked item (attempts spent on bytes that never landed) becomes
      // dispatchable again under the new bytes, with a fresh attempt budget: the
      // spent attempts belonged to the old message, not to this one. Without
      // this, "edit to continue" — what the surface offers — would be a lie, and
      // the item could only ever be cancelled. The retired operations keep their
      // own ids (the revision is in the minted id), so nothing is reused.
      if (item.state === "BLOCKED" && rewritten) {
        edited.state = "QUEUED";
        edited.attempts = 0;
        edited.submissionOperationId = undefined;
        edited.dispatchedAt = undefined;
        edited.uncertaintySince = undefined;
      }
      return commit(state, [edited], edited);
    }
    case "cancel": {
      const item = findItem(state, mutation.itemId);
      if (!item) return fail(state, "item_not_found");
      if (item.state === "CANCELLED") return { ok: true, item, state };
      // DISPATCHING is genuinely in flight and DELIVERED is a proven turn:
      // neither can be abandoned honestly. UNCERTAIN is exactly the delta-7
      // escape — an ambiguous reservation the Human may retire by authorized
      // policy — and the background retires the backing operation *first*
      // (`planUncertainCancel`); this reducer only records the outcome.
      if (item.state === "DISPATCHING" || item.state === "DELIVERED") return fail(state, "cancel_requires_resolution");
      // The reservation id stays on the cancelled item as its audit trail;
      // cancelled items leave the head, the accounting, and the priority gate.
      const cancelled: OutboxItem = { ...item, state: "CANCELLED", updatedAt: mutation.now };
      return commit(state, [cancelled], cancelled);
    }
    case "pause": {
      return { ok: true, state: { ...state, paused: mutation.paused, revision: state.revision + 1 } };
    }
    case "claim_dispatch": {
      const item = findItem(state, mutation.itemId);
      if (!item) return fail(state, "item_not_found");
      if (item.state !== "QUEUED") return fail(state, `item_${item.state.toLowerCase()}`);
      if (!isStableId(mutation.input.operationId)) return fail(state, "operation_id_invalid");
      const reservation = mutation.input.reservation;
      if (reservation && (reservation.itemId !== item.itemId || reservation.revision !== item.revision)) {
        return fail(state, "reservation_revision_mismatch");
      }
      const claimed: OutboxItem = {
        ...item,
        state: "DISPATCHING",
        submissionOperationId: mutation.input.operationId,
        reservationRunId: reservation?.runId ?? item.reservationRunId,
        reservedAtUserMessageCount: reservation?.observedUserMessageCount ?? item.reservedAtUserMessageCount,
        dispatchedAt: mutation.input.now,
        updatedAt: mutation.input.now,
        uncertaintySince: undefined
      };
      return commit(state, [claimed], claimed);
    }
    case "record_submission": {
      const { outcome } = mutation;
      const item = state.items.find(candidate => candidate.submissionOperationId === outcome.operationId);
      if (!item) return fail(state, "operation_not_reserved");
      // An operation may only ever move an item forward. A stale observation of
      // PREPARED (or of a re-claim) must not undo a recorded outcome — and a
      // recorded outcome must not be undone by a later one. `UNCERTAIN` is not
      // an outcome: it is "unresolved", so a cancellation or a proof that finally
      // arrives is still allowed to resolve it.
      if (item.state !== "DISPATCHING" && item.state !== "UNCERTAIN") return { ok: true, item, state };
      if (SUCCESS_TERMINAL.has(outcome.state)) {
        const delivered: OutboxItem = {
          ...item,
          state: "DELIVERED",
          deliveredAt: outcome.now,
          updatedAt: outcome.now,
          baselineUserMessageCount: outcome.baselineUserMessageCount,
          uncertaintySince: undefined,
          lastOutcome: undefined
        };
        return commit(state, [delivered], delivered);
      }
      if (outcome.state === "UNCERTAIN") {
        const uncertain: OutboxItem = {
          ...item,
          state: "UNCERTAIN",
          uncertaintySince: outcome.uncertaintySince ?? outcome.now,
          updatedAt: outcome.now
        };
        return commit(state, [uncertain], uncertain);
      }
      if (outcome.state === "CANCELLED") {
        // The reservation is retired by policy: nothing can ever satisfy it, so
        // the item must not keep holding an expectation for a turn that will
        // never arrive. Park it — the Human can still rewrite it into a fresh
        // attempt, or cancel it outright — and withdraw the tolerance.
        const parked: OutboxItem = {
          ...item,
          state: "BLOCKED",
          submissionOperationId: undefined,
          dispatchedAt: undefined,
          uncertaintySince: undefined,
          updatedAt: outcome.now
        };
        return commit(state, [parked], parked);
      }
      // PREPARED / DISPATCHING / FAILED_SAFE prove nothing and must not fabricate
      // a delivery. FAILED_SAFE is released by an explicit `release_attempt`.
      return { ok: true, item, state };
    }
    case "release_attempt": {
      const item = findItem(state, mutation.itemId);
      if (!item) return fail(state, "item_not_found");
      if (item.state !== "DISPATCHING") return fail(state, `item_${item.state.toLowerCase()}`);
      if (item.attempts + 1 >= OUTBOX_MAX_ATTEMPTS) {
        // The cap is spent: park visibly rather than retry into a loop.
        const parked: OutboxItem = { ...item, state: "BLOCKED", attempts: item.attempts + 1, updatedAt: mutation.now, lastOutcome: mutation.reason };
        return commit(state, [parked], parked);
      }
      const retried: OutboxItem = {
        ...item,
        state: "QUEUED",
        attempts: item.attempts + 1,
        submissionOperationId: undefined,
        dispatchedAt: undefined,
        uncertaintySince: undefined,
        updatedAt: mutation.now,
        lastOutcome: mutation.reason
      };
      return commit(state, [retried], retried);
    }
  }
}

function commit(state: OutboxQueueState, updates: OutboxItem[], result: OutboxItem): OutboxMutationResult {
  const byId = new Map(updates.map(item => [item.itemId, item]));
  const items = state.items.map(item => byId.get(item.itemId) ?? item);
  // An update with no existing record is an insertion; `sequence` was already
  // advanced by the mutation that created it.
  for (const update of updates) {
    if (!state.items.some(item => item.itemId === update.itemId)) items.push(update);
  }
  const next: OutboxQueueState = {
    revision: state.revision + 1,
    sequence: state.sequence,
    paused: state.paused,
    items
  };
  return { ok: true, item: result, state: next };
}

function fail(state: OutboxQueueState, error: string): OutboxMutationResult {
  return { ok: false, error, state };
}

function findItem(state: OutboxQueueState, itemId: string): OutboxItem | undefined {
  return state.items.find(item => item.itemId === itemId);
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidPayload(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 8_000;
}

function normalizePayload(value: string): string {
  return value.trim();
}

/**
 * Byte-for-byte the same hash the submission ledger mints its payload
 * fingerprints with. Deliberately duplicated rather than imported: this module
 * is reachable from the content entry, and the renderer that bundles it rolls
 * any module shared with the service-worker entry into a chunk an MV3 content
 * script cannot load. The two definitions must stay identical — the ledger
 * re-derives the fingerprint at prepare time and rejects a mismatch.
 */
export function fingerprintOutboxPayload(value: string): string {
  let hash = 0;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 2000);
  for (let index = 0; index < normalized.length; index += 1) hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  return hash.toString(16);
}

/** Reads the durable queue out of one `chrome.storage` payload. */
export function extractOutboxQueueState(raw: unknown): OutboxQueueState {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[OUTBOX_STORE_KEY] : undefined;
  return normalizeOutboxQueueState(value);
}

export function normalizeOutboxQueueState(value: unknown): OutboxQueueState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyOutboxQueueState();
  const candidate = value as Partial<OutboxQueueState>;
  const items = Array.isArray(candidate.items)
    ? candidate.items.filter(isOutboxItem).map(cloneOutboxItem)
    : [];
  return {
    revision: isFiniteCount(candidate.revision) ? candidate.revision : 0,
    sequence: isFiniteCount(candidate.sequence) ? candidate.sequence : items.reduce((max, item) => Math.max(max, item.sequence), 0),
    paused: candidate.paused === true,
    items
  };
}

export function isOutboxItem(value: unknown): value is OutboxItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<OutboxItem>;
  return isStableId(item.itemId) &&
    isNonEmpty(item.logicalThreadId) &&
    isNonEmpty(item.providerConversationRef) &&
    typeof item.payload === "string" && item.payload.length > 0 &&
    typeof item.payloadFingerprint === "string" && item.payloadFingerprint.length > 0 &&
    isFiniteCount(item.revision) && item.revision > 0 &&
    isFiniteCount(item.createdAt) &&
    isFiniteCount(item.updatedAt) &&
    isFiniteCount(item.sequence) &&
    isOutboxItemState(item.state) &&
    isFiniteCount(item.attempts) &&
    (item.submissionOperationId === undefined || isStableId(item.submissionOperationId)) &&
    (item.reservationRunId === undefined || isNonEmpty(item.reservationRunId)) &&
    (item.dispatchedAt === undefined || isFiniteCount(item.dispatchedAt)) &&
    (item.deliveredAt === undefined || isFiniteCount(item.deliveredAt)) &&
    (item.uncertaintySince === undefined || isFiniteCount(item.uncertaintySince)) &&
    (item.baselineUserMessageCount === undefined || isFiniteCount(item.baselineUserMessageCount)) &&
    (item.reservedAtUserMessageCount === undefined || isFiniteCount(item.reservedAtUserMessageCount)) &&
    (item.lastOutcome === undefined || item.lastOutcome === "PROVEN_NOT_ACCEPTED");
}

function isOutboxItemState(value: unknown): value is OutboxItemState {
  return value === "QUEUED" || value === "DISPATCHING" || value === "DELIVERED" || value === "UNCERTAIN" ||
    value === "BLOCKED" || value === "CANCELLED";
}

function isFiniteCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function cloneOutboxItem(item: OutboxItem): OutboxItem {
  return { ...item };
}

/**
 * The reservation a dispatch carries. Built by the caller from the Run epoch it
 * is about to spend, and written into the queue record before actuation.
 */
export function createOutboxReservation(
  item: OutboxItem,
  operationId: string,
  runId: string | undefined,
  observedUserMessageCount?: number
): OutboxDispatchReservation {
  return {
    itemId: item.itemId,
    revision: item.revision,
    submissionOperationId: operationId,
    runId,
    expectedOperationKind: "OUTBOX_MESSAGE",
    observedUserMessageCount: runId === undefined ? undefined : observedUserMessageCount
  };
}

/**
 * Acceptance evidence for one reserved operation, read out of the submission
 * ledger. Kept next to the reservation so both accounting and classification
 * consume the same shape.
 */
export function outboxSubmissionOutcome(operation: SubmissionOperation, now: number): OutboxSubmissionOutcome {
  return {
    operationId: operation.operationId,
    state: operation.state,
    baselineUserMessageCount: operation.preSubmitBaseline.userMessageCount,
    now
  };
}

/** Operations that belong to this item's reservation, newest first. */
export function reservedOperations(operations: SubmissionOperation[], item: OutboxItem): SubmissionOperation[] {
  if (item.submissionOperationId === undefined) return [];
  return operations.filter(operation =>
    operation.operationId === item.submissionOperationId &&
    operation.operationKind === "OUTBOX_MESSAGE" &&
    operation.providerConversationRef === item.providerConversationRef);
}
