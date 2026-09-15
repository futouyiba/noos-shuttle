import { describe, expect, it } from "vitest";
import { ChildWorkerLedger, createChromeChildWorkerStore } from "../src/core/child-worker";
import { ResultDeliveryLedger, createChromeResultDeliveryStore, resultDeliveryKey, type ResultDeliveryRecord } from "../src/core/result-delivery";
import { returnChildResult } from "../src/core/child-return";

class ThrowingDelivery extends ResultDeliveryLedger {
  override async recordInserted(): Promise<ResultDeliveryRecord> {
    throw new Error("transport_failed");
  }
}

function harness() {
  const backing: Record<string, unknown> = {};
  const chromeStorage = {
    get: async (key: string) => ({ [key]: backing[key] }),
    set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
  };
  const children = new ChildWorkerLedger(createChromeChildWorkerStore(chromeStorage));
  const deliveries = new ResultDeliveryLedger(createChromeResultDeliveryStore(chromeStorage));
  return { children, deliveries, chromeStorage };
}

const intent = {
  childThreadId: "child-l2",
  parentThreadId: "pdlt-l1",
  workItemId: "wi-1",
  role: "Sedimentation / Memory Curator",
  creationMode: "FORKED" as const,
  contextSource: "PROVIDER_INHERITED" as const,
  contextFidelity: "PROVIDER_INHERITANCE_REQUIRED" as const,
  operationGoal: "preserve missing durable reasoning",
  operationScope: "do not continue the main design trajectory",
  returnRoute: "thread:pdlt-l1"
};
const transport = { submissionOperationId: "deliv-op-1", deliveredTo: "conv-l1c" };

async function readyChild(children: ChildWorkerLedger) {
  await children.createIntent(intent);
  await children.beginSpawn("child-l2");
  await children.bindConversation("child-l2", { providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" });
  await children.activate("child-l2");
  await children.recordResult("child-l2", { resultRef: "docs/memory.md", completionReceipt: "rcpt-1" });
}

describe("return child result", () => {
  it("routes the result to the parent thread and completes the child", async () => {
    const { children, deliveries } = harness();
    await readyChild(children);
    await deliveries.setWait("pdlt-l1", { kind: "WAIT_WORKER", childThreadId: "child-l2" }, 5);

    const outcome = await returnChildResult({ children, deliveries }, { ...transport, childThreadId: "child-l2", now: 100 });

    expect(outcome.child.state).toBe("COMPLETED");
    expect(outcome.delivery).toMatchObject({
      receiptState: "COMPLETED", submissionOperationId: "deliv-op-1", deliveredTo: "conv-l1c"
    });
    expect(await deliveries.getWait("pdlt-l1")).toBeUndefined();
  });

  it("keeps the delivery receiptless while the transport waits for a safe carrier", async () => {
    const { children, deliveries } = harness();
    await readyChild(children);
    // Transport is PREPARED and no carrier has been resolved: the index exists,
    // but no INSERTED receipt and the child keeps its result.
    const indexOnly = await deliveries.createDelivery({
      submissionOperationId: "deliv-op-1", parentThreadId: "pdlt-l1",
      childThreadId: "child-l2", workItemId: "wi-1", resultRef: "docs/memory.md"
    });
    expect(indexOnly.receiptState).toBeUndefined();
    expect((await children.get("child-l2"))?.state).toBe("RESULT_READY");
    expect(await deliveries.listDeliveries()).toHaveLength(1);

    // The delivery completes normally once the transport gets its evidence.
    const outcome = await returnChildResult({ children, deliveries }, { ...transport, childThreadId: "child-l2", now: 100 });
    expect(outcome.delivery.receiptState).toBe("COMPLETED");
    expect(await deliveries.listDeliveries()).toHaveLength(1);
  });

  it("refuses a child that has not produced a result", async () => {
    const { children, deliveries } = harness();
    await children.createIntent(intent);
    await children.beginSpawn("child-l2");
    await children.bindConversation("child-l2", { providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" });
    await children.activate("child-l2");
    await expect(returnChildResult({ children, deliveries }, { ...transport, childThreadId: "child-l2" }))
      .rejects.toThrow("child_not_returnable:ACTIVE");
  });

  it("reports an unknown child and rejects an empty destination", async () => {
    const { children, deliveries } = harness();
    await expect(returnChildResult({ children, deliveries }, { ...transport, childThreadId: "nope" }))
      .rejects.toThrow("child_thread_not_found");
    await readyChild(children);
    await expect(returnChildResult({ children, deliveries }, { ...transport, childThreadId: "child-l2", deliveredTo: "  " }))
      .rejects.toThrow("return_input_invalid");
  });

  it("is idempotent on retry", async () => {
    const { children, deliveries } = harness();
    await readyChild(children);
    const first = await returnChildResult({ children, deliveries }, { ...transport, childThreadId: "child-l2", now: 100 });
    const retry = await returnChildResult({ children, deliveries }, { ...transport, childThreadId: "child-l2", now: 200 });
    expect(retry.child.state).toBe("COMPLETED");
    expect(retry.delivery.deliveryKey).toBe(first.delivery.deliveryKey);
    expect(await deliveries.listDeliveries()).toHaveLength(1);
  });

  it("does not mint INSERTED when the transport evidence fails (§15 order)", async () => {
    const { children, deliveries, chromeStorage } = harness();
    await readyChild(children);
    const throwing = new ThrowingDelivery(createChromeResultDeliveryStore(chromeStorage));
    await expect(returnChildResult({ children, deliveries: throwing }, { ...transport, childThreadId: "child-l2" }))
      .rejects.toThrow("transport_failed");
    // No insertion evidence, so the child must not be COMPLETED.
    expect((await children.get("child-l2"))?.state).toBe("RETURNING");
    expect((await deliveries.getDelivery(resultDeliveryKey({ parentThreadId: "pdlt-l1", childThreadId: "child-l2", resultRef: "docs/memory.md" })))?.receiptState).toBeUndefined();
  });

  it("resumes when the receipt was inserted but the child had not completed", async () => {
    const { children, deliveries } = harness();
    await readyChild(children);
    await deliveries.createDelivery({ ...deliveryFields(), submissionOperationId: "deliv-op-1" });
    await children.beginReturn("child-l2");
    await deliveries.recordInserted(
      resultDeliveryKey({ parentThreadId: "pdlt-l1", childThreadId: "child-l2", resultRef: "docs/memory.md" }),
      { deliveredTo: "conv-l1c" }
    );

    const outcome = await returnChildResult({ children, deliveries }, { ...transport, childThreadId: "child-l2", now: 400 });
    expect(outcome.child.state).toBe("COMPLETED");
    expect(outcome.delivery).toMatchObject({ receiptState: "COMPLETED", deliveredTo: "conv-l1c" });
    expect(await deliveries.listDeliveries()).toHaveLength(1);
  });
});

function deliveryFields() {
  return { parentThreadId: "pdlt-l1", childThreadId: "child-l2", workItemId: "wi-1", resultRef: "docs/memory.md" };
}
