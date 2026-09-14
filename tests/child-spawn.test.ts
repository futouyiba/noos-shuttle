import { describe, expect, it } from "vitest";
import { ChildWorkerLedger, createChromeChildWorkerStore } from "../src/core/child-worker";
import { SpawnUncertainError, spawnChildWorker, reconcileChildSpawn, type SpawnAdapter } from "../src/core/child-spawn";

function harness(adapter: SpawnAdapter) {
  const backing: Record<string, unknown> = {};
  const children = new ChildWorkerLedger(createChromeChildWorkerStore({
    get: async (key: string) => ({ [key]: backing[key] }),
    set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
  }));
  return { children, adapter };
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

describe("spawn child worker", () => {
  it("drives PLANNED to ACTIVE through the provider spawn", async () => {
    let calls = 0;
    const adapter: SpawnAdapter = { spawn: async () => { calls += 1; return { providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" }; } };
    const { children } = harness(adapter);
    const child = await spawnChildWorker({ children, adapter }, intent);
    expect(child).toMatchObject({ state: "ACTIVE", providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" });
    expect(calls).toBe(1);
  });

  it("is idempotent: a re-run after success returns the child without spawning again", async () => {
    let calls = 0;
    const adapter: SpawnAdapter = { spawn: async () => { calls += 1; return { providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" }; } };
    const { children } = harness(adapter);
    await spawnChildWorker({ children, adapter }, intent);
    const again = await spawnChildWorker({ children, adapter }, intent);
    expect(again.state).toBe("ACTIVE");
    expect(calls).toBe(1);
    expect(await children.list()).toHaveLength(1);
  });

  it("marks the child SPAWN_UNCERTAIN when the acknowledgement is lost, and refuses a blind re-spawn", async () => {
    let calls = 0;
    const adapter: SpawnAdapter = { spawn: async () => { calls += 1; throw new SpawnUncertainError(); } };
    const { children } = harness(adapter);
    await expect(spawnChildWorker({ children, adapter }, intent)).rejects.toBeInstanceOf(SpawnUncertainError);
    expect((await children.get("child-l2"))?.state).toBe("SPAWN_UNCERTAIN");
    expect(calls).toBe(1);
    await expect(spawnChildWorker({ children, adapter }, intent)).rejects.toThrow("spawn_not_resumable:SPAWN_UNCERTAIN");
    expect(calls).toBe(1);
  });

  it("propagates a definite spawn failure without transitioning the child", async () => {
    const adapter: SpawnAdapter = { spawn: async () => { throw new Error("fork_denied"); } };
    const { children } = harness(adapter);
    await expect(spawnChildWorker({ children, adapter }, intent)).rejects.toThrow("fork_denied");
    expect((await children.get("child-l2"))?.state).toBe("SPAWNING");
  });

  it("binds a recovered conversation and activates after reconciliation", async () => {
    const adapter: SpawnAdapter = { spawn: async () => { throw new SpawnUncertainError(); } };
    const { children } = harness(adapter);
    await expect(spawnChildWorker({ children, adapter }, intent)).rejects.toBeInstanceOf(SpawnUncertainError);

    const rebound = await reconcileChildSpawn({ children, adapter }, "child-l2", { providerConversationRef: "conv-recovered", carrierRef: "browser-tab:9" });
    expect(rebound.state).toBe("BOOTSTRAPPING");
    const active = await spawnChildWorker({ children, adapter }, intent);
    expect(active).toMatchObject({ state: "ACTIVE", providerConversationRef: "conv-recovered" });
    expect(await children.list()).toHaveLength(1);
  });

  it("cancels only when non-creation is proven", async () => {
    const adapter: SpawnAdapter = { spawn: async () => { throw new SpawnUncertainError(); } };
    const { children } = harness(adapter);
    await expect(spawnChildWorker({ children, adapter }, intent)).rejects.toBeInstanceOf(SpawnUncertainError);
    const cancelled = await reconcileChildSpawn({ children, adapter }, "child-l2");
    expect(cancelled.state).toBe("CANCELLED");
  });

  it("refuses to cancel a child that is not uncertain", async () => {
    const adapter: SpawnAdapter = { spawn: async () => ({ providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" }) };
    const { children } = harness(adapter);
    await spawnChildWorker({ children, adapter }, intent);
    await expect(reconcileChildSpawn({ children, adapter }, "child-l2")).rejects.toThrow("spawn_reconcile_requires_uncertain:ACTIVE");
  });
});
