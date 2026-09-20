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
  return { kind: "WAIT", itemId: head.itemId, reason: blockReasonFor(head, ordered) };
}

function blockReasonFor(head: OutboxItem, ordered: OutboxItem[]): OutboxBlockReason {
  if (head.attempts >= OUTBOX_MAX_ATTEMPTS) return "attempt_failed";
  // A proven-not-accepted attempt that has not been released yet parks the head.
  if (head.attempts > 0 && ordered.some(item => item.itemId === head.itemId && item.lastOutcome === "PROVEN_NOT_ACCEPTED")) {
    return "attempt_failed";
  }
  return "conversation_absent";
}

/**
 * The *only* admissible way a queued Human turn may raise a Run's expected
 * user-turn count.
 *
 * A Run's intervention rule is "any user turn this Run did not author is a
 * Human intervention". Shuttle authors exactly the turns that own a
 * success-terminal `OUTBOX_MESSAGE` operation, so the expected count is
 * `baseline + (delivered items, counted as a prefix)`. Nothing here consults a
 * claimed-but-unproven operation: that is precisely what keeps a failed or
 * UNCERTAIN dispatch from leaving a loose `+1` that could hide later genuine
 * Human input.
 *
 * `baseline` is the pre-submit user-turn count recorded in the first delivered
 * item's own acceptance evidence, so the accounting survives a page reload
 * without any in-memory counter.
 */
export function expectedUserTurnAccounting(
  state: OutboxQueueState,
  runId: string,
  providerConversationRef: string
): { baseline: number; expectedUserMessageCount: number } | undefined {
  const ordered = orderedOutboxItems(state).filter(item => item.state !== "CANCELLED");
  const delivered = new Map<string, OutboxItem>();
  for (const item of ordered) {
    if (item.state !== "DELIVERED") break;
    delivered.set(item.itemId, item);
  }
  const mine = ordered.filter(item => item.reservationRunId === runId && item.providerConversationRef === providerConversationRef);
  if (mine.length === 0) return undefined;
  let baseline: number | undefined;
  let count = 0;
  for (const item of mine) {
    if (!delivered.has(item.itemId)) break;
    baseline ??= item.baselineUserMessageCount;
    if (baseline === undefined) return undefined;
    count += 1;
  }
  if (baseline === undefined) return undefined;
  return { baseline, expectedUserMessageCount: baseline + count };
}

/** True when the queue still holds a reservation this Run epoch has not accounted for. */
export function hasOutstandingOutboxReservation(state: OutboxQueueState, runId: string): boolean {
  return state.items.some(item => item.reservationRunId === runId && item.state !== "DELIVERED" && item.state !== "CANCELLED");
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
      return commit(state, [edited], edited);
    }
    case "cancel": {
      const item = findItem(state, mutation.itemId);
      if (!item) return fail(state, "item_not_found");
      if (item.state === "CANCELLED") return { ok: true, item, state };
      if (AFTER_ACTUATION.has(item.state)) return fail(state, "cancel_requires_resolution");
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
      // PREPARED (or of a re-claim) must not undo a recorded outcome.
      if (item.state !== "DISPATCHING") return { ok: true, item, state };
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
      // PREPARED / DISPATCHING / FAILED_SAFE / CANCELLED prove nothing and must
      // not fabricate a delivery. Leave the reservation standing.
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

/** States that follow actuation: nothing here can be cancelled into a lie. */
const AFTER_ACTUATION: ReadonlySet<OutboxItemState> = new Set<OutboxItemState>(["DISPATCHING", "UNCERTAIN", "DELIVERED"]);

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
export function createOutboxReservation(item: OutboxItem, operationId: string, runId: string | undefined): OutboxDispatchReservation {
  return { itemId: item.itemId, revision: item.revision, submissionOperationId: operationId, runId, expectedOperationKind: "OUTBOX_MESSAGE" };
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
