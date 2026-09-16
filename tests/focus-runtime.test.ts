import { describe, expect, it } from "vitest";
import {
  processCarrierFocusRequests,
  type CarrierFocusRuntimeDeps
} from "../src/background/focus-runtime";

interface DepLog {
  activatedTabs: number[];
  focusedWindows: number[];
  openedTabs: string[];
  ackedRequests: string[];
}

function makeDeps(log: DepLog, options: { tabs?: Array<{ tabId: number; url: string; active?: boolean; lastAccessed?: number; windowFocused?: boolean }>; ackFailsFor?: string[] } = {}): CarrierFocusRuntimeDeps {
  return {
    fetchRequests: async () => ({
      ok: true,
      requests: [
        { requestId: "focus-1", conversationRef: "conv-a", conversationUrl: "https://chatgpt.com/c/conv-a", enqueuedAt: 1_000 },
        { requestId: "focus-2", conversationRef: "conv-b", conversationUrl: "https://github.com/evil", enqueuedAt: 1_100 },
        { requestId: "focus-3", conversationRef: "conv-c", conversationUrl: "https://chatgpt.com/c/conv-c", enqueuedAt: 1_200 }
      ]
    }),
    postAck: async (requestId) => {
      if (options.ackFailsFor?.includes(requestId)) {
        throw new Error("ack_failed");
      }
      log.ackedRequests.push(requestId);
      return { ok: true };
    },
    queryTabs: async () =>
      (options.tabs ?? [
        { tabId: 1, url: "https://chatgpt.com/c/conv-a", active: false, lastAccessed: 10, windowFocused: false },
        { tabId: 2, url: "https://chatgpt.com/c/conv-c", active: true, lastAccessed: 20, windowFocused: true }
      ]).map((tab) => ({
        tabId: tab.tabId,
        windowId: tab.tabId + 100,
        url: tab.url,
        active: tab.active ?? false,
        lastAccessed: tab.lastAccessed ?? 0,
        windowFocused: tab.windowFocused ?? true
      })),
    activateTab: async (tabId) => {
      log.activatedTabs.push(tabId);
    },
    focusWindow: async (windowId) => {
      log.focusedWindows.push(windowId);
    },
    openObserverTab: async (url) => {
      log.openedTabs.push(url);
    }
  };
}

describe("processCarrierFocusRequests", () => {
  it("executes per-request plans and acks each handled request", async () => {
    const log: DepLog = { activatedTabs: [], focusedWindows: [], openedTabs: [], ackedRequests: [] };
    const summary = await processCarrierFocusRequests(makeDeps(log));

    // focus-1 activates tab 1 + focuses its window; focus-2 is dropped by the
    // provider-origin whitelist (not counted as processed); focus-3 is
    // already the focused front tab.
    expect(log.activatedTabs).toEqual([1]);
    expect(log.focusedWindows).toEqual([101]);
    expect(log.openedTabs).toEqual([]);
    expect(log.ackedRequests).toEqual(["focus-1", "focus-3"]);
    expect(summary).toEqual({ processed: 2, acked: 2 });
  });

  it("opens an observer tab when no carrier matches and still acks", async () => {
    const log: DepLog = { activatedTabs: [], focusedWindows: [], openedTabs: [], ackedRequests: [] };
    await processCarrierFocusRequests(makeDeps(log, { tabs: [] }));

    expect(log.openedTabs).toEqual(["https://chatgpt.com/c/conv-a", "https://chatgpt.com/c/conv-c"]);
    expect(log.ackedRequests).toEqual(["focus-1", "focus-3"]);
  });

  it("keeps processing later requests when one ack fails", async () => {
    const log: DepLog = { activatedTabs: [], focusedWindows: [], openedTabs: [], ackedRequests: [] };
    const summary = await processCarrierFocusRequests(makeDeps(log, { ackFailsFor: ["focus-1"] }));

    expect(log.ackedRequests).toEqual(["focus-3"]);
    expect(summary).toEqual({ processed: 2, acked: 1 });
  });

  it("does nothing on an empty queue", async () => {
    const log: DepLog = { activatedTabs: [], focusedWindows: [], openedTabs: [], ackedRequests: [] };
    const deps = makeDeps(log);
    const summary = await processCarrierFocusRequests({ ...deps, fetchRequests: async () => ({ ok: true, requests: [] }) });
    expect(summary).toEqual({ processed: 0, acked: 0 });
    expect(log).toEqual({ activatedTabs: [], focusedWindows: [], openedTabs: [], ackedRequests: [] });
  });
});
