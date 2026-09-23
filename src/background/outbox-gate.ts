/**
 * Outbox delivery gate (issue #63 v0) — the pure decision half.
 *
 * The background owns the durable queue; the carrier owns actuation. Given what
 * the carrier reports (identity, lease, observation, composer) and what the
 * submission ledger already holds, the gate decides whether the queue head may
 * be actuated right now.
 *
 * Three rules are load-bearing, and each is enforced here rather than in the
 * carrier, because a carrier that is wrong about any of them could deliver to
 * the wrong conversation:
 *
 * 1. **Conservative gate.** Target identity must resolve to this conversation,
 *    this carrier must hold the same-thread actuation lease (a sibling tab's
 *    claim context is not authority), the composer must be *empty*, and the
 *    observation must have been READY and non-mutating for a continuous window
 *    longer than the observation layer's own stabilization. Instantaneous READY
 *    is insufficient: the provider goes briefly idle between tool calls.
 *
 * 2. **Head-of-line blocking.** An ambiguous head suspends the entire queue.
 *    It is never skipped and no later item is delivered behind its back.
 *
 * 3. **Delivered means proven.** An item leaves DISPATCHING only on
 *    success-terminal evidence for the exact reserved operation. A claimed but
 *    unproven dispatch changes nothing, so it can never fabricate a user turn
 *    for the Run's accounting to lean on.
 *
 * Types only plus pure predicates — no store, no Chrome API, no actuation — so
 * this module never drags the queue store into the service-worker bundle's
 * shared-chunk calculation.
 */
import type { SubmissionAuthority, SubmissionClaimContext, SubmissionOperation } from "../core/submission-operation";
import type { OutboxBlockReason, OutboxItem, OutboxQueueState } from "../core/outbox-queue";

/**
 * Extra quiet time on top of the observation layer's own stabilization window.
 * The direction is fixed by disposition (instantaneous READY is not enough);
 * the exact value is implementation-local and dogfood-tunable.
 */
export const OUTBOX_EXTRA_QUIET_MS = 2_000;
/** A reservation younger than this is still being actuated, not yet reconcilable. */
export const OUTBOX_RECONCILE_GRACE_MS = 5_000;

export interface OutboxGateCarrier extends SubmissionClaimContext {
  providerConversationRef: string;
  targetCarrierRef: string;
  leaseOwnerRef: string;
  bindingEpoch: number;
  leaseGeneration: number;
  sourceEpoch: number;
  sourceObservedAt: number;
}

export interface OutboxGateObservation {
  state: string;
  carrierIdentityState: string;
  providerConversationRef?: string;
  routeRef: string;
  observedAt: number;
  sourceEpoch: number;
  quietSince?: number;
  assistantOutputMutating: boolean;
  stopGenerationControlPresent: boolean;
  providerErrorSurfacePresent: boolean;
  composerPresent: boolean;
  composerInteractive: boolean;
  composerEmpty: boolean;
  /** Observed user turns; the baseline a queued reservation is recorded against. */
  userMessageCount?: number;
}

export interface OutboxGateLedgers {
  /** This thread's actuation authority, or absent when nothing initialized one. */
  authority?: SubmissionAuthority;
  /** True when an execution-owning operation already holds this exact target. */
  executionInFlight: boolean;
  operations: SubmissionOperation[];
}

export interface OutboxProbeInput {
  queue: OutboxQueueState;
  carrier: OutboxGateCarrier;
  observation: OutboxGateObservation;
  ledgers: OutboxGateLedgers;
  runId?: string;
}

export interface OutboxProbeState {
  /**
   * The queue as the caller must persist it. A DISPATCH decision has already
   * written its reservation here, so the caller stores this *before* actuating:
   * that ordering is what makes the Run's expected-turn accounting
   * provenance-bound rather than a loose count offset.
   */
  queue: OutboxQueueState;
  status: OutboxProbeStatus;
  /** Present exactly when `status.kind === "DISPATCH"`: the frozen revision to actuate. */
  dispatch?: { item: OutboxItem; operationId: string; reservationRunId?: string };
}

export type OutboxProbeStatus =
  | { kind: "IDLE" }
  | { kind: "WAIT"; itemId: string; reason: OutboxBlockReason | "paused" | "reservation_missing" }
  | { kind: "DISPATCHING"; itemId: string; operationId: string }
  | { kind: "BLOCKED_UNCERTAIN"; itemId: string }
  /** The reservation's operation has left execution: the carrier must reconcile it. */
  | { kind: "RECONCILE"; itemId: string; operationId: string }
  | { kind: "DISPATCH"; itemId: string; operationId: string };

export interface OutboxProbeDeps {
  /** How many re-dispatches the queue allows before a proven failure parks an item. */
  maxAttempts: number;
  /** Mints an operation id for a fresh reservation. Deterministic per attempt. */
  mintOperationId(item: OutboxItem, now: number): string;
  now?: number;
}

export type OutboxHeadDecision =
  | { kind: "DISPATCH"; itemId: string; operationId: string; head: OutboxItem }
  | Exclude<OutboxProbeStatus, { kind: "IDLE" }>;

export function classifyOutboxHead(head: OutboxItem, input: OutboxProbeInput, now: number, deps: OutboxProbeDeps): OutboxHeadDecision {
  if (head.state === "UNCERTAIN") return { kind: "BLOCKED_UNCERTAIN", itemId: head.itemId };
  if (head.state === "BLOCKED" || head.attempts >= deps.maxAttempts) {
    return { kind: "WAIT", itemId: head.itemId, reason: "attempt_failed" };
  }
  if (head.state === "DISPATCHING") return classifyReservedHead(head, input, now);
  if (input.queue.paused) return { kind: "WAIT", itemId: head.itemId, reason: "paused" };
  const blocked = gateBlockReason(head, input, now);
  if (blocked) return { kind: "WAIT", itemId: head.itemId, reason: blocked };
  return { kind: "DISPATCH", itemId: head.itemId, operationId: deps.mintOperationId(head, now), head };
}

function classifyReservedHead(head: OutboxItem, input: OutboxProbeInput, now: number): OutboxHeadDecision {
  const operationId = head.submissionOperationId;
  if (operationId === undefined) return { kind: "WAIT", itemId: head.itemId, reason: "reservation_missing" };
  const reserved = input.ledgers.operations.filter(operation =>
    operation.operationId === operationId && operation.operationKind === "OUTBOX_MESSAGE");
  // A reservation that lost its operation (ledger pruned, id never landed) can
  // never be satisfied. Park the head visibly rather than deliver behind it.
  if (reserved.length === 0) return { kind: "BLOCKED_UNCERTAIN", itemId: head.itemId };
  const operation = reserved[0];
  if (operation.state === "PREPARED") {
    // The claim never actuated: the reservation is intact but unconsumed. Let
    // the carrier re-claim the same operation id — idempotent, never a resend.
    return { kind: "RECONCILE", itemId: head.itemId, operationId };
  }
  if (operation.state === "UNCERTAIN") return { kind: "BLOCKED_UNCERTAIN", itemId: head.itemId };
  if (operation.state === "FAILED_SAFE" || operation.state === "CANCELLED") {
    return { kind: "RECONCILE", itemId: head.itemId, operationId };
  }
  // DISPATCHING / OBSERVED_ACCEPTED / COMPLETED: the operation owns execution.
  // Give a fresh claim its grace period before asking the carrier to reconcile.
  const sinceDispatch = now - (head.dispatchedAt ?? now);
  if (sinceDispatch < OUTBOX_RECONCILE_GRACE_MS) {
    return { kind: "DISPATCHING", itemId: head.itemId, operationId };
  }
  return { kind: "RECONCILE", itemId: head.itemId, operationId };
}

/**
 * Does any execution-owning operation still hold this exact target?
 *
 * Lives here (not in the service worker) so the property that matters to the
 * outbox — that retiring an UNCERTAIN operation to CANCELLED stops blocking
 * later dispatches — is directly testable. CANCELLED is terminal, not
 * execution-owning: after a Human retires an ambiguous reservation, the next
 * queued item is dispatchable again.
 */
export function hasExecutionInFlight(operations: SubmissionOperation[], carrier: OutboxGateCarrier): boolean {
  return operations.some(operation =>
    (operation.state === "DISPATCHING" || operation.state === "UNCERTAIN" || operation.state === "OBSERVED_ACCEPTED") &&
    operation.targetCarrierRef === carrier.targetCarrierRef &&
    operation.providerConversationRef === carrier.providerConversationRef);
}

export function gateBlockReason(head: OutboxItem, input: OutboxProbeInput, now: number): OutboxBlockReason | undefined {
  const { carrier, observation, ledgers } = input;
  // Target identity: the item actuates into exactly one conversation, and the
  // carrier must be showing that conversation. A miss is WAIT — never a
  // delivery into whatever conversation happens to be open.
  if (!observation.providerConversationRef ||
    observation.providerConversationRef !== head.providerConversationRef ||
    carrier.providerConversationRef !== head.providerConversationRef) return "conversation_absent";
  if (observation.carrierIdentityState !== "browser-tab") return "carrier_not_ready";
  if (ledgers.executionInFlight) return "submission_in_flight";
  // Same-thread actuation lease. Authority is scoped per logical thread, so a
  // sibling tab's context — same conversation, other carrier — is not a licence.
  const authority = ledgers.authority;
  if (!authority ||
    authority.logicalThreadId !== head.logicalThreadId ||
    authority.targetCarrierRef !== carrier.targetCarrierRef ||
    authority.leaseOwnerRef !== carrier.leaseOwnerRef ||
    authority.leaseGeneration !== carrier.leaseGeneration ||
    authority.providerConversationRef !== head.providerConversationRef) return "lease_not_held";
  if (observation.state !== "READY") return "carrier_not_ready";
  if (observation.assistantOutputMutating || observation.stopGenerationControlPresent) return "carrier_not_ready";
  if (observation.sourceEpoch !== carrier.sourceEpoch) return "carrier_not_ready";
  // Continuous conservative READY: the quiet window must be unbroken and long
  // enough that a brief idle between provider tool calls cannot pass for idle.
  if (observation.quietSince === undefined ||
    now - observation.quietSince < OUTBOX_EXTRA_QUIET_MS ||
    observation.quietSince > now) return "carrier_not_ready";
  if (!observation.composerPresent || !observation.composerInteractive) return "carrier_not_ready";
  // Never overwrite whatever the Human is typing (issue #63 C2): this holds even
  // when Shuttle itself wrote the draft on an earlier attempt.
  if (!observation.composerEmpty) return "composer_not_empty";
  return undefined;
}
