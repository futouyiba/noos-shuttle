import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  SubmissionOperationLedger,
  fingerprintSubmissionPayload,
  type SubmissionClaimContext
} from "../src/core/submission-operation";
import { dispatchOutboxMessage, reconcileOutboxReservation } from "../src/content/outbox-dispatch";
import type { CarrierObservation } from "../src/content/runtime-observer";
import type { HumanGoCarrierSnapshot } from "../src/core/human-go-runtime";

/**
 * The carrier half of the loop issue #63 delta 3 depends on.
 *
 * The delivery gate advertises `RECONCILE` for a reservation that left execution
 * or overstayed its dispatch grace. Nothing else in the shipped paths drives an
 * `OUTBOX_MESSAGE` operation to a terminal state, so if this entry point is not
 * reachable — or does not settle what it reconciles — the whole loop closes
 * nowhere: the item never reaches `DELIVERED`, the Run's earned floor stays at
 * zero (a delivered queued message then reads as Human intervention), and the
 * operation keeps owning execution, blocking every later dispatch to this
 * target. These tests exercise the real ledger end to end.
 */

const PAYLOAD = "queued human message";
const FINGERPRINT = fingerprintSubmissionPayload(PAYLOAD);
const CONVERSATION = "conversation:a";
const CARRIER_REF = "browser-tab:7";
const OBSERVER = "observer-abc";
const CLAIMED_AT = 1_000;

function context(overrides: Partial<SubmissionClaimContext> = {}): SubmissionClaimContext {
  return {
    logicalThreadId: `thread:${CONVERSATION}`,
    providerConversationRef: CONVERSATION,
    bindingEpoch: 3,
    leaseGeneration: 3,
    leaseOwnerRef: OBSERVER,
    targetCarrierRef: CARRIER_REF,
    carrierState: "READY",
    logicalControl: "CONTINUE",
    explicitGo: true,
    sourceEpoch: 3,
    sourceObservedAt: CLAIMED_AT,
    ...overrides
  };
}

function memoryStore(authorityValue = { ...context(), authorityGeneration: 1, authorityEstablishedAt: CLAIMED_AT }) {
  let value: unknown;
  return {
    get: async (_key?: string) => value,
    set: async (next: Record<string, unknown>) => { value = next; },
    getAuthority: async (logicalThreadId: string) => logicalThreadId === authorityValue.logicalThreadId ? authorityValue : undefined,
    ensureAuthority: async () => undefined
  };
}

function observation(overrides: Partial<CarrierObservation> = {}): CarrierObservation {
  return {
    provider: "chatgpt",
    routeRef: "/c/conv-1",
    providerConversationRef: CONVERSATION,
    composerPresent: true,
    composerInteractive: true,
    stopGenerationControlPresent: false,
    assistantOutputMutating: false,
    assistantMessageCount: 1,
    userMessageCount: 5,
    providerErrorSurfacePresent: false,
    routeStable: true,
    carrierRef: CARRIER_REF,
    executionInstanceRef: OBSERVER,
    conversationIdentityState: "resolved",
    conversationIdentitySource: "provider-route",
    carrierIdentityState: "browser-tab",
    state: "READY",
    observedAt: 20_000,
    sourceEpoch: 3,
    quietSince: 15_000,
    errorSince: null,
    ...overrides
  };
}

const evidence = { lastUserMessageFingerprint: FINGERPRINT, lastAssistantMessageFingerprint: "a1", headFingerprint: "h1" };

async function claimedOperation(): Promise<SubmissionOperationLedger> {
  const ledger = new SubmissionOperationLedger(memoryStore());
  await ledger.prepare({
    operationId: "outbox-1",
    operationKind: "OUTBOX_MESSAGE",
    workItemId: "shuttle-outbox",
    logicalThreadId: `thread:${CONVERSATION}`,
    targetCarrierRef: CARRIER_REF,
    providerConversationRef: CONVERSATION,
    dispatchFence: context(),
    payloadFingerprint: FINGERPRINT,
    payload: PAYLOAD,
    runId: "bcr-run-1",
    preSubmitBaseline: {
      conversationRef: CONVERSATION,
      routeRef: "/c/conv-1",
      assistantMessageCount: 1,
      userMessageCount: 4,
      lastUserMessageFingerprint: "prior-user",
      lastAssistantMessageFingerprint: "a1",
      headFingerprint: "h1",
      observedAt: 500
    }
  });
  await ledger.claim("outbox-1", context(), CLAIMED_AT);
  return ledger;
}

describe("reconcileOutboxReservation closes the delivery loop", () => {
  it("settles a reserved operation all the way to COMPLETED", async () => {
    const ledger = await claimedOperation();
    expect(await ledger.get("outbox-1")?.then(op => op?.state)).toBe("DISPATCHING");

    // One pass, stable observation: acceptance is proven and the finished turn
    // closes the operation, so it stops owning execution and the background's
    // fold can see a success-terminal state.
    const settled = await reconcileOutboxReservation(
      { itemId: "item-1", operationId: "outbox-1", observation: observation(), evidence },
      { ledger }
    );
    expect(settled.status).toBe("RECONCILED");
    expect(settled.status === "RECONCILED" && settled.operation.state).toBe("COMPLETED");
    const stored = await ledger.get("outbox-1");
    expect(stored?.state).toBe("COMPLETED");
    expect(stored?.acceptedPayloadFingerprint).toBe(FINGERPRINT);
    // The fold reads this: it is the accounting baseline, taken from the
    // operation's own pre-submit observation rather than from a live counter.
    expect(stored?.preSubmitBaseline.userMessageCount).toBe(4);
  });

  it("stamps acceptance without closing a turn that has not settled yet", async () => {
    const ledger = await claimedOperation();
    // READY, and the quiet window opened after the claim but has not yet run the
    // ledger's full stabilization period.
    const result = await reconcileOutboxReservation(
      { itemId: "item-1", operationId: "outbox-1", observation: observation({ quietSince: 19_500 }), evidence },
      { ledger }
    );
    expect(result.status === "RECONCILED" && result.operation.state).toBe("OBSERVED_ACCEPTED");
    expect((await ledger.get("outbox-1"))?.state).toBe("OBSERVED_ACCEPTED");
  });

  it("does not settle a turn that is still generating", async () => {
    const ledger = await claimedOperation();
    const result = await reconcileOutboxReservation(
      { itemId: "item-1", operationId: "outbox-1", observation: observation({ state: "GENERATING", quietSince: null }), evidence },
      { ledger }
    );
    expect(result.status === "RECONCILED" && result.operation.state).toBe("OBSERVED_ACCEPTED");
    expect((await ledger.get("outbox-1"))?.state).toBe("OBSERVED_ACCEPTED");
  });

  it("leaves an ambiguous operation exactly where it was", async () => {
    const ledger = await claimedOperation();
    const result = await reconcileOutboxReservation(
      {
        itemId: "item-1",
        operationId: "outbox-1",
        observation: observation(),
        evidence: { ...evidence, lastUserMessageFingerprint: fingerprintSubmissionPayload("a human typed this") }
      },
      { ledger }
    );
    expect(result.status).toBe("RECONCILED");
    expect(await ledger.get("outbox-1")?.then(op => op?.state)).toBe("UNCERTAIN");
    expect((await ledger.get("outbox-1"))?.acceptedPayloadFingerprint).toBeUndefined();
  });

  it("refuses a reservation that is not this outbox's", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare({
      operationId: "go-1",
      operationKind: "GO",
      workItemId: "shuttle-bcr-run",
      logicalThreadId: "t1",
      targetCarrierRef: CARRIER_REF,
      providerConversationRef: CONVERSATION,
      dispatchFence: context(),
      payloadFingerprint: FINGERPRINT,
      payload: PAYLOAD,
      preSubmitBaseline: {
        conversationRef: CONVERSATION, routeRef: "/c/conv-1", assistantMessageCount: 1, userMessageCount: 4, observedAt: 500
      }
    });
    const result = await reconcileOutboxReservation(
      { itemId: "item-1", operationId: "go-1", observation: observation(), evidence },
      { ledger }
    );
    expect(result.status).toBe("NOT_RESERVED");
    expect(await ledger.get("go-1")?.then(op => op?.state)).toBe("PREPARED");
  });

  it("reports a missing reservation rather than inventing one", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    const result = await reconcileOutboxReservation(
      { itemId: "item-1", operationId: "outbox-missing", observation: observation(), evidence },
      { ledger }
    );
    expect(result.status).toBe("NOT_RESERVED");
    expect(await ledger.list()).toHaveLength(0);
  });
});

describe("reconcile is the only thing that touches a reserved operation", () => {
  it("never re-actuates: a reserved operation is reconciled, not re-dispatched", async () => {
    const ledger = await claimedOperation();
    const before = await ledger.get("outbox-1");
    await reconcileOutboxReservation(
      { itemId: "item-1", operationId: "outbox-1", observation: observation(), evidence },
      { ledger }
    );
    const after = await ledger.get("outbox-1");
    // Same claim: reconciling never mints a second attempt or a new claim time.
    expect(after?.dispatchClaimedAt).toBe(before?.dispatchClaimedAt);
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.state).toBe("COMPLETED");
    expect(await ledger.list()).toHaveLength(1);
  });
});

/**
 * Issue #99: the probe's reading is a claim about a moment that has already
 * passed by the time anything is inserted. A claim round-trip to the background
 * sits inside that window, and the provider is an SPA — the page can move to
 * another conversation in it, where the composer is just as present and just as
 * empty, so the composer check alone says "safe to write".
 *
 * These drive the real `dispatchOutboxMessage` against a jsdom page so the
 * assertion is about bytes, not about a predicate.
 */

/**
 * A page for one conversation: an empty, usable composer and nothing else.
 *
 * The composer declares `role="textbox"` because this is jsdom: the provider's
 * real composer is a contenteditable div and `isUsableComposer` accepts that via
 * `isContentEditable`, which jsdom does not implement. `role` is the same
 * disjunct the real element also matches, so the fixture reaches the same code
 * path rather than a test-only one.
 */
async function withConversationDom<T>(conversation: string, callback: () => Promise<T>): Promise<T> {
  const dom = new JSDOM(
    `<body><main><div id="prompt-textarea" contenteditable="true" role="textbox"></div></main></body>`,
    { url: `https://chatgpt.com/c/${conversation}`, pretendToBeVisual: true }
  );
  const win = dom.window as unknown as Window & typeof globalThis;
  Object.defineProperty(win.Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: Element) {
      const collapsed = win.getComputedStyle(this).display === "none";
      return { x: 0, y: 0, top: 0, left: 0, right: collapsed ? 0 : 94, bottom: collapsed ? 0 : 24, width: collapsed ? 0 : 94, height: collapsed ? 0 : 24, toJSON: () => ({}) };
    }
  });
  const keys = ["document", "window", "Node", "Element", "HTMLElement", "HTMLTextAreaElement", "InputEvent", "KeyboardEvent", "Event"] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: win[key as keyof typeof win], configurable: true });
  }
  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
}

function carrierSnapshot(observation: CarrierObservation): HumanGoCarrierSnapshot {
  const carrierState: HumanGoCarrierSnapshot["carrierState"] =
    observation.state === "READY" ? "READY" :
      observation.state === "ATTACHING" ? "ATTACHING" :
        observation.state === "STABILIZING" ? "STABILIZING" :
          observation.state === "GENERATING" ? "GENERATING" : "BROKEN";
  return {
    logicalThreadId: `thread:${observation.providerConversationRef ?? observation.routeRef}`,
    providerConversationRef: observation.providerConversationRef ?? "",
    bindingEpoch: observation.sourceEpoch,
    leaseGeneration: observation.sourceEpoch,
    leaseOwnerRef: observation.executionInstanceRef,
    targetCarrierRef: observation.carrierRef,
    carrierState,
    logicalControl: "CONTINUE",
    explicitGo: true,
    sourceEpoch: observation.sourceEpoch,
    sourceObservedAt: observation.observedAt
  };
}

/** The composer's current text, read straight off the page. */
function composerText(): string {
  const composer = (globalThis as unknown as { document: Document }).document.getElementById("prompt-textarea");
  return composer?.textContent ?? "";
}

/**
 * A page that can change under the dispatch, plus a live read that always
 * answers with whatever the page is *now*.
 *
 * Deliberately not a scripted call sequence: a sequence is coupled to how many
 * times the runtime happens to ask, so it silently shifts when the code around
 * it changes — which is exactly what a regression fixture must not do.
 */
interface LivePage {
  now: CarrierObservation;
  read(): { observation: CarrierObservation; carrier: HumanGoCarrierSnapshot };
  /** The page navigates while the claim round-trip is in flight. */
  navigateDuringClaim(ledger: SubmissionOperationLedger, moved: CarrierObservation): SubmissionOperationLedger;
}

function livePage(initial: CarrierObservation): LivePage {
  const page: LivePage = {
    now: initial,
    read: () => ({ observation: page.now, carrier: carrierSnapshot(page.now) }),
    navigateDuringClaim: (ledger, moved) => {
      const hooked = Object.create(ledger) as SubmissionOperationLedger;
      hooked.claim = async (operationId: string, context: SubmissionClaimContext, now?: number) => {
        page.now = moved;
        return ledger.claim(operationId, context, now);
      };
      return hooked;
    }
  };
  return page;
}

function outboxLedger(): SubmissionOperationLedger {
  return new SubmissionOperationLedger(memoryStore());
}

const OTHER = "conversation:b";

/**
 * The reading an observer produces for a page that navigated away: the
 * conversation changes *and* the epoch bumps, because `normalizeObservation`
 * advances `sourceEpoch` whenever provider, route or conversation changes.
 */
function afterNavigation(conversation: string): CarrierObservation {
  return observation({
    providerConversationRef: conversation,
    routeRef: `/c/${conversation}`,
    sourceEpoch: observation().sourceEpoch + 1
  });
}

describe("a reading that has gone stale must not put bytes in the composer (issue #99)", () => {
  /**
   * The reproduction from the issue: probe on A, the SPA moves to B, B's
   * composer is present and empty. The composer gate passes; only an identity
   * re-check stops the write.
   */
  it("does not deliver into the conversation the page moved to", async () => {
    await withConversationDom(OTHER, async () => {
      const ledger = outboxLedger();
      // Already moved: every reading, including the one before the claim, is B.
      const page = livePage(afterNavigation(OTHER));
      const result = await dispatchOutboxMessage(
        { itemId: "item-1", operationId: "outbox-move", payload: PAYLOAD, payloadFingerprint: FINGERPRINT, revision: 1, observation: observation(), evidence },
        { ledger, readLiveCarrier: page.read }
      );
      expect(result.status).toBe("BLOCKED");
      // The bytes are the evidence: B's composer never received them.
      expect(composerText()).toBe("");
      // And nothing was recorded against the wrong conversation either.
      expect(await ledger.get("outbox-move")).toBeUndefined();
      expect(await ledger.list()).toHaveLength(0);
    });
  });

  it("does not deliver when the page moves inside the async submit gap", async () => {
    await withConversationDom(OTHER, async () => {
      // Still A when the runtime checks, B by the time it inserts: the move
      // happens inside the claim round-trip, which is the window that matters.
      const page = livePage(observation());
      const ledger = page.navigateDuringClaim(outboxLedger(), afterNavigation(OTHER));
      const result = await dispatchOutboxMessage(
        { itemId: "item-1", operationId: "outbox-move", payload: PAYLOAD, payloadFingerprint: FINGERPRINT, revision: 1, observation: observation(), evidence },
        { ledger, readLiveCarrier: page.read }
      );
      expect(result.status).not.toBe("DISPATCHED");
      expect(composerText()).toBe("");
      // The operation was claimed before the move and is not claimed to have
      // landed: UNCERTAIN is the honest reading, and reconciliation converges it.
      const stored = await ledger.get("outbox-move");
      expect(stored?.state).not.toBe("OBSERVED_ACCEPTED");
      expect(stored?.acceptedPayloadFingerprint).toBeUndefined();
    });
  });

  /**
   * Same conversation, same route, same epoch, different execution: the page was
   * reloaded inside the window. This isolates the execution-instance clause,
   * which the two navigation cases above would also catch via the epoch bump.
   */
  it("does not deliver across an execution-instance change in the gap", async () => {
    await withConversationDom("conv-1", async () => {
      const page = livePage(observation());
      const ledger = page.navigateDuringClaim(outboxLedger(), observation({ executionInstanceRef: "observer-next" }));
      const result = await dispatchOutboxMessage(
        { itemId: "item-1", operationId: "outbox-move", payload: PAYLOAD, payloadFingerprint: FINGERPRINT, revision: 1, observation: observation(), evidence },
        { ledger, readLiveCarrier: page.read }
      );
      expect(result.status).not.toBe("DISPATCHED");
      expect(composerText()).toBe("");
    });
  });

  it("still delivers when the reading is genuinely current", async () => {
    // The control: the guard must not block a delivery that is fine, or the
    // counterexamples above would pass for the wrong reason.
    await withConversationDom("conv-1", async () => {
      const steady = observation();
      const page = livePage(steady);
      const result = await dispatchOutboxMessage(
        { itemId: "item-1", operationId: "outbox-move", payload: PAYLOAD, payloadFingerprint: FINGERPRINT, revision: 1, observation: steady, evidence },
        { ledger: outboxLedger(), readLiveCarrier: page.read }
      );
      expect(result.status).toBe("DISPATCHED");
      // The control's positive evidence: the write did happen, so the
      // empty-composer assertions above are about the guard, not about a
      // composer that never worked.
      expect(composerText()).toBe(PAYLOAD);
    });
  });
});
