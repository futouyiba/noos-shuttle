import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { handleBackgroundDispatch, type BackgroundDispatchDeps, type BackgroundDispatchObservation } from "../src/content/background-dispatch";

/**
 * `background-dispatch` reaches into `chatgpt-dom`, which reads the live
 * `document`/`window`, so each case installs a jsdom window as the global
 * before driving the listener. Same harness as `chatgpt-dom-generation.test.ts`.
 */
function withDom(html: string, callback: () => void | Promise<void>): Promise<void> | void {
  const dom = new JSDOM(html, { url: "https://chatgpt.com/c/example", pretendToBeVisual: true });
  const win = dom.window as unknown as Window & typeof globalThis;

  // jsdom performs no layout: every element measures 0x0, which would read as
  // invisible. Report a non-zero box for laid-out elements and keep collapsed
  // ones at zero so `isVisible` still exercises its own guards.
  Object.defineProperty(win.Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: Element) {
      const collapsed = win.getComputedStyle(this).display === "none";
      const width = collapsed ? 0 : 94;
      const height = collapsed ? 0 : 24;
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) };
    }
  });

  const keys = [
    "document", "window", "Node", "Element", "HTMLElement", "HTMLButtonElement", "HTMLTextAreaElement", "InputEvent", "KeyboardEvent"
  ] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: win[key as keyof typeof win], configurable: true });
  }

  const restore = () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete (globalThis as Record<string, unknown>)[key];
      }
    }
  };

  try {
    const result = callback();
    if (result instanceof Promise) return result.finally(restore);
  } catch (error) {
    restore();
    throw error;
  }
}

const DRAFT = "UNSENT HUMAN DRAFT - do not replace";
const PAYLOAD = "BACKGROUND PAYLOAD";

/** A mock composer with the provider's own send control, which is what a send would click. */
const COMPOSER_PAGE = `<!doctype html><html><body><main><form>
  <textarea id="prompt-textarea"></textarea>
  <button data-testid="send-button" type="button">Send</button>
</form></main></body></html>`;

const OBSERVATION: BackgroundDispatchObservation = {
  state: "READY",
  executionInstanceRef: "exec-1",
  sourceEpoch: 7,
  carrierRef: "browser-tab:1",
  providerConversationRef: "conv-1"
};

const FENCE = {
  providerConversationRef: "conv-1",
  bindingEpoch: 7,
  leaseGeneration: 7,
  leaseOwnerRef: "exec-1",
  targetCarrierRef: "browser-tab:1"
};

function operation(operationKind: string, overrides: Record<string, unknown> = {}) {
  return {
    operationId: "op-1",
    logicalThreadId: "thread-1",
    operationKind,
    state: "DISPATCHING",
    payload: PAYLOAD,
    dispatchFence: { ...FENCE },
    dispatchClaimedAt: 1_000,
    ...overrides
  };
}

/** The two listeners this slice fixes, driven through the shared shell. */
const LISTENERS = [
  { name: "NOOS_DISPATCH_GOAL_REANCHOR", messageType: "NOOS_DISPATCH_GOAL_REANCHOR", operationKind: "REANCHOR_GOAL" },
  { name: "NOOS_DISPATCH_DELIVER_CHILD_RESULT", messageType: "NOOS_DISPATCH_DELIVER_CHILD_RESULT", operationKind: "DELIVER_CHILD_RESULT" }
] as const;

interface Driven {
  /** The `onMessage` return value: true exactly when the response arrives later. */
  readonly asyncResponse: boolean;
  readonly responses: Array<Record<string, unknown>>;
  readonly claims: Array<Record<string, unknown>>;
}

function drive(
  listener: (typeof LISTENERS)[number],
  message: unknown,
  options: {
    observation?: BackgroundDispatchObservation | null;
    submissionActive?: boolean;
    senderIsSelf?: boolean;
  } = {}
): Driven {
  const responses: Array<Record<string, unknown>> = [];
  const claims: Array<Record<string, unknown>> = [];
  const deps: BackgroundDispatchDeps = {
    messageType: listener.messageType,
    operationKind: listener.operationKind,
    readObservation: () => ("observation" in options ? options.observation : OBSERVATION),
    isSubmissionActive: () => options.submissionActive === true,
    claimSubmission: claim => { claims.push({ ...claim }); },
    buildObservation: () => ({ conversationRef: "conv-1", observedAt: 1_234 }),
    sendResponse: response => { responses.push(response); }
  };
  const asyncResponse = handleBackgroundDispatch(message, options.senderIsSelf !== false, deps);
  return { asyncResponse, responses, claims };
}

/** Install a composer holding the given text, plus a counter for send-button clicks. */
function installComposer(win: Window & typeof globalThis, text: string): { draft: () => string; sends: () => number } {
  const document = win.document;
  const textarea = document.querySelector<HTMLTextAreaElement>("#prompt-textarea")!;
  textarea.value = text;
  let sends = 0;
  const button = document.querySelector<HTMLButtonElement>("[data-testid='send-button']")!;
  button.addEventListener("click", () => { sends += 1; });
  return {
    draft: () => document.querySelector<HTMLTextAreaElement>("#prompt-textarea")!.value,
    sends: () => sends
  };
}

describe.each(LISTENERS)("$name yields to the Human's unsent draft (issue #98)", listener => {
  it("refuses the delivery without touching the draft and without sending", async () => {
    await withDom(COMPOSER_PAGE, async () => {
      const win = globalThis as unknown as Window & typeof globalThis;
      const composer = installComposer(win, DRAFT);
      const driven = drive(listener, { type: listener.messageType, operation: operation(listener.operationKind) });

      // Refused synchronously: there is nothing left to wait for.
      expect(driven.asyncResponse).toBe(false);
      expect(driven.responses).toEqual([{ ok: false, reason: "chatgpt_composer_not_empty" }]);
      // The three things the bug destroyed, asserted directly.
      expect(composer.draft()).toBe(DRAFT);
      expect(composer.sends()).toBe(0);
      // And the carrier is not claimed, so it is still free to deliver later.
      expect(driven.claims).toEqual([]);
    });
  });

  it("delivers and sends once the composer is free", async () => {
    await withDom(COMPOSER_PAGE, async () => {
      const win = globalThis as unknown as Window & typeof globalThis;
      const composer = installComposer(win, "");
      const driven = drive(listener, { type: listener.messageType, operation: operation(listener.operationKind) });

      expect(driven.asyncResponse).toBe(true);
      expect(driven.claims).toHaveLength(1);
      await vi.waitFor(() => expect(driven.responses).toHaveLength(1));
      expect(driven.responses[0]).toMatchObject({ ok: true });
      expect(composer.draft()).toBe(PAYLOAD);
      expect(composer.sends()).toBe(1);
    });
  });

  it("reads a whitespace-only composer as free, which is what isChatComposerEmpty has always done", async () => {
    await withDom(COMPOSER_PAGE, async () => {
      const win = globalThis as unknown as Window & typeof globalThis;
      const composer = installComposer(win, "   ");
      const driven = drive(listener, { type: listener.messageType, operation: operation(listener.operationKind) });
      // Recorded, not endorsed: `isChatComposerEmpty`'s doc says "whitespace-only
      // content counts as a draft" while its body is `draft.trim() === ""`, so it
      // answers the opposite. The outbox already depends on the body, and this
      // slice may not change outbox behaviour, so the body wins here and the
      // discrepancy is pinned where a reader can see it. Losing spaces costs the
      // Human nothing; the hazard this slice closes is losing real content.
      await vi.waitFor(() => expect(driven.responses).toHaveLength(1));
      expect(driven.responses[0]).toMatchObject({ ok: true });
      expect(composer.draft()).toBe(PAYLOAD);
      expect(composer.sends()).toBe(1);
    });
  });

  it("still refuses an operation that does not match this listener's fence", async () => {
    await withDom(COMPOSER_PAGE, async () => {
      const win = globalThis as unknown as Window & typeof globalThis;
      const composer = installComposer(win, "");
      const stale = operation(listener.operationKind, { dispatchFence: { ...FENCE, leaseOwnerRef: "exec-other" } });
      const driven = drive(listener, { type: listener.messageType, operation: stale });
      // A refused gate answers with no reason at all: the operation was never
      // this carrier's to actuate, so there is nothing to report.
      expect(driven.responses).toEqual([{ ok: false }]);
      expect(composer.draft()).toBe("");
      expect(composer.sends()).toBe(0);
      expect(driven.claims).toEqual([]);
    });
  });
});

describe("the shared shell's gate is unchanged", () => {
  const listener = LISTENERS[0];
  const cases: Array<[string, Record<string, unknown>, { observation?: BackgroundDispatchObservation | null; submissionActive?: boolean; senderIsSelf?: boolean }]> = [
    ["this listener does not own the message type", { type: "NOOS_OTHER" }, {}],
    ["the carrier is not READY", { type: listener.messageType, operation: operation(listener.operationKind) }, { observation: { ...OBSERVATION, state: "GENERATING" } }],
    ["no observation at all", { type: listener.messageType, operation: operation(listener.operationKind) }, { observation: null }],
    ["the operation kind belongs to the other listener", { type: listener.messageType, operation: operation("DELIVER_CHILD_RESULT") }, {}],
    ["the operation is not DISPATCHING", { type: listener.messageType, operation: operation(listener.operationKind, { state: "PREPARED" }) }, {}],
    ["the payload is not a string", { type: listener.messageType, operation: operation(listener.operationKind, { payload: { text: PAYLOAD } }) }, {}],
    ["the fence is malformed", { type: listener.messageType, operation: operation(listener.operationKind, { dispatchFence: { providerConversationRef: "conv-1" } }) }, {}],
    ["the fence names another conversation", { type: listener.messageType, operation: operation(listener.operationKind, { dispatchFence: { ...FENCE, providerConversationRef: "conv-2" } }) }, {}],
    ["the fence names another carrier", { type: listener.messageType, operation: operation(listener.operationKind, { dispatchFence: { ...FENCE, targetCarrierRef: "browser-tab:2" } }) }, {}],
    ["the fence names another binding epoch", { type: listener.messageType, operation: operation(listener.operationKind, { dispatchFence: { ...FENCE, bindingEpoch: 8 } }) }, {}],
    ["the carrier already owns a submission", { type: listener.messageType, operation: operation(listener.operationKind) }, { submissionActive: true }]
  ];

  it.each(cases)("answers nothing and writes nothing when %s", async (_name, message, options) => {
    await withDom(COMPOSER_PAGE, () => {
      const win = globalThis as unknown as Window & typeof globalThis;
      const composer = installComposer(win, "");
      const driven = drive(listener, message, options);
      // The message type check is the listener's own routing contract: an
      // unowned message returns false without answering at all.
      const owned = (message as { type?: string }).type === listener.messageType;
      expect(driven.asyncResponse).toBe(false);
      expect(driven.responses).toEqual(owned ? [{ ok: false }] : []);
      expect(composer.draft()).toBe("");
      expect(composer.sends()).toBe(0);
      expect(driven.claims).toEqual([]);
    });
  });

  it("refuses a delivery from another extension's sender", async () => {
    await withDom(COMPOSER_PAGE, () => {
      const win = globalThis as unknown as Window & typeof globalThis;
      const composer = installComposer(win, "");
      const driven = drive(listener, { type: listener.messageType, operation: operation(listener.operationKind) }, { senderIsSelf: false });
      expect(driven.responses).toEqual([{ ok: false }]);
      expect(composer.sends()).toBe(0);
    });
  });

  it("reports an unavailable composer separately from an occupied one", async () => {
    await withDom("<main></main>", () => {
      const driven = drive(listener, { type: listener.messageType, operation: operation(listener.operationKind) });
      expect(driven.responses).toEqual([{ ok: false, reason: "chatgpt_composer_unavailable" }]);
      expect(driven.claims).toEqual([]);
    });
  });
});
