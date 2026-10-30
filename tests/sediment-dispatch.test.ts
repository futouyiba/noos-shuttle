import { describe, expect, it } from "vitest";
import {
  SubmissionOperationLedger,
  fingerprintSubmissionPayload,
  type SubmissionClaimContext
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
});
