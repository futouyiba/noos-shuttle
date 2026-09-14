import { describe, expect, it } from "vitest";
import {
  DurableHarnessReducer,
  type HarnessReducerStore,
} from "../src/core/durable-harness-reducer";
import type { HarnessReducer, HarnessReducerState } from "../src/core/harness-reducer";

function memoryStore(): HarnessReducerStore & { saved: HarnessReducerState[] } {
  let current: HarnessReducerState | undefined;
  const saved: HarnessReducerState[] = [];
  return {
    load: async () => current,
    save: async state => { current = state; saved.push(state); },
    saved
  };
}

const commit = (logicalThreadId: string, providerConversationRef: string, now = 1) => (reducer: HarnessReducer) =>
  reducer.commitCurrentConversationBinding({ logicalThreadId, providerConversationRef, expected: null, actor: "system", now });

describe("durable harness reducer", () => {
  it("persists the post-state before committing it in memory", async () => {
    const store = memoryStore();
    const reducer = await DurableHarnessReducer.restore(store);
    const result = await reducer.applyResult(commit("t1", "c1"));
    expect(result.ok).toBe(true);
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0].bindings.t1).toMatchObject({ providerConversationRef: "c1" });
    expect(reducer.getBinding("t1")).toMatchObject({ providerConversationRef: "c1" });
  });

  it("does not persist a rejected mutation", async () => {
    const store = memoryStore();
    const reducer = await DurableHarnessReducer.restore(store);
    await reducer.applyResult(commit("t1", "c1"));
    const conflict = await reducer.applyResult(commit("t2", "c1"));
    expect(conflict.ok).toBe(false);
    expect(store.saved).toHaveLength(1);
    expect(reducer.getBinding("t2")).toBeUndefined();
  });

  it("leaves the in-memory state unchanged when persistence fails", async () => {
    const store: HarnessReducerStore = { load: async () => undefined, save: async () => { throw new Error("disk_full"); } };
    const reducer = await DurableHarnessReducer.restore(store);
    await expect(reducer.applyResult(commit("t1", "c1"))).rejects.toThrow("disk_full");
    // Crash-consistency: nothing is acknowledged that is not durable.
    expect(reducer.getBinding("t1")).toBeUndefined();
    expect(reducer.snapshot().bindings).toEqual({});
  });

  it("restores the persisted state on restart", async () => {
    const store = memoryStore();
    const first = await DurableHarnessReducer.restore(store);
    await first.applyResult(commit("t1", "c1"));
    const restarted = await DurableHarnessReducer.restore(store);
    expect(restarted.getBinding("t1")).toMatchObject({ providerConversationRef: "c1" });
  });

  it("refuses to restore corrupt persisted state", async () => {
    const store: HarnessReducerStore = {
      load: async () => ({ bindings: { t1: { logicalThreadId: "t1" } }, leases: {}, operations: {} }),
      save: async () => undefined
    };
    await expect(DurableHarnessReducer.restore(store)).rejects.toThrow();
  });

  it("serializes concurrent mutations so neither is lost", async () => {
    const store = memoryStore();
    const reducer = await DurableHarnessReducer.restore(store);
    await Promise.all([
      reducer.applyResult(commit("t1", "c1")),
      reducer.applyResult(commit("t2", "c2"))
    ]);
    expect(store.saved).toHaveLength(2);
    expect(reducer.getBinding("t1")).toBeDefined();
    expect(reducer.getBinding("t2")).toBeDefined();
    expect(store.saved[store.saved.length - 1].bindings).toHaveProperty("t1");
    expect(store.saved[store.saved.length - 1].bindings).toHaveProperty("t2");
  });
});
