/**
 * Composes the child worker lifecycle with durable result delivery into the
 * RETURNING path (§11-§13, §15).
 *
 * A child that reached RESULT_READY routes its result to the parent Logical
 * Thread; only after that delivery completes is the child marked COMPLETED.
 * Routing is by parent thread with the destination resolved at delivery time,
 * so it stays correct across parent rollover, and delivery is not semantic
 * acceptance. Retrying is idempotent: the delivery is create-or-get and each
 * child transition is guarded by the current state.
 */

import { ChildWorkerLedger, type ChildWorkerRecord } from "./child-worker";
import { ResultDeliveryLedger, type ResultDeliveryRecord } from "./result-delivery";

export interface ReturnDependencies {
  children: ChildWorkerLedger;
  deliveries: ResultDeliveryLedger;
}

export interface ReturnChildResultInput {
  childThreadId: string;
  /** Parent provider conversation resolved at delivery time (§11); never a raw tabId. */
  deliveredTo: string;
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
  const completionReceipt = child.completionReceipt;
  if (!resultRef || !completionReceipt) throw new Error("child_result_not_ready");

  const delivery = await deps.deliveries.createDelivery({
    parentThreadId: child.parentThreadId,
    childThreadId: child.childThreadId,
    workItemId: child.workItemId,
    resultRef,
    now
  });

  if (child.state === "RESULT_READY") {
    child = await deps.children.beginReturn(child.childThreadId, now);
  }
  const completed = await deps.deliveries.completeDelivery(delivery.deliveryKey, {
    deliveredTo: input.deliveredTo,
    completionReceipt
  }, now);
  if (child.state === "RETURNING") {
    child = await deps.children.complete(child.childThreadId, now);
  }
  return { child, delivery: completed };
}
