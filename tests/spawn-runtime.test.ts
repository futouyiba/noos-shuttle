import { describe, expect, it } from "vitest";
import { ChildWorkerLedger, createChromeChildWorkerStore } from "../src/core/child-worker";
import {
  BROWSER_SPAWN_CAPABILITIES,
  adoptBrowserChildSpawn,
  listPendingSpawns,
  requestBrowserChildSpawn
} from "../src/background/spawn-runtime";

function harness() {
  const backing: Record<string, unknown> = {};
  const chromeStorage = {
    get: async (key: string) => ({ [key]: backing[key] }),
    set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
  };
  const children = new ChildWorkerLedger(createChromeChildWorkerStore(chromeStorage));
  return { children, store: chromeStorage, backing };
}

const freshIntent = {
  childThreadId: "child-l3",
  parentThreadId: "pdlt-l1",
  workItemId: "wi-1",
  role: "Independent Reviewer",
  creationMode: "FRESH" as const,
  contextSource: "MINIMAL_BOOTSTRAP" as const,
  contextFidelity: "INDEPENDENT" as const,
  operationGoal: "review the frozen target",
  operationScope: "findings only",
  returnRoute: "thread:pdlt-l1",
  now: 100
};

describe("browser spawn capabilities", () => {
  it("reports the adapter facts without concluding equivalence", () => {
    expect(BROWSER_SPAWN_CAPABILITIES).toMatchObject({ supportsNativeFork: false, transcriptExportAvailable: true });
  });
});

describe("requestBrowserChildSpawn", () => {
  it("opens a tab and records the pending spawn with the child SPAWNING", async () => {
    const { children, store } = harness();
    let opened = 0;
    const { child, tabId } = await requestBrowserChildSpawn(children, store, async () => { opened += 1; return 42; }, { intent: freshIntent });
    expect(opened).toBe(1);
    expect(tabId).toBe(42);
    expect(child.state).toBe("SPAWNING");
    expect((await listPendingSpawns(store))["42"]).toMatchObject({ childThreadId: "child-l3" });
    // A re-request opens a second tab (the runtime cannot know the first is
    // dead) but keeps ONE live pending per child: the newer entry supersedes
    // the older tab's, so the forgotten tab can never adopt later.
    const again = await requestBrowserChildSpawn(children, store, async () => { opened += 1; return 43; }, { intent: freshIntent });
    expect(again.tabId).toBe(43);
    expect(opened).toBe(2);
    expect(child.state).toBe("SPAWNING");
    const pendingAfter = await listPendingSpawns(store);
    expect(pendingAfter["43"]).toMatchObject({ childThreadId: "child-l3" });
    expect(pendingAfter["42"]).toBeUndefined();
  });

  it("refuses a FORKED child (needs human) without opening anything", async () => {
    const { children, store } = harness();
    let opened = 0;
    await expect(requestBrowserChildSpawn(children, store, async () => { opened += 1; return 1; }, {
      intent: { ...freshIntent, creationMode: "FORKED" as never, contextSource: "PROVIDER_INHERITED" as never, contextFidelity: "PROVIDER_INHERITANCE_REQUIRED" as never }
    })).rejects.toThrow("spawn_needs_human:native_fork_unavailable");
    expect(opened).toBe(0);
    expect((await children.get("child-l3"))?.state).toBe("PLANNED");
    expect(await listPendingSpawns(store)).toEqual({});
  });
});

describe("adoptBrowserChildSpawn", () => {
  it("adopts a tab that reports a stable conversation identity", async () => {
    const { children, store } = harness();
    await requestBrowserChildSpawn(children, store, async () => 42, { intent: freshIntent });
    const result = await adoptBrowserChildSpawn(children, store, { tabId: 42, providerConversationRef: "conv-child-9" });
    expect(result.status).toBe("ADOPTED");
    if (result.status === "ADOPTED") {
      expect(result.child).toMatchObject({ state: "ACTIVE", providerConversationRef: "conv-child-9", carrierRef: "browser-tab:42" });
    }
    // The pending entry is consumed.
    expect(await listPendingSpawns(store)).toEqual({});
  });

  it("leaves a provisional tab unadopted (activation safety)", async () => {
    const { children, store } = harness();
    await requestBrowserChildSpawn(children, store, async () => 42, { intent: freshIntent });
    const provisional = await adoptBrowserChildSpawn(children, store, { tabId: 42 });
    expect(provisional.status).toBe("NEEDS_STABLE_IDENTITY");
    expect((await children.get("child-l3"))?.state).toBe("SPAWNING");
    // The pending entry survives for a later probe with a stable identity.
    expect((await listPendingSpawns(store))["42"]).toBeDefined();
    const later = await adoptBrowserChildSpawn(children, store, { tabId: 42, providerConversationRef: "conv-later" });
    expect(later.status).toBe("ADOPTED");
  });

  it("ignores an unknown tab and clears stale entries for finished children", async () => {
    const { children, store } = harness();
    expect((await adoptBrowserChildSpawn(children, store, { tabId: 99, providerConversationRef: "conv-x" })).status).toBe("NO_PENDING_SPAWN");
    await requestBrowserChildSpawn(children, store, async () => 42, { intent: freshIntent });
    await children.cancel("child-l3");
    const stale = await adoptBrowserChildSpawn(children, store, { tabId: 42, providerConversationRef: "conv-x" });
    expect(stale.status).toBe("CHILD_NOT_ADOPTABLE");
    expect(await listPendingSpawns(store)).toEqual({});
  });

  it("adopts an SPAWN_UNCERTAIN child after reconciliation-grade uncertainty", async () => {
    const { children, store } = harness();
    await requestBrowserChildSpawn(children, store, async () => 42, { intent: freshIntent });
    await children.markSpawnUncertain("child-l3");
    const result = await adoptBrowserChildSpawn(children, store, { tabId: 42, providerConversationRef: "conv-recovered" });
    expect(result.status).toBe("ADOPTED");
    if (result.status === "ADOPTED") {
      expect(result.child).toMatchObject({ state: "ACTIVE", providerConversationRef: "conv-recovered" });
    }
  });
});
