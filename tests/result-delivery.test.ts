import { describe, expect, it } from "vitest";
import {
  PARENT_WAITS_KEY,
  RESULT_DELIVERIES_KEY,
  ResultDeliveryLedger,
  createChromeResultDeliveryStore,
  isResultDeliveryRecord,
  resultDeliveryKey,
  type ResultDeliveryRecord,
  type ResultDeliveryStore,
} from "../src/core/result-delivery";

function memoryStore(): ResultDeliveryStore {
  const backing: Record<string, unknown> = {};
  return createChromeResultDeliveryStore({
    get: async (key: string) => ({ [key]: backing[key] }),
    set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
  });
}

const delivery = {
  submissionOperationId: "deliv-op-1",
  parentThreadId: "pdlt-l1",
  childThreadId: "child-l3",
  workItemId: "wi-1",
  resultRef: "report-1"
};

describe("result delivery index", () => {
  it("derives a deterministic ResultDeliveryKey", () => {
    expect(resultDeliveryKey(delivery)).toBe("pdlt-l1>child-l3>report-1");
  });

  it("create-or-get mints no receipt: waiting for a safe carrier is not INSERTED", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    const first = await ledger.createDelivery({ ...delivery, now: 100 });
    expect(first.receiptState).toBeUndefined();
    expect(first).toMatchObject({ submissionOperationId: "deliv-op-1", createdAt: 100 });
    const second = await ledger.createDelivery({ ...delivery, now: 200 });
    expect(second).toEqual(first);
    expect(await ledger.listDeliveries()).toHaveLength(1);
  });

  it("rejects a reuse of the same key under a different operation or work item", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await ledger.createDelivery(delivery);
    await expect(ledger.createDelivery({ ...delivery, submissionOperationId: "deliv-op-2" })).rejects.toThrow("delivery_reuse_conflict");
    await expect(ledger.createDelivery({ ...delivery, workItemId: "wi-other" })).rejects.toThrow("delivery_reuse_conflict");
  });

  it("rejects a delivery whose parent and child are the same thread", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await expect(ledger.createDelivery({ ...delivery, childThreadId: "pdlt-l1" })).rejects.toThrow("delivery_input_invalid");
  });

  it("serializes concurrent writes so both deliveries persist", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await Promise.all([
      ledger.createDelivery({ ...delivery, childThreadId: "child-a" }),
      ledger.createDelivery({ ...delivery, childThreadId: "child-b" })
    ]);
    expect(await ledger.listDeliveries()).toHaveLength(2);
  });
});

describe("ResultDeliveryReceipt (§9)", () => {
  it("mints INSERTED once and records the transport evidence", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await ledger.createDelivery(delivery);
    const fence = { providerConversationRef: "conv-l1c", bindingEpoch: 3, leaseGeneration: 2, leaseOwnerRef: "obs-1", targetCarrierRef: "browser-tab:5" };
    const inserted = await ledger.recordInserted("pdlt-l1>child-l3>report-1", { deliveredTo: "conv-l1c", dispatchFence: fence, insertedMessageRef: "msg-9" }, 500);
    expect(inserted).toMatchObject({ receiptState: "INSERTED", deliveredTo: "conv-l1c", insertedMessageRef: "msg-9", insertedAt: 500, dispatchFence: fence });
    // Replay never re-inserts or overwrites the evidence.
    const replay = await ledger.recordInserted("pdlt-l1>child-l3>report-1", { deliveredTo: "conv-other" }, 600);
    expect(replay).toEqual(inserted);
  });

  it("refuses to mint INSERTED for an unknown delivery", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await expect(ledger.recordInserted("nope", { deliveredTo: "conv" })).rejects.toThrow("delivery_not_found");
  });

  it("refuses COMPLETED before INSERTED (PREPARED is not COMPLETED)", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await ledger.createDelivery(delivery);
    await expect(ledger.completeDelivery("pdlt-l1>child-l3>report-1")).rejects.toThrow("delivery_not_inserted");
  });

  it("completes once with the resulting parent turn, then clears the parent wait", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await ledger.createDelivery(delivery);
    await ledger.setWait("pdlt-l1", { kind: "WAIT_REVIEW", childThreadId: "child-l3" });
    await ledger.recordInserted("pdlt-l1>child-l3>report-1", { deliveredTo: "conv-l1c" }, 500);
    const completed = await ledger.completeDelivery("pdlt-l1>child-l3>report-1", { resultingParentTurnRef: "turn-77" }, 800);
    expect(completed).toMatchObject({ receiptState: "COMPLETED", resultingParentTurnRef: "turn-77", completedAt: 800 });
    expect(await ledger.getWait("pdlt-l1")).toBeUndefined();
    const again = await ledger.completeDelivery("pdlt-l1>child-l3>report-1", { resultingParentTurnRef: "turn-other" }, 900);
    expect(again).toEqual(completed);
  });

  it("does not clear a wait that names a different child", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await ledger.setWait("pdlt-l1", { kind: "WAIT_WORKER", childThreadId: "child-other" });
    await ledger.createDelivery(delivery);
    await ledger.recordInserted("pdlt-l1>child-l3>report-1", { deliveredTo: "conv-l1c" });
    await ledger.completeDelivery("pdlt-l1>child-l3>report-1");
    expect(await ledger.getWait("pdlt-l1")).toMatchObject({ childThreadId: "child-other" });
  });
});

describe("parent mechanical wait (§12)", () => {
  it("sets one wait per parent thread and overwrites on re-entry", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await ledger.setWait("pdlt-l1", { kind: "WAIT_REVIEW", childThreadId: "child-l3" }, 10);
    await ledger.setWait("pdlt-l1", { kind: "WAIT_WORKER", childThreadId: "child-l2" }, 20);
    expect(await ledger.getWait("pdlt-l1")).toMatchObject({ kind: "WAIT_WORKER", childThreadId: "child-l2" });
  });

  it("rejects a self-referential or unknown-kind wait", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await expect(ledger.setWait("pdlt-l1", { kind: "WAIT_REVIEW", childThreadId: "pdlt-l1" })).rejects.toThrow("parent_wait_invalid");
    await expect(ledger.setWait("pdlt-l1", { kind: "WAIT_NOPE" as never, childThreadId: "child-l3" })).rejects.toThrow("parent_wait_invalid");
  });

  it("clears a wait by child id only when it matches", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await ledger.setWait("pdlt-l1", { kind: "WAIT_REVIEW", childThreadId: "child-l3" });
    expect(await ledger.clearWait("pdlt-l1", "child-other")).toBe(false);
    expect(await ledger.getWait("pdlt-l1")).toBeDefined();
    expect(await ledger.clearWait("pdlt-l1", "child-l3")).toBe(true);
    expect(await ledger.getWait("pdlt-l1")).toBeUndefined();
  });
});

describe("result delivery persistence", () => {
  it("survives a store round-trip and rejects malformed records", async () => {
    const store = memoryStore();
    const ledger = new ResultDeliveryLedger(store);
    await ledger.createDelivery(delivery);
    expect(await new ResultDeliveryLedger(store).getDelivery("pdlt-l1>child-l3>report-1"))
      .toMatchObject({ submissionOperationId: "deliv-op-1" });
    const base = { ...delivery, deliveryKey: "pdlt-l1>child-l3>report-1", createdAt: 1, updatedAt: 1 };
    // A receiptless record must carry no evidence fields.
    expect(isResultDeliveryRecord({ ...base, insertedAt: 2, deliveredTo: "conv" })).toBe(false);
    // INSERTED requires insertion evidence.
    expect(isResultDeliveryRecord({ ...base, receiptState: "INSERTED" })).toBe(false);
    expect(isResultDeliveryRecord({ ...base, receiptState: "INSERTED", insertedAt: 2, deliveredTo: "conv" })).toBe(true);
    // COMPLETED requires INSERTED evidence plus completion.
    expect(isResultDeliveryRecord({ ...base, receiptState: "COMPLETED", insertedAt: 2, deliveredTo: "conv" })).toBe(false);
    expect(isResultDeliveryRecord({ ...base, receiptState: "COMPLETED", insertedAt: 2, deliveredTo: "conv", completedAt: 3 })).toBe(true);
  });

  it("ignores corrupted array entries", async () => {
    const store = memoryStore();
    await store.set({ [RESULT_DELIVERIES_KEY]: [{ deliveryKey: "bad" }], [PARENT_WAITS_KEY]: [{ parentThreadId: "x" }] });
    const ledger = new ResultDeliveryLedger(store);
    expect(await ledger.listDeliveries()).toEqual([]);
    expect(await ledger.getWait("x")).toBeUndefined();
  });
});
