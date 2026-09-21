import { describe, expect, it } from "vitest";
import {
  SubmissionOperationLedger,
  fingerprintSubmissionPayload,
  type SubmissionAuthority,
  type SubmissionClaimContext
} from "../src/core/submission-operation";
import { reconcileOutboxReservation } from "../src/content/outbox-dispatch";
import type { CarrierObservation } from "../src/content/runtime-observer";

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
    logicalThreadId: "t1",
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
    logicalThreadId: "t1",
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
