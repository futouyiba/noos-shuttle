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
import { HumanGoRuntime, type HumanGoLedger } from "../core/human-go-runtime";
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
  /** The reserved operation was reconciled instead of re-actuated. */
  | { status: "RECONCILED"; operation: SubmissionOperation };

export interface OutboxDispatchDeps {
  /** The carrier's own ledger instance. Supplied by the caller, never built here. */
  ledger: HumanGoLedger;
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

  // The reservation may already be claimed and in flight. Reconciling it is the
  // only legal move: re-preparing the same id would either be an idempotent
  // no-op or a payload conflict, and neither is a delivery.
  const existing = await ledger.get(request.operationId);
  if (existing) return reconcileReserved(ledger, existing, observation, request.evidence);

  const context: SubmissionClaimContext = {
    logicalThreadId,
    providerConversationRef: conversationRef,
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
    readCurrentCarrier: async () => {
      // Re-read the live observation: a fence captured before the probe must not
      // be trusted if the page moved underneath it.
      const current = observation;
      return {
        logicalThreadId,
        providerConversationRef: current.providerConversationRef ?? "",
        bindingEpoch: current.sourceEpoch,
        leaseGeneration: current.sourceEpoch,
        leaseOwnerRef: current.executionInstanceRef,
        targetCarrierRef: current.carrierRef,
        carrierState: "READY" as const,
        logicalControl: "CONTINUE" as const,
        explicitGo: true,
        sourceEpoch: current.sourceEpoch,
        sourceObservedAt: current.observedAt
      };
    },
    dispatch: async payload => {
      const composer = getChatComposer();
      // Hard gate, re-checked at the composer itself: a draft that appeared
      // between the probe and this instant is never overwritten (#63 C2).
      if (!composer || !isChatComposerEmpty()) throw new Error("chatgpt_composer_not_empty");
      if (!insertIntoChatInput(payload, composer) || !(await submitChatInput(composer))) {
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
  evidence: OutboxDispatchRequest["evidence"]
): Promise<OutboxDispatchResult> {
  if (operation.operationKind !== "OUTBOX_MESSAGE") return { status: "BLOCKED", reason: "reservation_kind_mismatch" };
  if (operation.state === "COMPLETED" || operation.state === "OBSERVED_ACCEPTED") {
    return { status: "RECONCILED", operation };
  }
  if (operation.state === "FAILED_SAFE" || operation.state === "CANCELLED") {
    return { status: "RECONCILED", operation };
  }
  if (operation.state === "PREPARED") return { status: "RECONCILED", operation };
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
  return { status: "RECONCILED", operation: result.operation ?? operation };
}
