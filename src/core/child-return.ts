/**
 * Composes the child worker lifecycle with the adjudicated delivery model
 * (lifecycle §§11-15 + child-result-delivery-idempotency-contract v0).
 *
 * The canonical transport is the caller's SubmissionOperation
 * (kind=DELIVER_CHILD_RESULT); this module drives the projection: create-or-get
 * the ResultDeliveryKey index, mint the INSERTED receipt only once the caller
 * presents OBSERVED_ACCEPTED evidence, complete the child, and mint COMPLETED
 * (which clears the parent mechanical wait). Waiting for a safe carrier leaves
 * an index row without a receipt — PREPARED != INSERTED. Retrying is
 * idempotent: the delivery is create-or-get and each child transition is
 * state-guarded.
 *
 * One return orchestrator per child is assumed. Two concurrent returns are
 * fail-safe — the loser gets a child transition conflict (its retry then takes
 * the idempotent path) — but the ledgers are not jointly atomic.
 */

import { ChildWorkerLedger, type ChildWorkerRecord } from "./child-worker";
import { ResultDeliveryLedger, type ResultDeliveryRecord, type RecordedDispatchFence } from "./result-delivery";

export interface ReturnDependencies {
  children: ChildWorkerLedger;
  deliveries: ResultDeliveryLedger;
}

export interface ReturnChildResultInput {
  childThreadId: string;
  /** Canonical SubmissionOperation(kind=DELIVER_CHILD_RESULT) owning the transport. */
  submissionOperationId: string;
  /**
   * Provider conversation ref proven by the transport's OBSERVED_ACCEPTED
   * evidence. Resolved by the caller from the canonical binding at dispatch
   * time — never from a raw tabId. This layer records it as given.
   */
  deliveredTo: string;
  dispatchFence?: RecordedDispatchFence;
  insertedMessageRef?: string;
  resultingParentTurnRef?: string;
  now?: number;
}

export interface ReturnChildResultOutcome {
  child: ChildWorkerRecord;
  delivery: ResultDeliveryRecord;
}

const RETURNABLE_STATES = new Set(["RESULT_READY", "RETURNING", "COMPLETED"]);

export async function returnChildResult(
  deps: ReturnDependencies,
  input: ReturnChildResultInput
): Promise<ReturnChildResultOutcome> {
  if (!input || typeof input.childThreadId !== "string" || typeof input.deliveredTo !== "string" || input.deliveredTo.trim().length === 0) {
    throw new Error("return_input_invalid");
  }
  const now = input.now ?? Date.now();
  let child = await deps.children.get(input.childThreadId);
  if (!child) throw new Error(`child_thread_not_found:${input.childThreadId}`);
  if (!RETURNABLE_STATES.has(child.state)) throw new Error(`child_not_returnable:${child.state}`);
  const resultRef = child.resultRef;
  if (!resultRef || !child.completionReceipt) throw new Error("child_result_not_ready");

  // Logical delivery index — safe to create before any transport progress; it
  // mints no receipt, so a PREPARED transport is not mistaken for INSERTED.
  let delivery = await deps.deliveries.createDelivery({
    submissionOperationId: input.submissionOperationId,
    parentThreadId: child.parentThreadId,
    childThreadId: child.childThreadId,
    workItemId: child.workItemId,
    resultRef,
    now
  });

  if (child.state === "RESULT_READY") {
    child = await deps.children.beginReturn(child.childThreadId, now);
  }
  // INSERTED: only on OBSERVED_ACCEPTED evidence; replay never re-inserts.
  delivery = await deps.deliveries.recordInserted(delivery.deliveryKey, {
    deliveredTo: input.deliveredTo,
    dispatchFence: input.dispatchFence,
    insertedMessageRef: input.insertedMessageRef
  }, now);
  if (child.state === "RETURNING") {
    child = await deps.children.complete(child.childThreadId, now);
  }
  // COMPLETED: the result-bearing parent turn finished; clears the mechanical wait.
  const completed = await deps.deliveries.completeDelivery(delivery.deliveryKey, {
    resultingParentTurnRef: input.resultingParentTurnRef
  }, now);
  return { child, delivery: completed };
}
