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
        { request_id: "focus-1", conversation_ref: "conv-a", conversation_url: "https://chatgpt.com/c/conv-a", enqueued_at: 1_000 },
        { request_id: "focus-2", conversation_ref: "conv-b", conversation_url: "https://github.com/evil", enqueued_at: 1_100 },
        { request_id: "focus-3", conversation_ref: "conv-c", conversation_url: "https://chatgpt.com/c/conv-c", enqueued_at: 1_200 }
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
