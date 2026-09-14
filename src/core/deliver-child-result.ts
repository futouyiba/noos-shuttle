/**
 * DELIVER_CHILD_RESULT transport composer (adjudication decision 1, §2-§10 of
 * the child-result-delivery contract).
 *
 * Two tables, one protocol: the ResultDeliveryKey index row is the logical
 * delivery identity and can exist receiptless while no safe carrier is
 * available (PREPARED != INSERTED); the canonical transport lifecycle lives
 * entirely on the SubmissionOperation(kind=DELIVER_CHILD_RESULT) ledger. The
 * operation id is derived deterministically from the delivery identity, so the
 * index and the transport share one id and create-or-get stays idempotent on
 * both sides. INSERTED is minted only when the transport has actually reached
 * OBSERVED_ACCEPTED — the composer checks the ledger, not the caller's say-so.
 */

import { ChildWorkerLedger, type ChildWorkerRecord } from "./child-worker";
import { ResultDeliveryLedger, resultDeliveryKey, type ResultDeliveryRecord, type RecordedDispatchFence } from "./result-delivery";
import {
  SubmissionOperationLedger,
  fingerprintSubmissionPayload,
  type SubmissionBaseline,
  type SubmissionClaimContext,
  type SubmissionOperation,
} from "./submission-operation";

const RETURNABLE_STATES = new Set(["RESULT_READY", "RETURNING", "COMPLETED"]);

export interface DeliveryTransportDependencies {
  children: ChildWorkerLedger;
  deliveries: ResultDeliveryLedger;
  submissions: SubmissionOperationLedger;
}

/**
 * Deterministic transport id. Operation ids cannot contain ">" or "@", so no
 * separator char is injective over id-shaped fields; instead hash the delivery
 * identity and keep the child thread readable. A hash collision across two
 * different deliveries surfaces loudly as the ledger's
 * operation_id_reuse_conflict (fail-closed), never a silent merge.
 */
export function childDeliveryOperationId(identity: { parentThreadId: string; childThreadId: string; resultRef: string }): string {
  const normalized = `${identity.parentThreadId}>${identity.childThreadId}>${identity.resultRef}`;
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return `deliver:${identity.childThreadId}:${hash.toString(16)}`;
}

async function requireReturnableChild(deps: DeliveryTransportDependencies, childThreadId: string): Promise<{ child: ChildWorkerRecord; resultRef: string }> {
  const child = await deps.children.get(childThreadId);
  if (!child) throw new Error(`child_thread_not_found:${childThreadId}`);
  if (!RETURNABLE_STATES.has(child.state)) throw new Error(`child_not_returnable:${child.state}`);
  const resultRef = child.resultRef;
  if (!resultRef) throw new Error("child_result_not_ready");
  return { child, resultRef };
}

/**
 * Open (or get) the logical delivery: a receiptless index row referencing the
 * deterministic transport id. Safe at any point after the child has a result —
 * including while no safe parent carrier exists yet.
 */
export async function openChildDelivery(
  deps: DeliveryTransportDependencies,
  input: { childThreadId: string; now?: number }
): Promise<{ child: ChildWorkerRecord; delivery: ResultDeliveryRecord }> {
  const { child, resultRef } = await requireReturnableChild(deps, input.childThreadId);
  const delivery = await deps.deliveries.createDelivery({
    submissionOperationId: childDeliveryOperationId({ parentThreadId: child.parentThreadId, childThreadId: child.childThreadId, resultRef }),
    parentThreadId: child.parentThreadId,
    childThreadId: child.childThreadId,
    workItemId: child.workItemId,
    resultRef,
    now: input.now
  });
  return { child, delivery };
}

/**
 * Prepare the canonical transport operation on the submission ledger, fenced to
 * the destination resolved at call time (late binding, §5). Idempotent: the
 * ledger's create-or-get returns the existing operation for the derived id.
 * The claim context's logical thread must be the child's parent — routing is by
 * parent Logical Thread, never by the carrier that raised the child.
 */
export async function prepareChildDeliveryTransport(
  deps: DeliveryTransportDependencies,
  input: {
    childThreadId: string;
    destination: SubmissionClaimContext;
    baseline: SubmissionBaseline;
    now?: number;
  }
): Promise<{ child: ChildWorkerRecord; delivery: ResultDeliveryRecord; operation: SubmissionOperation }> {
  const { child, resultRef } = await requireReturnableChild(deps, input.childThreadId);
  const delivery = await deps.deliveries.createDelivery({
    submissionOperationId: childDeliveryOperationId({ parentThreadId: child.parentThreadId, childThreadId: child.childThreadId, resultRef }),
    parentThreadId: child.parentThreadId,
    childThreadId: child.childThreadId,
    workItemId: child.workItemId,
    resultRef,
    now: input.now
  });
  if (input.destination.logicalThreadId !== child.parentThreadId) {
    throw new Error(`delivery_route_mismatch:${input.destination.logicalThreadId}!=${child.parentThreadId}`);
  }
  // The V1 transport payload is the result ref (contract §4 payload_ref); the
  // mint-side fingerprint check relies on this equality, so no caller override.
  const payload = resultRef;
  const operation = await deps.submissions.prepare({
    operationId: delivery.submissionOperationId,
    operationKind: "DELIVER_CHILD_RESULT",
    workItemId: child.workItemId,
    logicalThreadId: child.parentThreadId,
    targetCarrierRef: input.destination.targetCarrierRef,
    providerConversationRef: input.destination.providerConversationRef,
    // Only the five authority fields belong on the fence; the claim context's
    // readiness fields (explicitGo, sourceEpoch, …) are claim-time, not fence.
    dispatchFence: {
      providerConversationRef: input.destination.providerConversationRef,
      bindingEpoch: input.destination.bindingEpoch,
      leaseGeneration: input.destination.leaseGeneration,
      leaseOwnerRef: input.destination.leaseOwnerRef,
      targetCarrierRef: input.destination.targetCarrierRef
    },
    payloadFingerprint: fingerprintSubmissionPayload(payload),
    payload,
    preSubmitBaseline: input.baseline,
    now: input.now
  });
  return { child, delivery, operation };
}

/**
 * Re-fence the transport after a parent rollover that happened BEFORE the
 * dispatch claim: the delivery identity stays, the ledger's retarget moves the
 * conversation/carrier/generations and the pre-submit baseline to the newly
 * authoritative destination. Only valid while the transport is still PREPARED;
 * anything execution-owning keeps the ledger's recover/rearm semantics.
 */
export async function retargetChildDeliveryTransport(
  deps: DeliveryTransportDependencies,
  input: {
    childThreadId: string;
    destination: SubmissionClaimContext;
    baseline: SubmissionBaseline;
    now?: number;
  }
): Promise<{ child: ChildWorkerRecord; operation: SubmissionOperation }> {
  const { child, resultRef } = await requireReturnableChild(deps, input.childThreadId);
  if (input.destination.logicalThreadId !== child.parentThreadId) {
    throw new Error(`delivery_route_mismatch:${input.destination.logicalThreadId}!=${child.parentThreadId}`);
  }
  const submissionOperationId = childDeliveryOperationId({
    parentThreadId: child.parentThreadId,
    childThreadId: child.childThreadId,
    resultRef
  });
  const operation = await deps.submissions.retarget(submissionOperationId, input.destination, input.baseline, input.now);
  if (!operation) throw new Error(`delivery_retarget_refused:${submissionOperationId}`);
  return { child, operation };
}

/**
 * Mint the INSERTED receipt strictly from transport state: the referenced
 * SubmissionOperation must be OBSERVED_ACCEPTED, or COMPLETED — the ledger's
 * transition discipline proves COMPLETED was reached only through
 * OBSERVED_ACCEPTED with stable completion evidence, so a completed transport
 * mints rather than wedging when the generic content recovery completes the
 * operation before this projection runs. PREPARED, DISPATCHING, and UNCERTAIN
 * refuse: "no safe carrier yet" can never be mistaken for "inserted".
 */
export async function mintInsertedOnAcceptance(
  deps: DeliveryTransportDependencies,
  input: {
    childThreadId: string;
    deliveredTo: string;
    dispatchFence?: RecordedDispatchFence;
    insertedMessageRef?: string;
    now?: number;
  }
): Promise<{ child: ChildWorkerRecord; delivery: ResultDeliveryRecord }> {
  const { child, resultRef } = await requireReturnableChild(deps, input.childThreadId);
  const submissionOperationId = childDeliveryOperationId({ parentThreadId: child.parentThreadId, childThreadId: child.childThreadId, resultRef });
  const operation = await deps.submissions.get(submissionOperationId);
  if (!operation) throw new Error(`delivery_transport_not_prepared:${submissionOperationId}`);
  if (operation.state !== "OBSERVED_ACCEPTED" && operation.state !== "COMPLETED") {
    throw new Error(`delivery_not_accepted:${operation.state}`);
  }
  // The transport must be this child's: even a hash-collided operation id
  // cannot mint a receipt for the wrong payload.
  if (operation.payloadFingerprint !== fingerprintSubmissionPayload(resultRef)) {
    throw new Error(`delivery_payload_mismatch:${submissionOperationId}`);
  }
  const updated = await deps.deliveries.recordInserted(
    resultDeliveryKey({ parentThreadId: child.parentThreadId, childThreadId: child.childThreadId, resultRef }),
    { deliveredTo: input.deliveredTo, dispatchFence: input.dispatchFence, insertedMessageRef: input.insertedMessageRef },
    input.now
  );
  return { child, delivery: updated };
}
