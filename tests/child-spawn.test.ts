import { describe, expect, it } from "vitest";
import { ChildWorkerLedger, createChromeChildWorkerStore, type ChildWorkerRecord } from "../src/core/child-worker";
import { SpawnUncertainError, spawnChildWorker, reconcileChildSpawn, type SpawnAdapter, type SpawnAdapterCapabilities } from "../src/core/child-spawn";

function makeChildren() {
  const backing: Record<string, unknown> = {};
  return new ChildWorkerLedger(createChromeChildWorkerStore({
    get: async (key: string) => ({ [key]: backing[key] }),
    set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
  }));
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

const NATIVE_FORK_CAPS = { supportsNativeFork: true, transcriptExportAvailable: true } as const;

function countingAdapter(
  outcome: () => Promise<{ providerConversationRef: string; carrierRef: string }>,
  capabilities: SpawnAdapterCapabilities = NATIVE_FORK_CAPS
): SpawnAdapter & { calls: number } {
  const adapter = {
    calls: 0,
    capabilities: () => capabilities,
    spawn: async (child: ChildWorkerRecord) => { adapter.calls += 1; return outcome(); }
  };
  return adapter;
}

function overrideMethod<T extends object, K extends keyof T>(target: T, method: K, implementation: unknown): T {
  const shadow = Object.create(target);
  Object.defineProperty(shadow, method, { value: implementation });
  return shadow;
}

describe("spawn child worker", () => {
  it("drives PLANNED to ACTIVE through the provider spawn", async () => {
    const children = makeChildren();
    const adapter = countingAdapter(async () => ({ providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" }));
    const child = await spawnChildWorker({ children, adapter }, intent);
    expect(child).toMatchObject({ state: "ACTIVE", providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" });
    expect(adapter.calls).toBe(1);
  });

  it("is idempotent: a re-run after success returns the child without spawning again", async () => {
    const children = makeChildren();
    const adapter = countingAdapter(async () => ({ providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" }));
    await spawnChildWorker({ children, adapter }, intent);
    const again = await spawnChildWorker({ children, adapter }, intent);
    expect(again.state).toBe("ACTIVE");
    expect(adapter.calls).toBe(1);
    expect(await children.list()).toHaveLength(1);
  });

  it("marks the child SPAWN_UNCERTAIN when the acknowledgement is lost, and refuses a blind re-spawn", async () => {
    const children = makeChildren();
    const adapter = countingAdapter(async () => { throw new SpawnUncertainError(); });
    await expect(spawnChildWorker({ children, adapter }, intent)).rejects.toBeInstanceOf(SpawnUncertainError);
    expect((await children.get("child-l2"))?.state).toBe("SPAWN_UNCERTAIN");
    expect(adapter.calls).toBe(1);
    await expect(spawnChildWorker({ children, adapter }, intent)).rejects.toThrow("spawn_not_resumable:SPAWN_UNCERTAIN");
    expect(adapter.calls).toBe(1);
  });

  it("refuses to re-spawn a child stuck in SPAWNING after a crash or definite failure (§16)", async () => {
    const children = makeChildren();
    // Crash window: the record is durable in SPAWNING and no new process may
    // assume the outcome — recovery must reconcile first.
    await children.createIntent(intent);
    await children.beginSpawn("child-l2");
    const adapter = countingAdapter(async () => ({ providerConversationRef: "conv-second", carrierRef: "browser-tab:8" }));
    await expect(spawnChildWorker({ children, adapter }, intent)).rejects.toThrow("spawn_not_resumable:SPAWNING");
    expect(adapter.calls).toBe(0);

    // Definite-failure window on a fresh child: the child stays SPAWNING and a
    // re-entry is refused too.
    const failing = countingAdapter(async () => { throw new Error("fork_denied"); });
    const other = { ...intent, childThreadId: "child-l3" };
    await expect(spawnChildWorker({ children, adapter: failing }, other)).rejects.toThrow("fork_denied");
    await expect(spawnChildWorker({ children, adapter: failing }, other)).rejects.toThrow("spawn_not_resumable:SPAWNING");
    expect(failing.calls).toBe(1);
  });

  it("parks the child as uncertain when the bind write fails after creation, and recovery rebinds", async () => {
    const children = makeChildren();
    const adapter = countingAdapter(async () => ({ providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" }));
    const breaking = overrideMethod(children, "bindConversation", async () => { throw new Error("storage_full"); });
    await expect(spawnChildWorker({ children: breaking, adapter }, intent)).rejects.toThrow("storage_full");
    expect(adapter.calls).toBe(1);
    expect((await children.get("child-l2"))?.state).toBe("SPAWN_UNCERTAIN");

    // The conversation exists; recovery rebinds it and never spawns again.
    const rebound = await reconcileChildSpawn(children, "child-l2", { providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" });
    expect(rebound.state).toBe("BOOTSTRAPPING");
    const active = await spawnChildWorker({ children, adapter }, intent);
    expect(active).toMatchObject({ state: "ACTIVE", providerConversationRef: "conv-l2" });
    expect(adapter.calls).toBe(1);
  });

  it("spawns concurrently without a second adapter call", async () => {
    const children = makeChildren();
    const adapter = countingAdapter(async () => ({ providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" }));
    const attempts: Array<Promise<unknown>> = [
      spawnChildWorker({ children, adapter }, intent),
      spawnChildWorker({ children, adapter }, intent)
    ];
    const outcomes = await Promise.allSettled(attempts);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(adapter.calls).toBe(1);
    expect((await children.get("child-l2"))?.state).toBe("ACTIVE");
    expect(await children.list()).toHaveLength(1);
  });

  it("binds a recovered conversation and activates after reconciliation", async () => {
    const children = makeChildren();
    const adapter = countingAdapter(async () => { throw new SpawnUncertainError(); });
    await expect(spawnChildWorker({ children, adapter }, intent)).rejects.toBeInstanceOf(SpawnUncertainError);
    expect(adapter.calls).toBe(1);

    const rebound = await reconcileChildSpawn(children, "child-l2", { providerConversationRef: "conv-recovered", carrierRef: "browser-tab:9" });
    expect(rebound.state).toBe("BOOTSTRAPPING");
    const active = await spawnChildWorker({ children, adapter }, intent);
    expect(active).toMatchObject({ state: "ACTIVE", providerConversationRef: "conv-recovered" });
    expect(adapter.calls).toBe(1);
    expect(await children.list()).toHaveLength(1);
  });

  it("cancels only when non-creation is proven", async () => {
    const children = makeChildren();
    const adapter = countingAdapter(async () => { throw new SpawnUncertainError(); });
    await expect(spawnChildWorker({ children, adapter }, intent)).rejects.toBeInstanceOf(SpawnUncertainError);
    const cancelled = await reconcileChildSpawn(children, "child-l2");
    expect(cancelled.state).toBe("CANCELLED");
  });

  it("refuses FORKED spawn when the adapter reports no native fork (NEEDS_HUMAN, no silent fallback)", async () => {
    const children = makeChildren();
    const adapter = countingAdapter(async () => ({ providerConversationRef: "conv-x", carrierRef: "tab-x" }), { supportsNativeFork: false, transcriptExportAvailable: true } as const);
    await expect(spawnChildWorker({ children, adapter }, intent)).rejects.toThrow("spawn_needs_human:native_fork_unavailable");
    // Nothing was spawned and the intent stays PLANNED for a human decision.
    expect(adapter.calls).toBe(0);
    expect((await children.get("child-l2"))?.state).toBe("PLANNED");
  });

  it("refuses a Sedimentation child whose fidelity is not satisfied by the context source", async () => {
    const children = makeChildren();
    const adapter = countingAdapter(async () => ({ providerConversationRef: "conv-x", carrierRef: "tab-x" }));
    // FRESH + durable pack can never relabel as inherited (adjudication D2, provenance is never relabeled).
    await expect(spawnChildWorker({ children, adapter }, {
      ...intent, creationMode: "FRESH" as const, contextSource: "DURABLE_CONTEXT_PACK" as const
    })).rejects.toThrow("spawn_needs_human:provider_inheritance_unsatisfied");
    expect(adapter.calls).toBe(0);
  });

  it("refuses transcript-reconstruction fidelity without export capability", async () => {
    const children = makeChildren();
    const adapter = countingAdapter(async () => ({ providerConversationRef: "conv-t", carrierRef: "tab-t" }), { supportsNativeFork: false, transcriptExportAvailable: false } as const);
    await expect(spawnChildWorker({ children, adapter }, {
      ...intent, creationMode: "FRESH" as const,
      contextSource: "TRANSCRIPT_RECONSTRUCTION" as const, contextFidelity: "TRANSCRIPT_RECONSTRUCTION_REQUIRED" as const
    })).rejects.toThrow("spawn_needs_human:transcript_export_unavailable");
    expect(adapter.calls).toBe(0);
  });

  it("refuses durable-context sufficiency met only by a minimal bootstrap", async () => {
    const children = makeChildren();
    const adapter = countingAdapter(async () => ({ providerConversationRef: "conv-m", carrierRef: "tab-m" }));
    await expect(spawnChildWorker({ children, adapter }, {
      ...intent, creationMode: "FRESH" as const,
      contextSource: "MINIMAL_BOOTSTRAP" as const, contextFidelity: "DURABLE_CONTEXT_SUFFICIENT" as const
    })).rejects.toThrow("spawn_needs_human:durable_context_unsatisfied");
    expect(adapter.calls).toBe(0);
  });

  it("exempts provider inheritance from the transcript-export capability", async () => {
    const children = makeChildren();
    // FORKED + PROVIDER_INHERITED satisfies reconstruction fidelity without a
    // transcript export: inheritance is a superset of reconstruction.
    const adapter = countingAdapter(async () => ({ providerConversationRef: "conv-f", carrierRef: "tab-f" }), { supportsNativeFork: true, transcriptExportAvailable: false } as const);
    const child = await spawnChildWorker({ children, adapter }, {
      ...intent, contextSource: "PROVIDER_INHERITED" as const, contextFidelity: "TRANSCRIPT_RECONSTRUCTION_REQUIRED" as const
    });
    expect(child.state).toBe("ACTIVE");
    expect(adapter.calls).toBe(1);
  });

  it("allows a FRESH reviewer with independent fidelity and minimal bootstrap", async () => {
    const children = makeChildren();
    const adapter = countingAdapter(async () => ({ providerConversationRef: "conv-r", carrierRef: "tab-r" }), { supportsNativeFork: false, transcriptExportAvailable: false } as const);
    const child = await spawnChildWorker({ children, adapter }, {
      ...intent, childThreadId: "child-l3", creationMode: "FRESH" as const,
      contextSource: "MINIMAL_BOOTSTRAP" as const, contextFidelity: "INDEPENDENT" as const
    });
    expect(child.state).toBe("ACTIVE");
    expect(adapter.calls).toBe(1);
  });

  it("refuses to cancel a child that is not reconcilable", async () => {
    const children = makeChildren();
    const adapter = countingAdapter(async () => ({ providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" }));
    await spawnChildWorker({ children, adapter }, intent);
    await expect(reconcileChildSpawn(children, "child-l2")).rejects.toThrow("spawn_reconcile_requires_uncertain:ACTIVE");
  });

  it("keeps serving after a parking failure by preserving the original signal", async () => {
    const children = makeChildren();
    const adapter = countingAdapter(async () => { throw new SpawnUncertainError(); });
    const broken = overrideMethod(children, "markSpawnUncertain", async () => { throw new Error("park_failed"); });
    await expect(spawnChildWorker({ children: broken, adapter }, intent)).rejects.toBeInstanceOf(SpawnUncertainError);
    expect((await children.get("child-l2"))?.state).toBe("SPAWNING");
    await expect(spawnChildWorker({ children, adapter }, intent)).rejects.toThrow("spawn_not_resumable:SPAWNING");
    expect(adapter.calls).toBe(1);
  });
});
