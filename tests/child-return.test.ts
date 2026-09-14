import { describe, expect, it } from "vitest";
import { ChildWorkerLedger, createChromeChildWorkerStore } from "../src/core/child-worker";
import { ResultDeliveryLedger, createChromeResultDeliveryStore } from "../src/core/result-delivery";
import { returnChildResult } from "../src/core/child-return";

function harness() {
  const backing: Record<string, unknown> = {};
  const chromeStorage = {
    get: async (key: string) => ({ [key]: backing[key] }),
    set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
  };
  const children = new ChildWorkerLedger(createChromeChildWorkerStore(chromeStorage));
  const deliveries = new ResultDeliveryLedger(createChromeResultDeliveryStore(chromeStorage));
  return { children, deliveries };
}

const intent = {
  childThreadId: "child-l2",
  parentThreadId: "pdlt-l1",
  workItemId: "wi-1",
  role: "Sedimentation / Memory Curator",
  creationMode: "FORKED" as const,
  operationGoal: "preserve missing durable reasoning",
  operationScope: "do not continue the main design trajectory",
  returnRoute: "thread:pdlt-l1"
};

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

    const outcome = await returnChildResult({ children, deliveries }, { childThreadId: "child-l2", deliveredTo: "conv-l1c", now: 100 });

    expect(outcome.child.state).toBe("COMPLETED");
    expect(outcome.delivery).toMatchObject({ state: "COMPLETED", deliveredTo: "conv-l1c", completionReceipt: "rcpt-1" });
    expect(await deliveries.getWait("pdlt-l1")).toBeUndefined();
  });

  it("refuses a child that has not produced a result", async () => {
    const { children, deliveries } = harness();
    await children.createIntent(intent);
    await children.beginSpawn("child-l2");
    await children.bindConversation("child-l2", { providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" });
    await children.activate("child-l2");
    await expect(returnChildResult({ children, deliveries }, { childThreadId: "child-l2", deliveredTo: "conv-l1c" }))
      .rejects.toThrow("child_not_returnable:ACTIVE");
  });

  it("reports an unknown child", async () => {
    const { children, deliveries } = harness();
    await expect(returnChildResult({ children, deliveries }, { childThreadId: "nope", deliveredTo: "conv" }))
      .rejects.toThrow("child_thread_not_found");
  });

  it("rejects an empty delivery destination", async () => {
    const { children, deliveries } = harness();
    await readyChild(children);
    await expect(returnChildResult({ children, deliveries }, { childThreadId: "child-l2", deliveredTo: "  " }))
      .rejects.toThrow("return_input_invalid");
  });

  it("is idempotent on retry", async () => {
    const { children, deliveries } = harness();
    await readyChild(children);
    const first = await returnChildResult({ children, deliveries }, { childThreadId: "child-l2", deliveredTo: "conv-l1c", now: 100 });
    const retry = await returnChildResult({ children, deliveries }, { childThreadId: "child-l2", deliveredTo: "conv-l1c", now: 200 });
    expect(retry.child.state).toBe("COMPLETED");
    expect(retry.delivery.deliveryKey).toBe(first.delivery.deliveryKey);
    expect(await deliveries.listDeliveries()).toHaveLength(1);
  });

  it("resumes after the delivery was inserted but the child had not completed", async () => {
    const { children, deliveries } = harness();
    await readyChild(children);
    // A prior attempt got as far as INSERTED + RETURNING before crashing.
    await deliveries.createDelivery({ parentThreadId: "pdlt-l1", childThreadId: "child-l2", workItemId: "wi-1", resultRef: "docs/memory.md" });
    await children.beginReturn("child-l2");

    const outcome = await returnChildResult({ children, deliveries }, { childThreadId: "child-l2", deliveredTo: "conv-l1c", now: 300 });
    expect(outcome.child.state).toBe("COMPLETED");
    expect(outcome.delivery.state).toBe("COMPLETED");
    expect(await deliveries.listDeliveries()).toHaveLength(1);
  });
});
