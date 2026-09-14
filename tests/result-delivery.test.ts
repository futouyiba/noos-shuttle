import { describe, expect, it } from "vitest";
import {
  PARENT_WAITS_KEY,
  RESULT_DELIVERIES_KEY,
  ResultDeliveryLedger,
  createChromeResultDeliveryStore,
  isResultDeliveryRecord,
  resultDeliveryKey,
  type ResultDeliveryStore,
} from "../src/core/result-delivery";

function memoryStore(): ResultDeliveryStore {
  const backing: Record<string, unknown> = {};
  return createChromeResultDeliveryStore({
    get: async (key: string) => ({ [key]: backing[key] }),
    set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
  });
}

const delivery = { parentThreadId: "pdlt-l1", childThreadId: "child-l3", workItemId: "wi-1", resultRef: "report-1" };

describe("result delivery", () => {
  it("derives a deterministic ResultDeliveryKey", () => {
    expect(resultDeliveryKey(delivery)).toBe("pdlt-l1>child-l3>report-1");
  });

  it("persists INSERTED before transport and is create-or-get idempotent", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    const first = await ledger.createDelivery({ ...delivery, now: 100 });
    expect(first).toMatchObject({ state: "INSERTED", createdAt: 100, deliveryKey: "pdlt-l1>child-l3>report-1" });
    const second = await ledger.createDelivery({ ...delivery, now: 200 });
    expect(second).toEqual(first);
    expect(await ledger.listDeliveries()).toHaveLength(1);
  });

  it("rejects a delivery whose parent and child are the same thread", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await expect(ledger.createDelivery({ ...delivery, childThreadId: "pdlt-l1" })).rejects.toThrow("delivery_input_invalid");
  });

  it("rejects a reuse of the same key under a different work item", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await ledger.createDelivery(delivery);
    await expect(ledger.createDelivery({ ...delivery, workItemId: "wi-other" })).rejects.toThrow("delivery_reuse_conflict");
  });

  it("serializes concurrent writes so both deliveries persist", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await Promise.all([
      ledger.createDelivery({ ...delivery, childThreadId: "child-a" }),
      ledger.createDelivery({ ...delivery, childThreadId: "child-b" })
    ]);
    expect(await ledger.listDeliveries()).toHaveLength(2);
  });

  it("completes a delivery once and records the delivery-time destination", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await ledger.createDelivery(delivery);
    const completed = await ledger.completeDelivery("pdlt-l1>child-l3>report-1", { deliveredTo: "conv-l1c", completionReceipt: "rcpt-9" }, 500);
    expect(completed).toMatchObject({ state: "COMPLETED", deliveredTo: "conv-l1c", completionReceipt: "rcpt-9", deliveredAt: 500 });
    // Idempotent: completing again returns the same record without a new destination.
    const again = await ledger.completeDelivery("pdlt-l1>child-l3>report-1", { deliveredTo: "conv-other", completionReceipt: "rcpt-again" }, 600);
    expect(again).toEqual(completed);
  });

  it("reports a missing delivery", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await expect(ledger.completeDelivery("nope", { deliveredTo: "conv", completionReceipt: "r" })).rejects.toThrow("delivery_not_found");
  });
});

describe("parent mechanical wait (§13)", () => {
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

  it("clears the parent wait when the expected child's result is delivered", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await ledger.setWait("pdlt-l1", { kind: "WAIT_REVIEW", childThreadId: "child-l3" });
    await ledger.createDelivery(delivery);
    await ledger.completeDelivery("pdlt-l1>child-l3>report-1", { deliveredTo: "conv-l1c", completionReceipt: "rcpt-9" });
    expect(await ledger.getWait("pdlt-l1")).toBeUndefined();
  });

  it("does not clear a wait that names a different child", async () => {
    const ledger = new ResultDeliveryLedger(memoryStore());
    await ledger.setWait("pdlt-l1", { kind: "WAIT_WORKER", childThreadId: "child-other" });
    await ledger.createDelivery(delivery);
    await ledger.completeDelivery("pdlt-l1>child-l3>report-1", { deliveredTo: "conv-l1c", completionReceipt: "rcpt-9" });
    expect(await ledger.getWait("pdlt-l1")).toMatchObject({ childThreadId: "child-other" });
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
    expect(await new ResultDeliveryLedger(store).getDelivery("pdlt-l1>child-l3>report-1")).toMatchObject({ state: "INSERTED" });
    // A COMPLETED record without a delivery destination is malformed.
    expect(isResultDeliveryRecord({
      ...delivery, deliveryKey: "k", state: "COMPLETED", createdAt: 1, updatedAt: 1
    })).toBe(false);
    expect(isResultDeliveryRecord({
      ...delivery, deliveryKey: "k", state: "COMPLETED", createdAt: 1, updatedAt: 1,
      deliveredTo: "conv", deliveredAt: 2, completionReceipt: "r"
    })).toBe(true);
    expect(isResultDeliveryRecord({
      ...delivery, deliveryKey: "k", state: "INSERTED", createdAt: 1, updatedAt: 1
    })).toBe(true);
    // An INSERTED record must not carry delivery fields.
    expect(isResultDeliveryRecord({
      ...delivery, deliveryKey: "k", state: "INSERTED", createdAt: 1, updatedAt: 1,
      deliveredTo: "conv", deliveredAt: 2, completionReceipt: "r"
    })).toBe(false);
  });

  it("ignores corrupted array entries", async () => {
    const store = memoryStore();
    await store.set({ [RESULT_DELIVERIES_KEY]: [{ deliveryKey: "bad" }], [PARENT_WAITS_KEY]: [{ parentThreadId: "x" }] });
    const ledger = new ResultDeliveryLedger(store);
    expect(await ledger.listDeliveries()).toEqual([]);
    expect(await ledger.getWait("x")).toBeUndefined();
  });
});
