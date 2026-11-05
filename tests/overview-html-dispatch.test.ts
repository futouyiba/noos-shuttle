import { describe, expect, it } from "vitest";
import {
  SubmissionOperationLedger,
  fingerprintSubmissionPayload,
  type SubmissionClaimContext
} from "../src/core/submission-operation";
import { provenNotActuatedRefusal } from "../src/core/proven-refusal";
import { shortcutPayloadDefinition } from "../src/core/continuation-payload";
import { dispatchOverviewHtml, type OverviewHtmlDispatchRequest } from "../src/content/overview-html-dispatch";
import type { HumanGoCarrierSnapshot } from "../src/core/human-go-runtime";

/**
 * Issue #61 slice 4: the overview shortcut must reach the durable ledger with
 * its real identity. Slice 3 declared `OVERVIEW_HTML`; this pins the composer
 * end to end against the real ledger, matching the `SEDIMENT` slice 2 shape.
 */

const PAYLOAD = "请基于当前对话生成一份“深入浅出、图形化”的速览 HTML。";
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

function request(overrides: Partial<OverviewHtmlDispatchRequest> = {}): OverviewHtmlDispatchRequest {
  return {
    operationId: "overview-html-1",
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

describe("dispatchOverviewHtml", () => {
  it("records the OVERVIEW_HTML kind, never GO, and dispatches exactly once", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    const dispatched: string[] = [];
    const result = await dispatchOverviewHtml(request(), {
      ledger,
      readCurrentCarrier: async () => carrier(),
      dispatch: async payload => { dispatched.push(payload); }
    });

    expect(result.status).toBe("DISPATCHED");
    expect(dispatched).toEqual([PAYLOAD]);
    const records = await ledger.list();
    expect(records).toHaveLength(1);
    expect(records[0].operationKind).toBe("OVERVIEW_HTML");
    expect(records[0].operationKind).not.toBe("GO");
    expect(records[0].workItemId).toBe(shortcutPayloadDefinition("OVERVIEW_HTML").workItemId);
    expect(records[0].payloadFingerprint).toBe(FINGERPRINT);
    expect(records[0].state).toBe("DISPATCHING");
    expect(records[0].dispatchReceipt?.outcome).toBe("dispatched");
  });

  it("blocks on a carrier that is not READY without preparing or dispatching anything", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    let dispatched = false;
    const result = await dispatchOverviewHtml(request(), {
      ledger,
      readCurrentCarrier: async () => carrier({ carrierState: "GENERATING" }),
      dispatch: async () => { dispatched = true; }
    });

    expect(result).toMatchObject({ status: "BLOCKED", reason: "carrier_not_ready" });
    expect(dispatched).toBe(false);
    expect(await ledger.list()).toHaveLength(0);
  });

  it("keeps a proven-not-actuated refusal on OVERVIEW_HTML and converges back to PREPARED", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    const result = await dispatchOverviewHtml(request(), {
      ledger,
      readCurrentCarrier: async () => carrier(),
      dispatch: async () => { throw provenNotActuatedRefusal("chatgpt_composer_not_empty"); }
    });

    expect(result.status).toBe("REFUSED");
    const operation = await ledger.get("overview-html-1");
    expect(operation?.operationKind).toBe("OVERVIEW_HTML");
    expect(operation?.state).toBe("PREPARED");
    expect(operation?.dispatchReceipt?.outcome).toBe("refused");
  });
});
