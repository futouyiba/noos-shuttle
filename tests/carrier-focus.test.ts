import { describe, expect, it } from "vitest";
import {
  CARRIER_FOCUS_ACK_KIND,
  carrierTabQueryPatterns,
  parseCarrierFocusRequestsPayload,
  planCarrierFocus,
  type CarrierFocusRequest,
  type CarrierTabCandidate
} from "../src/core/carrier-focus";

function tab(overrides: Partial<CarrierTabCandidate> & Pick<CarrierTabCandidate, "tabId">): CarrierTabCandidate {
  return {
    windowId: 1,
    url: `https://chatgpt.com/c/conv-${overrides.tabId}`,
    active: false,
    lastAccessed: 0,
    windowFocused: true,
    ...overrides
  };
}

function request(overrides: Partial<CarrierFocusRequest> = {}): CarrierFocusRequest {
  return {
    requestId: "focus-1",
    conversationRef: "conv-a",
    conversationUrl: "https://chatgpt.com/c/conv-a",
    enqueuedAt: 1_000,
    ...overrides
  };
}

describe("carrierTabQueryPatterns", () => {
  it("enumerates an https pattern per supported provider host", () => {
    const patterns = carrierTabQueryPatterns();
    expect(patterns).toContain("https://chatgpt.com/*");
    expect(patterns).toContain("https://chat.openai.com/*");
    expect(patterns.every((pattern) => pattern.startsWith("https://") && pattern.endsWith("/*"))).toBe(true);
  });
});

describe("parseCarrierFocusRequestsPayload", () => {
  it("accepts a well-formed {ok, requests} body", () => {
    const parsed = parseCarrierFocusRequestsPayload({
      ok: true,
      requests: [{ requestId: "focus-1", conversationRef: "conv-a", conversationUrl: "https://chatgpt.com/c/conv-a", enqueuedAt: 1_000 }]
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ requestId: "focus-1", conversationRef: "conv-a" });
  });

  it("drops entries that are structurally malformed", () => {
    const parsed = parseCarrierFocusRequestsPayload({
      ok: true,
      requests: [
        { requestId: "", conversationRef: "conv-a", conversationUrl: "https://chatgpt.com/c/conv-a", enqueuedAt: 1 },
        { requestId: "focus-2", conversationRef: " ", conversationUrl: "https://chatgpt.com/c/conv-a", enqueuedAt: 1 },
        { requestId: "focus-3", conversationRef: "conv-a", conversationUrl: "not a url", enqueuedAt: 1 },
        { requestId: "focus-4", conversationRef: "conv-a", conversationUrl: "https://chatgpt.com/c/conv-a", enqueuedAt: Number.NaN },
        "nonsense"
      ]
    });
    expect(parsed).toEqual([]);
  });

  it("rejects non-provider origins so external sources can never steer the browser", () => {
    const parsed = parseCarrierFocusRequestsPayload({
      ok: true,
      requests: [
        { requestId: "focus-1", conversationRef: "conv-a", conversationUrl: "https://github.com/futouyiba/noos-shuttle", enqueuedAt: 1 },
        { requestId: "focus-2", conversationRef: "conv-a", conversationUrl: "http://chatgpt.com/c/conv-a", enqueuedAt: 1 },
        { requestId: "focus-3", conversationRef: "conv-a", conversationUrl: "https://evil-chatgpt.com/c/conv-a", enqueuedAt: 1 }
      ]
    });
    expect(parsed).toEqual([]);
  });

  it("keeps valid entries when a sibling entry is invalid", () => {
    const parsed = parseCarrierFocusRequestsPayload({
      ok: true,
      requests: [
        { requestId: "bad", conversationRef: "conv-a", conversationUrl: "https://example.com/c/conv-a", enqueuedAt: 1 },
        { requestId: "good", conversationRef: "conv-b", conversationUrl: "https://chatgpt.com/c/conv-b", enqueuedAt: 2 }
      ]
    });
    expect(parsed.map((entry) => entry.requestId)).toEqual(["good"]);
  });

  it("returns an empty list for non-object bodies", () => {
    expect(parseCarrierFocusRequestsPayload(undefined)).toEqual([]);
    expect(parseCarrierFocusRequestsPayload({ ok: true })).toEqual([]);
    expect(parseCarrierFocusRequestsPayload({ ok: true, requests: "nope" })).toEqual([]);
  });
});

describe("planCarrierFocus", () => {
  it("activates the single matching tab and focuses its window when unfocused", () => {
    const plan = planCarrierFocus(request(), [
      tab({ tabId: 1, url: "https://chatgpt.com/" }),
      tab({ tabId: 2, url: "https://chatgpt.com/c/conv-a", windowId: 7, windowFocused: false })
    ]);
    expect(plan).toEqual({ kind: "activate_tab", tabId: 2, windowId: 7, focusWindow: true });
  });

  it("does not refocus the window when the tab's window is already focused", () => {
    const plan = planCarrierFocus(request(), [tab({ tabId: 2, url: "https://chatgpt.com/c/conv-a" })]);
    expect(plan).toEqual({ kind: "activate_tab", tabId: 2, windowId: 1, focusWindow: false });
  });

  it("is idempotent when the target tab already is the focused front tab", () => {
    const plan = planCarrierFocus(request(), [
      tab({ tabId: 1, url: "https://chatgpt.com/" }),
      tab({ tabId: 2, url: "https://chatgpt.com/c/conv-a", active: true, windowFocused: true })
    ]);
    expect(plan).toEqual({ kind: "already_focused" });
  });

  it("picks the most recently accessed tab on multi-hit and breaks ties by tab id", () => {
    const oldest = tab({ tabId: 3, url: "https://chatgpt.com/c/conv-a", lastAccessed: 100 });
    const newest = tab({ tabId: 5, url: "https://chatgpt.com/c/conv-a", lastAccessed: 900, windowId: 9 });
    const tied = tab({ tabId: 4, url: "https://chatgpt.com/c/conv-a", lastAccessed: 900, windowId: 8 });
    expect(planCarrierFocus(request(), [oldest, newest, tied])).toMatchObject({ kind: "activate_tab", tabId: 4 });
    expect(planCarrierFocus(request(), [oldest, newest])).toMatchObject({ kind: "activate_tab", tabId: 5, windowId: 9 });
  });

  it("matches refs across provider route shapes, not just /c/", () => {
    const deepSeek = planCarrierFocus(
      request({ conversationRef: "ds-9", conversationUrl: "https://chat.deepseek.com/chat/ds-9" }),
      [tab({ tabId: 6, url: "https://chat.deepseek.com/a/chat/something", lastAccessed: 1 }), tab({ tabId: 7, url: "https://chat.deepseek.com/chat/ds-9" })]
    );
    expect(deepSeek).toMatchObject({ kind: "activate_tab", tabId: 7 });
  });

  it("opens an observer tab with the request URL when no carrier matches", () => {
    const plan = planCarrierFocus(request(), [tab({ tabId: 1, url: "https://chatgpt.com/c/other" })]);
    expect(plan).toEqual({ kind: "open_observer_tab", url: "https://chatgpt.com/c/conv-a" });
  });

  it("ignores tabs whose url cannot be read", () => {
    const plan = planCarrierFocus(request(), [tab({ tabId: 1, url: "" })]);
    expect(plan).toEqual({ kind: "open_observer_tab", url: "https://chatgpt.com/c/conv-a" });
  });
});

describe("CARRIER_FOCUS_ACK_KIND", () => {
  it("follows the NOOS_* message lane naming", () => {
    expect(CARRIER_FOCUS_ACK_KIND).toBe("NOOS_FOCUS_REQUEST");
  });
});
