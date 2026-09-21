import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { actuateGovernedPayload } from "../src/content/governed-dispatch";
import { handleBackgroundDispatch, type BackgroundDispatchDeps, type BackgroundDispatchObservation } from "../src/content/background-dispatch";
import type { CarrierObservation } from "../src/content/runtime-observer";

/** Same jsdom harness as `background-dispatch.test.ts` / `chatgpt-dom-generation.test.ts`. */
function withDom(html: string, callback: () => void | Promise<void>): Promise<void> | void {
  const dom = new JSDOM(html, { url: "https://chatgpt.com/c/example", pretendToBeVisual: true });
  const win = dom.window as unknown as Window & typeof globalThis;
  Object.defineProperty(win.Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: Element) {
      const collapsed = win.getComputedStyle(this).display === "none";
      const width = collapsed ? 0 : 94;
      const height = collapsed ? 0 : 24;
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) };
    }
  });
  const keys = ["document", "window", "Node", "Element", "HTMLElement", "HTMLButtonElement", "HTMLTextAreaElement", "InputEvent", "KeyboardEvent"] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: win[key as keyof typeof win], configurable: true });
  }
  const restore = () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
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

const PAGE = `<!doctype html><html><body><main><form>
  <textarea id="prompt-textarea"></textarea>
  <button data-testid="send-button" type="button">Send</button>
</form></main></body></html>`;

const HUMAN_DRAFT = "UNSENT HUMAN DRAFT - do not replace";
/** What `issueRunGo` generates for an AUTO_X5 round (issue #106's payload). */
const GENERATED_GO = "Goal Re-anchor\n\nWork Item: wi-1\nGoal: ship\nScope: src\n\nContinue within this existing Goal and Scope.";
/** What the goal-reanchor lane writes (issue #104's other writer). */
const BACKGROUND_PAYLOAD = "BACKGROUND PAYLOAD";

const OBSERVATION: BackgroundDispatchObservation = {
  state: "READY",
  executionInstanceRef: "exec-1",
  sourceEpoch: 7,
  carrierRef: "browser-tab:1",
  providerConversationRef: "conv-1"
};
const FENCE = { providerConversationRef: "conv-1", bindingEpoch: 7, leaseGeneration: 7, leaseOwnerRef: "exec-1", targetCarrierRef: "browser-tab:1" };

type Win = Window & typeof globalThis;

/** Install a composer holding `text` plus a click counter for the provider's send control. */
function composer(win: Win, text: string) {
  const doc = win.document;
  doc.querySelector<HTMLTextAreaElement>("#prompt-textarea")!.value = text;
  let sends = 0;
  doc.querySelector<HTMLButtonElement>("[data-testid='send-button']")!.addEventListener("click", () => { sends += 1; });
  return { text: () => doc.querySelector<HTMLTextAreaElement>("#prompt-textarea")!.value, sends: () => sends };
}

/** The governed (GO / AUTO_X5) actuation, with the live page reading stubbed out. */
function govern(payload: string, fenceCurrent = true) {
  return actuateGovernedPayload(payload, {
    readCurrent: () => OBSERVATION as unknown as CarrierObservation,
    isFenceCurrent: () => fenceCurrent
  });
}

/** The background (goal-reanchor) lane, driven through its own real shell. */
function background(listener = { messageType: "NOOS_DISPATCH_GOAL_REANCHOR", operationKind: "REANCHOR_GOAL" }) {
  const responses: Array<Record<string, unknown>> = [];
  const claims: Array<Record<string, unknown>> = [];
  const deps: BackgroundDispatchDeps = {
    messageType: listener.messageType,
    operationKind: listener.operationKind,
    readObservation: () => OBSERVATION,
    isSubmissionActive: () => false,
    claimSubmission: claim => { claims.push({ ...claim }); },
    buildObservation: () => ({ conversationRef: "conv-1" }),
    sendResponse: response => { responses.push(response); }
  };
  const asyncResponse = handleBackgroundDispatch(
    { type: listener.messageType, operation: { operationId: "op-bg", logicalThreadId: "thread-1", operationKind: listener.operationKind, state: "DISPATCHING", payload: BACKGROUND_PAYLOAD, dispatchFence: { ...FENCE }, dispatchClaimedAt: 1_000 } },
    true,
    deps
  );
  return { asyncResponse, responses, claims };
}

describe("governed actuation never overwrites the Human's draft (issue #106)", () => {
  it("refuses, writes nothing and sends nothing when the composer holds a draft", async () => {
    await withDom(PAGE, async () => {
      const win = globalThis as unknown as Win;
      const state = composer(win, HUMAN_DRAFT);
      // The AUTO_X5 path reaches here with no new Human action, so the draft is
      // the only thing standing between the Human and silent data loss.
      await expect(govern(GENERATED_GO)).rejects.toThrow("chatgpt_composer_not_empty");
      expect(state.text()).toBe(HUMAN_DRAFT);
      expect(state.sends()).toBe(0);
    });
  });

  it("delivers once the composer is free (the control)", async () => {
    await withDom(PAGE, async () => {
      const win = globalThis as unknown as Win;
      const state = composer(win, "");
      await expect(govern(GENERATED_GO)).resolves.toBeUndefined();
      expect(state.text()).toBe(GENERATED_GO);
      expect(state.sends()).toBe(1);
    });
  });

  it("refuses without writing when the dispatch fence no longer holds", async () => {
    await withDom(PAGE, async () => {
      const win = globalThis as unknown as Win;
      const state = composer(win, "");
      await expect(govern(GENERATED_GO, false)).rejects.toThrow("chatgpt_composer_unavailable");
      expect(state.text()).toBe("");
      expect(state.sends()).toBe(0);
    });
  });

  it("reports the two refusals with distinguishable reasons", async () => {
    // The reason reaches the durable ledger as `operation.error`, so an audit
    // must be able to tell "page not ready" from "Human has something pending".
    await withDom(PAGE, async () => {
      const win = globalThis as unknown as Win;
      composer(win, HUMAN_DRAFT);
      await expect(govern(GENERATED_GO)).rejects.toThrow("chatgpt_composer_not_empty");
    });
    await withDom(PAGE, async () => {
      const win = globalThis as unknown as Win;
      composer(win, "");
      await expect(govern(GENERATED_GO, false)).rejects.toThrow("chatgpt_composer_unavailable");
    });
  });
});

/**
 * The invariant issue #104 asks for, driven through *both* real code paths
 * rather than through the shared primitive: whichever writer arrives second must
 * refuse, so exactly one payload ever lands.
 *
 * It holds without any flag, ordering rule or lock, and the reason is worth
 * stating because it is the whole argument: every writer's emptiness check and
 * its write are in one synchronous turn, and JS is single-threaded, so the
 * second writer cannot have begun before the first writer's text was in the
 * DOM. `activeSubmission` is deliberately NOT the mechanism — a flag is only
 * consulted by writers that remember to consult it, and only outside whatever
 * window it happens to cover.
 */
describe("two writers, one composer: exactly one payload lands (issue #104)", () => {
  it("background first, governed second: the GO payload is refused, the background payload survives", async () => {
    await withDom(PAGE, async () => {
      const win = globalThis as unknown as Win;
      const state = composer(win, "");
      const driven = background();
      expect(driven.asyncResponse).toBe(true);
      await vi.waitFor(() => expect(driven.responses).toHaveLength(1));
      expect(state.text()).toBe(BACKGROUND_PAYLOAD);
      expect(state.sends()).toBe(1);

      // The GO lane now arrives — and must not destroy what the background landed.
      await expect(govern(GENERATED_GO)).rejects.toThrow("chatgpt_composer_not_empty");
      expect(state.text()).toBe(BACKGROUND_PAYLOAD);
      expect(state.sends()).toBe(1);
    });
  });

  it("governed first, background second: the background payload is refused and not even claimed", async () => {
    await withDom(PAGE, async () => {
      const win = globalThis as unknown as Win;
      const state = composer(win, "");
      await expect(govern(GENERATED_GO)).resolves.toBeUndefined();
      expect(state.text()).toBe(GENERATED_GO);
      expect(state.sends()).toBe(1);

      const driven = background();
      expect(driven.asyncResponse).toBe(false);
      expect(driven.responses).toEqual([{ ok: false, reason: "chatgpt_composer_not_empty" }]);
      expect(state.text()).toBe(GENERATED_GO);
      expect(state.sends()).toBe(1);
      // Claiming the carrier despite refusing is what would wedge it later.
      expect(driven.claims).toEqual([]);
    });
  });

  it("holds for the child-delivery writer as well", async () => {
    await withDom(PAGE, async () => {
      const win = globalThis as unknown as Win;
      const state = composer(win, "");
      const driven = background({ messageType: "NOOS_DISPATCH_DELIVER_CHILD_RESULT", operationKind: "DELIVER_CHILD_RESULT" });
      await vi.waitFor(() => expect(driven.responses).toHaveLength(1));
      await expect(govern(GENERATED_GO)).rejects.toThrow("chatgpt_composer_not_empty");
      expect(state.text()).toBe(BACKGROUND_PAYLOAD);
      expect(state.sends()).toBe(1);
    });
  });
});
