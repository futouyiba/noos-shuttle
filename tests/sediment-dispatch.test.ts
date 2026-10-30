import { describe, expect, it } from "vitest";
import {
  SubmissionOperationLedger,
  SUBMISSION_STABLE_WINDOW_MS,
  fingerprintSubmissionPayload,
  type SubmissionClaimContext,
  type SubmissionObservation
} from "../src/core/submission-operation";
import { provenNotActuatedRefusal } from "../src/core/proven-refusal";
import { shortcutPayloadDefinition } from "../src/core/continuation-payload";
import { dispatchSediment, type SedimentDispatchRequest } from "../src/content/sediment-dispatch";
import type { HumanGoCarrierSnapshot } from "../src/core/human-go-runtime";

/**
 * Issue #61 slice 2: the `SEDIMENT` shortcut must reach the durable ledger with
 * its real identity. Before this slice every shortcut was recorded as `GO`, so
 * the ledger and the Hub projection could not tell a sediment apart from an
 * ordinary continuation. These tests pin the composer to `SEDIMENT` end to end
 * against the real ledger.
 */

const PAYLOAD = "请基于当前对话做一次轻量沉淀。";
const FINGERPRINT = fingerprintSubmissionPayload(PAYLOAD);
const CONVERSATION = "conversation:a";
const CARRIER_REF = "browser-tab:7";
const OBSERVER = "observer-abc";
const LOGICAL_THREAD = `thread:${CONVERSATION}`;

function carrier(overrides: Partial<HumanGoCarrierSnapshot> = {}): HumanGoCarrierSnapshot {
  return {
    logicalThreadId: LOGICAL_THREAD,
    providerConversationRef: CONVERSATION,
    bindingEpoch: 3,
    leaseGeneration: 3,
    leaseOwnerRef: OBSERVER,
    targetCarrierRef: CARRIER_REF,
    carrierState: "READY",
    logicalControl: "CONTINUE",
    explicitGo: true,
    sourceEpoch: 3,
    sourceObservedAt: 1_000,
    ...overrides
  };
}

function authority(): SubmissionClaimContext {
  return {
    logicalThreadId: LOGICAL_THREAD,
    providerConversationRef: CONVERSATION,
    bindingEpoch: 3,
    leaseGeneration: 3,
    leaseOwnerRef: OBSERVER,
    targetCarrierRef: CARRIER_REF,
    carrierState: "READY",
    logicalControl: "CONTINUE",
    explicitGo: true,
    sourceEpoch: 3,
    sourceObservedAt: 1_000
  };
}

function memoryStore() {
  let value: unknown;
  const held = { ...authority(), authorityGeneration: 1, authorityEstablishedAt: 1_000 };
  return {
    get: async () => value,
    set: async (next: Record<string, unknown>) => { value = next; },
    ensureAuthority: async () => undefined,
    getAuthority: async (logicalThreadId: string) => logicalThreadId === LOGICAL_THREAD ? held : undefined
  };
}

function request(overrides: Partial<SedimentDispatchRequest> = {}): SedimentDispatchRequest {
  return {
    operationId: "sediment-1",
    payload: PAYLOAD,
    payloadFingerprint: FINGERPRINT,
    preSubmitBaseline: {
      conversationRef: CONVERSATION,
      routeRef: "/c/conversation-a",
      assistantMessageCount: 1,
      userMessageCount: 1,
      observedAt: 1_000
    },
    carrier: {
      providerConversationRef: CONVERSATION,
      targetCarrierRef: CARRIER_REF,
      bindingEpoch: 3,
      leaseGeneration: 3,
      leaseOwnerRef: OBSERVER,
      sourceEpoch: 3,
      sourceObservedAt: 1_000
    },
    now: 2_000,
    ...overrides
  };
}

/**
 * One post-dispatch observation of the same carrier. Counts and fingerprints
 * describe a *new turn* by default (the dispatched payload as the last user
 * turn); callers override them to model a foreign turn.
 */
function observation(overrides: Partial<SubmissionObservation> = {}): SubmissionObservation {
  return {
    conversationRef: CONVERSATION,
    routeRef: "/c/conversation-a",
    assistantMessageCount: 1,
    userMessageCount: 2,
    lastUserMessageFingerprint: FINGERPRINT,
    generationActive: true,
    observedAt: 3_000,
    sourceEpoch: 3,
    dispatchFence: {
      providerConversationRef: CONVERSATION,
      bindingEpoch: 3,
      leaseGeneration: 3,
      leaseOwnerRef: OBSERVER,
      targetCarrierRef: CARRIER_REF
    },
    ...overrides
  };
}

/** Dispatch through the real composer, then return the ledger's own timestamp. */
async function dispatchThenReadLastObservedAt(ledger: SubmissionOperationLedger): Promise<number> {
  const result = await dispatchSediment(request(), {
    ledger,
    readCurrentCarrier: async () => carrier(),
    dispatch: async () => undefined
  });
  expect(result.status).toBe("DISPATCHED");
  const operation = await ledger.get("sediment-1");
  expect(operation?.state).toBe("DISPATCHING");
  return operation?.lastObservedAt ?? 0;
}

describe("dispatchSediment", () => {
  it("records the SEDIMENT kind, never GO, and dispatches exactly once", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    const dispatched: string[] = [];
    const result = await dispatchSediment(request(), {
      ledger,
      readCurrentCarrier: async () => carrier(),
      dispatch: async payload => { dispatched.push(payload); }
    });

    expect(result.status).toBe("DISPATCHED");
    expect(dispatched).toEqual([PAYLOAD]);
    const records = await ledger.list();
    expect(records).toHaveLength(1);
    const operation = records[0];
    expect(operation.operationKind).toBe("SEDIMENT");
    expect(operation.operationKind).not.toBe("GO");
    // The work item id is the canonical registry value, not a second literal.
    expect(operation.workItemId).toBe(shortcutPayloadDefinition("SEDIMENT").workItemId);
    expect(operation.payload).toBe(PAYLOAD);
    expect(operation.payloadFingerprint).toBe(FINGERPRINT);
    expect(operation.logicalThreadId).toBe(LOGICAL_THREAD);
    expect(operation.state).toBe("DISPATCHING");
    expect(operation.dispatchReceipt?.outcome).toBe("dispatched");
  });

  it("blocks on a carrier that is not READY without preparing or dispatching anything", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    let dispatched = false;
    const result = await dispatchSediment(request(), {
      ledger,
      readCurrentCarrier: async () => carrier({ carrierState: "GENERATING" }),
      dispatch: async () => { dispatched = true; }
    });

    expect(result).toMatchObject({ status: "BLOCKED", reason: "carrier_not_ready" });
    expect(dispatched).toBe(false);
    expect(await ledger.list()).toHaveLength(0);
  });

  it("keeps a proven-not-actuated refusal on SEDIMENT and converges it back to PREPARED", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    const result = await dispatchSediment(request(), {
      ledger,
      readCurrentCarrier: async () => carrier(),
      dispatch: async () => { throw provenNotActuatedRefusal("chatgpt_composer_not_empty"); }
    });

    expect(result.status).toBe("REFUSED");
    const operation = await ledger.get("sediment-1");
    expect(operation?.operationKind).toBe("SEDIMENT");
    expect(operation?.state).toBe("PREPARED");
    // A refusal is recoverable and must not be encoded as an ambiguous send.
    expect(operation?.dispatchReceipt?.outcome).toBe("refused");
  });

  it("carries the exact dispatched bytes into the ledger fingerprint", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    const payload = `${PAYLOAD}\n\n# 沉淀：本轮结论`;
    await dispatchSediment(request({ payload, payloadFingerprint: fingerprintSubmissionPayload(payload) }), {
      ledger,
      readCurrentCarrier: async () => carrier(),
      dispatch: async () => undefined
    });
    expect((await ledger.get("sediment-1"))?.payloadFingerprint).toBe(fingerprintSubmissionPayload(payload));
  });

  /**
   * The review finding on slice 2: `SEDIMENT` is a real provider-facing
   * dispatch, so its acceptance must be *its own dispatched bytes* — never "some
   * new turn appeared on this carrier". The wrong-payload and unrelated-new-turn
   * cases below are the counter-examples; only the exact payload may become
   * `OBSERVED_ACCEPTED`.
   */
  it("reconciles to OBSERVED_ACCEPTED when the dispatched payload is the last user turn", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    const lastObservedAt = await dispatchThenReadLastObservedAt(ledger);

    const acceptedAt = lastObservedAt + 1_000;
    const result = await ledger.reconcile("sediment-1", observation({ observedAt: acceptedAt, stableSince: acceptedAt }));
    expect(result.outcome).toBe("PROVEN_ACCEPTED");
    expect(result.operation?.state).toBe("OBSERVED_ACCEPTED");
    expect(result.operation?.acceptedPayloadFingerprint).toBe(FINGERPRINT);

    // The completion gate (isCompletionEvidence) applies the same fingerprint
    // requirement: a stable, finished turn that is still ours may complete.
    await ledger.reconcile("sediment-1", observation({
      observedAt: acceptedAt + SUBMISSION_STABLE_WINDOW_MS + 1,
      stableSince: acceptedAt,
      generationActive: false
    }));
    const completed = await ledger.record("sediment-1", "COMPLETED", { now: acceptedAt + SUBMISSION_STABLE_WINDOW_MS + 2 });
    expect(completed?.state).toBe("COMPLETED");
  });

  it("does not treat some other new user turn as SEDIMENT acceptance", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    const lastObservedAt = await dispatchThenReadLastObservedAt(ledger);

    const result = await ledger.reconcile("sediment-1", observation({
      observedAt: lastObservedAt + 1_000,
      lastUserMessageFingerprint: fingerprintSubmissionPayload("a human typed this by hand")
    }));
    expect(result.outcome).toBe("STILL_AMBIGUOUS");
    expect(result.operation?.state).not.toBe("OBSERVED_ACCEPTED");
    // Fail-closed: parked as UNCERTAIN, with no acceptance proof stamped.
    expect(result.operation?.state).toBe("UNCERTAIN");
    expect((await ledger.get("sediment-1"))?.acceptedPayloadFingerprint).toBeUndefined();

    // Even a stable, finished turn built on that foreign message cannot close it.
    await ledger.reconcile("sediment-1", observation({
      observedAt: lastObservedAt + SUBMISSION_STABLE_WINDOW_MS + 2_000,
      stableSince: lastObservedAt + 1_000,
      generationActive: false,
      lastUserMessageFingerprint: fingerprintSubmissionPayload("a human typed this by hand")
    }));
    const completed = await ledger.record("sediment-1", "COMPLETED", { now: lastObservedAt + SUBMISSION_STABLE_WINDOW_MS + 2_001 });
    expect(completed?.state).not.toBe("COMPLETED");
    expect((await ledger.get("sediment-1"))?.acceptedPayloadFingerprint).toBeUndefined();
  });

  it("does not accept an unrelated assistant-only turn", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    const lastObservedAt = await dispatchThenReadLastObservedAt(ledger);

    const result = await ledger.reconcile("sediment-1", observation({
      observedAt: lastObservedAt + 1_000,
      userMessageCount: 1,
      lastUserMessageFingerprint: undefined,
      assistantMessageCount: 2
    }));
    expect(result.outcome).toBe("STILL_AMBIGUOUS");
    expect((await ledger.get("sediment-1"))?.state).toBe("UNCERTAIN");
    expect((await ledger.get("sediment-1"))?.acceptedPayloadFingerprint).toBeUndefined();
  });
});
