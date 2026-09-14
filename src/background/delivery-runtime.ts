import type {
  SubmissionClaimContext,
  SubmissionBaseline,
  SubmissionObservation,
  SubmissionOperation,
} from "../core/submission-operation";
import type { ChildWorkerLedger, ChildWorkerRecord } from "../core/child-worker";
import { resultDeliveryKey, type ResultDeliveryLedger } from "../core/result-delivery";
import {
  childDeliveryOperationId,
  mintInsertedOnAcceptance,
  openChildDelivery,
  prepareChildDeliveryTransport,
  retargetChildDeliveryTransport,
  type DeliveryTransportDependencies,
} from "../core/deliver-child-result";

export interface ChildDeliveryProbe {
  context: SubmissionClaimContext;
  baseline: SubmissionBaseline;
}

interface WorkItemProjection {
  workItemId: string;
  primaryLogicalThreadId: string;
  status: string;
  binding?: { conversationId?: string; carrierRef?: string };
}

let pending: Promise<unknown> = Promise.resolve();

const FRESH_STATES = new Set(["RESULT_READY", "RETURNING"]);
const RECOVERY_STATES = new Set(["RESULT_READY", "RETURNING", "COMPLETED"]);

/**
 * Parent-side delivery runtime, mirroring the reviewed goal-reanchor probe.
 * One probe drives the whole adjudicated flow for one parent conversation:
 * resolve the parent thread through the Work Item binding (conversation +
 * carrier), then for each child result: open the receiptless delivery index,
 * prepare (or re-fence after a rollover) the transport, claim, dispatch to the
 * carrier, and record the dispatch receipt — and on later probes reconcile the
 * claimed transport, mint INSERTED only on ledger-proven acceptance, and close
 * the delivery (which clears the parent wait) once the result-bearing turn
 * completes. One blind dispatch per claim; failures park as UNCERTAIN.
 */
export function runChildDeliveryProbe(
  probe: ChildDeliveryProbe,
  storage: Pick<chrome.storage.StorageArea, "get" | "set">,
  deps: DeliveryTransportDependencies,
  dispatch: (operation: SubmissionOperation) => Promise<SubmissionObservation>
): Promise<{ status: string; dispatched?: number; closed?: number }> {
  const run = pending.then(async () => {
    const workItems = (await storage.get("noosWorkItemInbox")).noosWorkItemInbox;
    const item = workItems?.workItems?.find((value: WorkItemProjection) =>
      value.workItemId === workItems.activeWorkItemId && value.status === "ACTIVE" &&
      value.binding?.conversationId === probe.context.providerConversationRef &&
      value.binding?.carrierRef === probe.context.targetCarrierRef) as WorkItemProjection | undefined;
    if (!item?.primaryLogicalThreadId) return { status: "NO_ACTIVE_PARENT" };
    const parentThreadId = item.primaryLogicalThreadId;
    const context: SubmissionClaimContext = { ...probe.context, logicalThreadId: parentThreadId };
    try {
      await deps.submissions.initializeAuthority(context);
    } catch {
      return { status: "AUTHORITY_STALE" };
    }

    const children = await deps.children.list();
    let dispatched = 0;
    let closed = 0;
    for (const child of children) {
      if (child.parentThreadId !== parentThreadId || !child.resultRef) continue;
      if (FRESH_STATES.has(child.state)) {
        const delivered = await dispatchOnce(deps, child, context, probe.baseline, dispatch);
        if (delivered) dispatched += 1;
      }
      if (RECOVERY_STATES.has(child.state)) {
        const done = await recoverOnce(deps, child, context, probe.baseline);
        if (done) closed += 1;
      }
    }
    return { status: "OK", dispatched, closed };
  });
  pending = run.then(() => undefined, () => undefined);
  return run;
}

async function dispatchOnce(
  deps: DeliveryTransportDependencies,
  child: ChildWorkerRecord,
  context: SubmissionClaimContext,
  baseline: SubmissionBaseline,
  dispatch: (operation: SubmissionOperation) => Promise<SubmissionObservation>
): Promise<boolean> {
  const { delivery } = await openChildDelivery(deps, { childThreadId: child.childThreadId, now: context.sourceObservedAt });
  if (delivery.receiptState) return false;
  const existing = await deps.submissions.get(delivery.submissionOperationId);
  let claimed: SubmissionOperation | undefined;
  if (!existing) {
    const prepared = await prepareChildDeliveryTransport(deps, {
      childThreadId: child.childThreadId, destination: context, baseline, now: context.sourceObservedAt
    });
    claimed = await deps.submissions.claim(prepared.operation.operationId, context, Date.now());
  } else if (existing.state === "PREPARED") {
    const fence = existing.dispatchFence;
    const fenceIsCurrent = fence &&
      fence.providerConversationRef === context.providerConversationRef &&
      fence.targetCarrierRef === context.targetCarrierRef &&
      fence.bindingEpoch === context.bindingEpoch &&
      fence.leaseGeneration === context.leaseGeneration &&
      fence.leaseOwnerRef === context.leaseOwnerRef;
    if (!fenceIsCurrent) {
      // The claim never happened, so the old fence is provisional — whether the
      // conversation rolled over or the page reloaded with a fresh execution
      // instance, re-fence to the current authority instead of wedging.
      await retargetChildDeliveryTransport(deps, {
        childThreadId: child.childThreadId, destination: context, baseline, now: context.sourceObservedAt
      });
    }
    claimed = await deps.submissions.claim(existing.operationId, context, Date.now());
  }
  if (!claimed) return false;
  try {
    const observation = await dispatch(claimed);
    const observedAt = observation.observedAt ?? Date.now();
    await deps.submissions.record(claimed.operationId, "DISPATCHING", {
      now: observedAt,
      dispatchReceipt: {
        claimedAt: claimed.dispatchClaimedAt!,
        attemptedAt: observedAt,
        outcome: "dispatched",
        fence: claimed.dispatchFence!
      }
    });
  } catch {
    // Lost acknowledgement: park as UNCERTAIN for conservative reconciliation.
    await deps.submissions.record(claimed.operationId, "UNCERTAIN", { now: Date.now(), error: "delivery_dispatch_uncertain" }).catch(() => undefined);
    return false;
  }
  return true;
}

async function recoverOnce(
  deps: DeliveryTransportDependencies,
  child: ChildWorkerRecord,
  context: SubmissionClaimContext,
  baseline: SubmissionBaseline
): Promise<boolean> {
  const operationId = childDeliveryOperationId({
    parentThreadId: child.parentThreadId, childThreadId: child.childThreadId, resultRef: child.resultRef!
  });
  const operation = await deps.submissions.get(operationId);
  if (!operation) return false;
  if (operation.state === "DISPATCHING" || operation.state === "UNCERTAIN") {
    // Reconcile with the post-dispatch conversation state the probe observes.
    await deps.submissions.reconcile(operationId, {
      ...baseline,
      conversationRef: context.providerConversationRef,
      sourceEpoch: context.sourceEpoch,
      generationActive: false,
      // Stability anchors at the probe's observation point; the ledger still
      // demands the full quiet window after the claim before completion.
      stableSince: context.sourceObservedAt,
      dispatchFence: operation.dispatchFence
    }).catch(() => undefined);
  }
  const settled = await deps.submissions.get(operationId);
  if (!settled || (settled.state !== "OBSERVED_ACCEPTED" && settled.state !== "COMPLETED") || !settled.providerConversationRef) return false;
  // Non-GO transports do not fingerprint-check acceptance inside the ledger;
  // this runtime tightens it: only evidence whose last user message IS the
  // payload may mint, so an unrelated manual message cannot be read as
  // "result inserted".
  if (settled.lastReconciliationEvidence?.lastUserMessageFingerprint !== settled.payloadFingerprint) return false;
  const minted = await mintInsertedOnAcceptance(deps, {
    childThreadId: child.childThreadId,
    deliveredTo: settled.providerConversationRef,
    now: settled.lastObservedAt
  }).catch(() => undefined);
  if (!minted || minted.delivery.receiptState !== "INSERTED") return false;
  // Close only once the result-bearing turn is durably complete; timestamped
  // from the evidence observation so a probe never races the ledger's clock.
  if (settled.state === "OBSERVED_ACCEPTED") {
    const completed = await deps.submissions.record(operationId, "COMPLETED", { now: settled.lastObservedAt }).catch(() => undefined);
    if (!completed || completed.state !== "COMPLETED") return false;
  }
  await deps.deliveries.completeDelivery(resultDeliveryKey({
    parentThreadId: child.parentThreadId, childThreadId: child.childThreadId, resultRef: child.resultRef!
  }), { resultingParentTurnRef: settled.resultingTurnRef }, settled.lastObservedAt).catch(() => undefined);
  // Lifecycle §7: the delivery closing completes the child's return journey.
  // State-guarded no-ops for a child already completed or retired.
  if (child.state === "RESULT_READY") {
    await deps.children.beginReturn(child.childThreadId, settled.lastObservedAt).catch(() => undefined);
  }
  await deps.children.complete(child.childThreadId, settled.lastObservedAt).catch(() => undefined);
  return true;
}
