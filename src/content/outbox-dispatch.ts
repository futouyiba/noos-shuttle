/**
 * Carrier-side `OUTBOX_MESSAGE` actuation (issue #63 v0).
 *
 * The delivery half of the outbox probe. Everything here goes through the
 * existing `SubmissionOperation` machinery with the same rules as every other
 * Shuttle actuation — prepare before actuate, one atomic claim, a dispatch
 * receipt, and reconciliation that proves acceptance by fingerprint — so a
 * queued Human turn is exactly as accountable as a governed `GO`. What differs
 * is only the kind and the run attribution.
 */
// Type-only, deliberately: the content entry must not bundle the submission
// ledger itself. The renderer promotes any module reachable at runtime from both
// entries into a chunk an MV3 classic content script cannot import, and the
// ledger is already bundled by the service-worker entry. The carrier receives a
// live ledger instance (its own) through `OutboxDispatchDeps`.
import type {
  SubmissionAuthority,
  SubmissionClaimContext,
  SubmissionBaseline,
  SubmissionOperation
} from "../core/submission-operation";
import { HumanGoRuntime, type HumanGoCarrierSnapshot, type HumanGoLedger } from "../core/human-go-runtime";
import { provenNotActuatedRefusal } from "../core/proven-refusal";
import type { CarrierObservation } from "./runtime-observer";
import { getChatComposer, isChatComposerEmpty, insertIntoChatInput, submitChatInput } from "./chatgpt-dom";

export interface OutboxDispatchRequest {
  itemId: string;
  operationId: string;
  payload: string;
  payloadFingerprint: string;
  revision: number;
  reservationRunId?: string;
  observation: CarrierObservation;
  /**
   * Message evidence read from the conversation at the moment of the probe. The
   * observation snapshot intentionally does not carry fingerprints — it is the
   * cheap routing probe — so they arrive from the same DOM read the baseline
   * uses.
   */
  evidence: Pick<SubmissionBaseline, "headFingerprint" | "lastUserMessageFingerprint" | "lastAssistantMessageFingerprint">;
}

export type OutboxDispatchResult =
  | { status: "DISPATCHED"; operation: SubmissionOperation }
  /** Nothing was sent; the reservation stands and the item is not delivered. */
  | { status: "BLOCKED"; reason: string }
  /**
   * A reserved operation was reconciled (or found already settled) instead of
   * being re-actuated. Never a delivery claim: only the ledger's own
   * success-terminal evidence moves an item forward, and that fold happens
   * background-side in `recordOutboxOutcome`.
   */
  | { status: "RECONCILED"; operation: SubmissionOperation }
  /** The reservation is not this outbox's to act on. */
  | { status: "NOT_RESERVED" };

export interface OutboxLedgerDeps {
  /** The carrier's own ledger instance. Supplied by the caller, never built here. */
  ledger: HumanGoLedger;
}

export interface OutboxDispatchDeps extends OutboxLedgerDeps {
  /**
   * A fresh reading of the page, taken at the instant it is called.
   *
   * Supplied by the content entry rather than reached for here: this module is
   * deliberately free of the observer loop, and the read has to be the *same*
   * authoritative read the observer uses rather than a private second cache —
   * a second cache would answer "what did we last hear" while claiming to answer
   * "what is true now", which is the whole defect (issue #99).
   */
  readLiveCarrier(): { observation: CarrierObservation; carrier: HumanGoCarrierSnapshot };
}

/**
 * The ledger's own stabilization window, mirrored rather than imported: a value
 * import from `submission-operation` would pull the whole ledger into the
 * content bundle and the renderer would promote it to a chunk an MV3 classic
 * content script cannot load. If the ledger's window moves, this must move with
 * it — the ledger is the authority on when a turn counts as finished, and this
 * only decides when to *ask*.
 */
const OUTBOX_SUBMISSION_STABLE_WINDOW_MS = 2_000;

/** States where the operation already owns execution: reconcile, never resend. */
const EXECUTION_OWNING = new Set<SubmissionOperation["state"]>(["DISPATCHING", "UNCERTAIN", "OBSERVED_ACCEPTED"]);

/**
 * Reconciles a reservation the probe reported as `RECONCILE`, and settles it
 * once the turn is provably finished.
 *
 * This is the carrier half of the loop delta 3 depends on. Without it a
 * delivered operation sits at `OBSERVED_ACCEPTED` forever, which both starves
 * the queue's fold (the item never reaches `DELIVERED`, so the Run's earned
 * floor stays at zero and the queued turn reads as Human intervention) and
 * wedges every later dispatch (`hasExecutionInFlight` stays true for this
 * target).
 */
export async function reconcileOutboxReservation(
  request: OutboxReconcileRequest,
  deps: OutboxLedgerDeps
): Promise<OutboxDispatchResult> {
  const operation = await deps.ledger.get(request.operationId);
  if (!operation) return { status: "NOT_RESERVED" };
  if (operation.operationKind !== "OUTBOX_MESSAGE") return { status: "NOT_RESERVED" };
  return reconcileReserved(deps.ledger, operation, request.observation, request.evidence, request.itemId);
}

export interface OutboxReconcileRequest {
  itemId: string;
  operationId: string;
  observation: CarrierObservation;
  evidence: OutboxDispatchRequest["evidence"];
}

export async function dispatchOutboxMessage(
  request: OutboxDispatchRequest,
  deps: OutboxDispatchDeps
): Promise<OutboxDispatchResult> {
  const { ledger } = deps;
  const observation = request.observation;
  const conversationRef = observation.providerConversationRef;
  if (!conversationRef || observation.carrierIdentityState !== "browser-tab") {
    return { status: "BLOCKED", reason: "identity_missing" };
  }
  const logicalThreadId = `thread:${conversationRef}`;
  // Absence is decisive: no slot means no licence, and the gate already refused
  // this dispatch if the carrier was not the holder.
  const authority = await ledger.authorityFor?.(logicalThreadId);

  // A reservation that already owns execution is reconciled, never re-actuated:
  // re-preparing the same id would be an idempotent no-op or a payload conflict,
  // and neither is a delivery. A retired reservation is likewise never reused —
  // the queue folds it and mints a fresh id for the next attempt.
  const existing = await ledger.get(request.operationId);
  if (existing) {
    if (existing.operationKind !== "OUTBOX_MESSAGE") return { status: "BLOCKED", reason: "reservation_kind_mismatch" };
    if (EXECUTION_OWNING.has(existing.state)) {
      return reconcileReserved(ledger, existing, observation, request.evidence, request.itemId);
    }
    if (existing.state === "FAILED_SAFE" || existing.state === "CANCELLED") {
      return { status: "RECONCILED", operation: existing };
    }
    // PREPARED with the fence still intact: the claim never actuated, and the
    // normal path below re-claims this very operation (create-or-get is
    // idempotent, so this is a delivery of the same reservation, not a resend).
    //
    // PREPARED with a fence that no longer holds is refused rather than
    // re-fenced. The gate only reports a reservation for a carrier it has
    // already checked holds this thread's lease, so a stale fence here is one
    // the gate could not see, and re-preparing under a mismatched fence would
    // throw a reuse conflict instead of delivering. The head keeps waiting
    // visibly, which is the honest outcome for a reservation nothing can claim.
    if (existing.state === "PREPARED" && existing.dispatchFence && !sameFence(existing, observation)) {
      return { status: "BLOCKED", reason: "reservation_fence_stale" };
    }
  }

  const context = contextFor(observation);
  if (!authority ||
    authority.logicalThreadId !== logicalThreadId ||
    authority.leaseOwnerRef !== context.leaseOwnerRef ||
    authority.leaseGeneration !== context.leaseGeneration ||
    authority.targetCarrierRef !== context.targetCarrierRef ||
    authority.providerConversationRef !== conversationRef) {
    return { status: "BLOCKED", reason: "lease_not_held" };
  }

  const baseline: SubmissionBaseline = {
    conversationRef,
    routeRef: observation.routeRef,
    assistantMessageCount: observation.assistantMessageCount ?? 0,
    userMessageCount: observation.userMessageCount ?? 0,
    ...request.evidence,
    observedAt: observation.observedAt
  };

  const humanGo = new HumanGoRuntime(ledger, {
    // Actually re-reads the page. The fence the probe captured is a claim about
    // a moment that has already passed by the time anything is inserted, so the
    // runtime asks again here and again at the insertion itself.
    readCurrentCarrier: async () => deps.readLiveCarrier().carrier,
    dispatch: async payload => {
      // The gap between the probe and this line is the async-submit window: a
      // claim round-trip to the background sits inside it, and the page can
      // navigate anywhere in that window. Everything below is judged against a
      // reading taken *now*, never against the reading that got us here.
      const live = deps.readLiveCarrier().observation;
      if (!isLiveIdentityCurrent(live, context)) {
        // Includes the cross-conversation case (issue #99): the probe read
        // conversation A, the SPA moved to B, and B's composer is empty — so the
        // composer check alone would have passed and delivered into B.
        // Pre-write, so provably nothing was sent (issue #108).
        throw provenNotActuatedRefusal("chatgpt_carrier_moved");
      }
      const composer = getChatComposer();
      // Hard gate, re-checked at the composer itself: a draft that appeared
      // between the probe and this instant is never overwritten (#63 C2).
      // Also pre-write, so also provably not actuated (issue #108).
      if (!composer || !isChatComposerEmpty()) throw provenNotActuatedRefusal("chatgpt_composer_not_empty");
      if (!insertIntoChatInput(payload, composer) || !(await submitChatInput(composer))) {
        // Post-write: the payload may be in the composer or a send may have
        // fired — genuinely ambiguous, deliberately NOT marked.
        throw new Error("chatgpt_composer_unavailable");
      }
    }
  });

  let result: Awaited<ReturnType<typeof humanGo.execute>>;
  try {
    result = await humanGo.execute({
      operationId: request.operationId,
      operationKind: "OUTBOX_MESSAGE",
      workItemId: "shuttle-outbox",
      logicalThreadId,
      payload: request.payload,
      payloadFingerprint: request.payloadFingerprint,
      preSubmitBaseline: baseline,
      providerConversationRef: conversationRef,
      targetCarrierRef: observation.carrierRef,
      bindingEpoch: observation.sourceEpoch,
      leaseGeneration: observation.sourceEpoch,
      leaseOwnerRef: observation.executionInstanceRef,
      explicitGo: true,
      sourceEpoch: observation.sourceEpoch,
      sourceObservedAt: observation.observedAt,
      runId: request.reservationRunId
    });
  } catch (error) {
    return { status: "BLOCKED", reason: error instanceof Error ? error.message : "outbox_dispatch_failed" };
  }
  if (result.status === "BLOCKED") return { status: "BLOCKED", reason: result.reason };
  // A proven-not-actuated refusal sent nothing and converged the reservation
  // back to PREPARED (issue #108). Nothing was delivered, so this is BLOCKED —
  // the item keeps its reservation and the queue retries — never RECONCILED,
  // which the caller would read as progress. Re-claiming that PREPARED
  // reservation is PR #121's retarget lane; until it lands, the honest state
  // is a visible wait.
  if (result.status === "REFUSED") return { status: "BLOCKED", reason: `refused:${result.reason}` };
  // The claim is what makes this Run epoch's expected Human turn accountable;
  // the caller turns this into the run projection's own bookkeeping.
  return result.status === "DISPATCHED"
    ? { status: "DISPATCHED", operation: result.operation }
    : { status: "RECONCILED", operation: result.operation };
}

/**
 * Reconcile a reserved operation the probe already reserved but has not
 * delivered. Only the ledger's own acceptance evidence may move the item
 * forward; a still-ambiguous result leaves it exactly where it is.
 */
async function reconcileReserved(
  ledger: HumanGoLedger,
  operation: SubmissionOperation,
  observation: CarrierObservation,
  evidence: OutboxDispatchRequest["evidence"],
  itemId: string
): Promise<OutboxDispatchResult> {
  if (operation.state === "COMPLETED" || operation.state === "FAILED_SAFE" ||
    operation.state === "CANCELLED" || operation.state === "PREPARED") {
    return { status: "RECONCILED", operation };
  }
  if (!operation.dispatchFence) return { status: "BLOCKED", reason: "reservation_fence_missing" };
  const result = await ledger.reconcile(operation.operationId, {
    conversationRef: observation.providerConversationRef,
    routeRef: observation.routeRef,
    assistantMessageCount: observation.assistantMessageCount ?? 0,
    userMessageCount: observation.userMessageCount ?? 0,
    ...evidence,
    observedAt: observation.observedAt,
    sourceEpoch: observation.sourceEpoch,
    stableSince: observation.quietSince ?? undefined,
    providerFailure: observation.providerErrorSurfacePresent,
    generationActive: observation.state === "GENERATING",
    dispatchFence: operation.dispatchFence
  });
  const settled = result.operation ?? operation;
  return { status: "RECONCILED", operation: await completeIfTurnFinished(ledger, settled, observation, evidence, itemId) };
}

/**
 * Closes a proven-accepted reservation once the turn it produced has finished
 * and the carrier has been quiet for the ledger's own stabilization window —
 * the same bar `reconcileActiveSubmission` applies to a governed round.
 *
 * Settling is not bookkeeping: an operation left at `OBSERVED_ACCEPTED` still
 * owns execution, so it would block every later dispatch to this target.
 */
async function completeIfTurnFinished(
  ledger: HumanGoLedger,
  operation: SubmissionOperation,
  observation: CarrierObservation,
  evidence: OutboxDispatchRequest["evidence"],
  itemId: string
): Promise<SubmissionOperation> {
  if (operation.state !== "OBSERVED_ACCEPTED") return operation;
  const claimedAt = operation.dispatchClaimedAt;
  if (claimedAt === undefined) return operation;
  // Acceptance must still be this message's: a later legitimate turn
  // overwrites `lastReconciliationEvidence`, so a missing stamp means the
  // acceptance we are completing is no longer provable.
  const acceptedFingerprint = operation.acceptedPayloadFingerprint;
  if (acceptedFingerprint === undefined) return operation;
  const quietSince = observation.quietSince;
  if (observation.state !== "READY" || quietSince === null || quietSince === undefined) return operation;
  if (observation.observedAt - Math.max(claimedAt, quietSince) < OUTBOX_SUBMISSION_STABLE_WINDOW_MS) return operation;
  if (evidence.lastUserMessageFingerprint !== undefined && evidence.lastUserMessageFingerprint !== acceptedFingerprint) return operation;
  const completed = await ledger.record(operation.operationId, "COMPLETED", { now: observation.observedAt });
  return completed?.state === "COMPLETED" ? completed : operation;
}

/**
 * Is this reading still the carrier the claim was made against?
 *
 * Compares the four identities that together say "the same page, the same
 * conversation, the same execution, the same epoch" — the fence's
 * `bindingEpoch`/`leaseGeneration` are both derived from `sourceEpoch` at claim
 * time, so epoch equality covers them. Mirrors `isCurrentSubmissionObservation`
 * in the content entry, which guards the manual GO path the same way.
 */
function isLiveIdentityCurrent(live: CarrierObservation, claim: SubmissionClaimContext): boolean {
  return live.carrierIdentityState === "browser-tab" &&
    live.state === "READY" &&
    live.providerConversationRef === claim.providerConversationRef &&
    live.carrierRef === claim.targetCarrierRef &&
    live.executionInstanceRef === claim.leaseOwnerRef &&
    live.sourceEpoch === claim.sourceEpoch;
}

/** The claim context this observation licenses. Identity is never asserted here. */
function contextFor(observation: CarrierObservation): SubmissionClaimContext {
  return {
    logicalThreadId: `thread:${observation.providerConversationRef ?? ""}`,
    providerConversationRef: observation.providerConversationRef ?? "",
    bindingEpoch: observation.sourceEpoch,
    leaseGeneration: observation.sourceEpoch,
    leaseOwnerRef: observation.executionInstanceRef,
    targetCarrierRef: observation.carrierRef,
    sourceEpoch: observation.sourceEpoch,
    sourceObservedAt: observation.observedAt,
    carrierState: "READY",
    logicalControl: "CONTINUE",
    explicitGo: true
  };
}

function sameFence(operation: SubmissionOperation, observation: CarrierObservation): boolean {
  const fence = operation.dispatchFence;
  return Boolean(fence &&
    fence.providerConversationRef === observation.providerConversationRef &&
    fence.bindingEpoch === observation.sourceEpoch &&
    fence.leaseGeneration === observation.sourceEpoch &&
    fence.leaseOwnerRef === observation.executionInstanceRef &&
    fence.targetCarrierRef === observation.carrierRef);
}
