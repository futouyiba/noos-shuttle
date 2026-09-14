import { describe, expect, it } from "vitest";
import {
  CHILD_WORKERS_KEY,
  ChildWorkerLedger,
  createChromeChildWorkerStore,
  isChildWorkerRecord,
  type ChildWorkerStore,
} from "../src/core/child-worker";

function memoryStore(): ChildWorkerStore {
  const backing: Record<string, unknown> = {};
  const chromeStorage = {
    get: async (key: string) => ({ [key]: backing[key] }),
    set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
  };
  return createChromeChildWorkerStore(chromeStorage);
}

const intent = {
  childThreadId: "child-l2",
  parentThreadId: "pdlt-l1",
  workItemId: "wi-1",
  role: "Sedimentation / Memory Curator",
  creationMode: "FORKED" as const,
  operationGoal: "preserve missing durable reasoning",
  operationScope: "do not continue the main design trajectory",
  returnRoute: "thread:pdlt-l1",
  relevantArtifactRefs: ["docs/design.md"]
};

describe("child worker intent", () => {
  it("persists a PLANNED intent with the full §4 field set before any spawn", async () => {
    const ledger = new ChildWorkerLedger(memoryStore());
    const record = await ledger.createIntent({ ...intent, now: 1000 });
    expect(record).toMatchObject({ state: "PLANNED", createdAt: 1000, updatedAt: 1000, creationMode: "FORKED" });
    expect(record.relevantArtifactRefs).toEqual(["docs/design.md"]);
  });

  it("is idempotent: re-planning the same child returns the existing record", async () => {
    const ledger = new ChildWorkerLedger(memoryStore());
    const first = await ledger.createIntent({ ...intent, now: 1000 });
    const second = await ledger.createIntent({ ...intent, now: 2000 });
    expect(second).toEqual(first);
    expect((await ledger.list())).toHaveLength(1);
  });

  it("rejects reusing a child id for a different parent, role, or creation mode", async () => {
    const ledger = new ChildWorkerLedger(memoryStore());
    await ledger.createIntent(intent);
    await expect(ledger.createIntent({ ...intent, parentThreadId: "pdlt-other" })).rejects.toThrow("child_thread_reuse_conflict");
    await expect(ledger.createIntent({ ...intent, role: "Independent Reviewer" })).rejects.toThrow("child_thread_reuse_conflict");
    await expect(ledger.createIntent({ ...intent, creationMode: "FRESH" })).rejects.toThrow("child_thread_reuse_conflict");
  });

  it("rejects a raw tabId return route and a self-parented child (§19.2, §19.5)", async () => {
    const ledger = new ChildWorkerLedger(memoryStore());
    await expect(ledger.createIntent({ ...intent, returnRoute: "tab:42" })).rejects.toThrow("child_intent_invalid");
    await expect(ledger.createIntent({ ...intent, returnRoute: "42" })).rejects.toThrow("child_intent_invalid");
    await expect(ledger.createIntent({ ...intent, parentThreadId: intent.childThreadId })).rejects.toThrow("child_intent_invalid");
  });
});

describe("child worker lifecycle", () => {
  it("runs the Sedimentation happy path through RETIRED and preserves history", async () => {
    const ledger = new ChildWorkerLedger(memoryStore());
    await ledger.createIntent(intent);
    await ledger.beginSpawn("child-l2", 10);
    await ledger.bindConversation("child-l2", { providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" }, 20);
    await ledger.activate("child-l2", 30);
    await ledger.recordResult("child-l2", { resultRef: "docs/memory.md", completionReceipt: "rcpt-1" }, 40);
    await ledger.beginReturn("child-l2", 50);
    await ledger.complete("child-l2", 60);
    const retired = await ledger.retire("child-l2", 70);
    expect(retired).toMatchObject({
      state: "RETIRED", providerConversationRef: "conv-l2", resultRef: "docs/memory.md", completionReceipt: "rcpt-1"
    });
    // History survives retirement (§19.8).
    expect(await ledger.get("child-l2")).toMatchObject({ state: "RETIRED", resultRef: "docs/memory.md" });
  });

  it("rejects an illegal transition", async () => {
    const ledger = new ChildWorkerLedger(memoryStore());
    await ledger.createIntent(intent);
    await expect(ledger.activate("child-l2")).rejects.toThrow("child_transition_invalid:PLANNED->ACTIVE");
  });

  it("refuses to activate a child that has no bound conversation", async () => {
    const ledger = new ChildWorkerLedger(memoryStore());
    await ledger.createIntent(intent);
    await ledger.beginSpawn("child-l2");
    await ledger.markSpawnUncertain("child-l2");
    await expect(ledger.activate("child-l2")).rejects.toThrow("child_transition_invalid");
  });

  it("refuses further transitions once terminal", async () => {
    const ledger = new ChildWorkerLedger(memoryStore());
    await ledger.createIntent(intent);
    await ledger.cancel("child-l2");
    await expect(ledger.beginSpawn("child-l2")).rejects.toThrow("child_thread_terminal:CANCELLED");
  });

  it("reports a missing child", async () => {
    const ledger = new ChildWorkerLedger(memoryStore());
    await expect(ledger.beginSpawn("nope")).rejects.toThrow("child_thread_not_found");
  });
});

describe("child spawn uncertainty (§16)", () => {
  it("reconciles a recovered conversation instead of spawning a second child", async () => {
    const ledger = new ChildWorkerLedger(memoryStore());
    await ledger.createIntent(intent);
    await ledger.beginSpawn("child-l2", 10);
    await ledger.markSpawnUncertain("child-l2", 20);
    const reconciled = await ledger.bindConversation("child-l2", { providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" }, 30);
    expect(reconciled).toMatchObject({ state: "BOOTSTRAPPING", providerConversationRef: "conv-l2" });
    expect(await ledger.list()).toHaveLength(1);
  });

  it("only cancels when non-creation is proven", async () => {
    const ledger = new ChildWorkerLedger(memoryStore());
    await ledger.createIntent(intent);
    await ledger.beginSpawn("child-l2");
    await ledger.markSpawnUncertain("child-l2");
    const cancelled = await ledger.proveNonCreation("child-l2");
    expect(cancelled.state).toBe("CANCELLED");
  });
});

describe("child carrier recovery / rollover (§16, §17)", () => {
  it("rebinds a broken worker conversation under the same child thread, keeping superseded history", async () => {
    const ledger = new ChildWorkerLedger(memoryStore());
    await ledger.createIntent(intent);
    await ledger.beginSpawn("child-l2");
    await ledger.bindConversation("child-l2", { providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" });
    await ledger.activate("child-l2");
    await ledger.markBroken("child-l2");
    const rebound = await ledger.bindConversation("child-l2", { providerConversationRef: "conv-l2b", carrierRef: "browser-tab:9" });
    expect(rebound).toMatchObject({ state: "BOOTSTRAPPING", providerConversationRef: "conv-l2b" });
    expect(rebound.supersededConversationRefs).toEqual(["conv-l2"]);
    expect(await ledger.list()).toHaveLength(1);
  });

  it("refuses to bind a conversation to a child that has not begun spawning", async () => {
    const ledger = new ChildWorkerLedger(memoryStore());
    await ledger.createIntent(intent);
    await expect(ledger.bindConversation("child-l2", { providerConversationRef: "conv-x", carrierRef: "browser-tab:1" }))
      .rejects.toThrow("child_transition_invalid:PLANNED->BOOTSTRAPPING");
  });
});

describe("child worker persistence", () => {
  it("survives a store round-trip and rejects malformed records", async () => {
    const store = memoryStore();
    const ledger = new ChildWorkerLedger(store);
    await ledger.createIntent(intent);
    await ledger.beginSpawn("child-l2");
    expect(await new ChildWorkerLedger(store).get("child-l2")).toMatchObject({ state: "SPAWNING" });
    expect(isChildWorkerRecord({ ...intent, state: "PLANNED", createdAt: 1, updatedAt: 1 })).toBe(true);
    expect(isChildWorkerRecord({ ...intent, state: "PLANNED", createdAt: 1, updatedAt: 1, role: "" })).toBe(false);
    expect(isChildWorkerRecord({ ...intent, state: "PLANNED", createdAt: 1, updatedAt: 1, returnRoute: "tab:9" })).toBe(false);
  });

  it("ignores a corrupted record array entry", async () => {
    const store = memoryStore();
    await store.set({ [CHILD_WORKERS_KEY]: [{ childThreadId: "bad" }] });
    expect(await new ChildWorkerLedger(store).list()).toEqual([]);
  });
});
