import { describe, expect, it } from "vitest";
import {
  SubmissionOperationLedger,
  fingerprintSubmissionPayload,
  type SubmissionClaimContext
} from "../src/core/submission-operation";
import { provenNotActuatedRefusal } from "../src/core/proven-refusal";
import { buildShortcutPayload, shortcutPayloadDefinition } from "../src/core/continuation-payload";
import { dispatchPrCommentSweep, type PrCommentSweepDispatchRequest } from "../src/content/pr-comment-sweep-dispatch";
import type { HumanGoCarrierSnapshot } from "../src/core/human-go-runtime";

/**
 * Issue #61 slice 5: the PR comment sweep must reach the durable ledger with its
 * real identity, matching the `SEDIMENT` (slice 2) and `OVERVIEW_HTML` (slice 4)
 * composer shape. The payload's bounded-authorization contract is pinned by
 * `tests/shortcut-payload.test.ts`; this pins the transport.
 */

const PR_REF = "futouyiba/noos-shuttle#61";
const CURSOR = "c-42";
const PAYLOAD = buildShortcutPayload("PR_COMMENT_SWEEP", { prRef: PR_REF, cursor: CURSOR });
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

function request(overrides: Partial<PrCommentSweepDispatchRequest> = {}): PrCommentSweepDispatchRequest {
  return {
    operationId: "pr-comment-sweep-1",
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

describe("dispatchPrCommentSweep", () => {
  it("records the PR_COMMENT_SWEEP kind, never GO, and dispatches exactly once", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    const dispatched: string[] = [];
    const result = await dispatchPrCommentSweep(request(), {
      ledger,
      readCurrentCarrier: async () => carrier(),
      dispatch: async payload => { dispatched.push(payload); }
    });

    expect(result.status).toBe("DISPATCHED");
    expect(dispatched).toEqual([PAYLOAD]);
    const records = await ledger.list();
    expect(records).toHaveLength(1);
    expect(records[0].operationKind).toBe("PR_COMMENT_SWEEP");
    expect(records[0].operationKind).not.toBe("GO");
    expect(records[0].workItemId).toBe(shortcutPayloadDefinition("PR_COMMENT_SWEEP").workItemId);
    expect(records[0].payloadFingerprint).toBe(FINGERPRINT);
    expect(records[0].state).toBe("DISPATCHING");
    expect(records[0].dispatchReceipt?.outcome).toBe("dispatched");
  });

  it("blocks on a carrier that is not READY without preparing or dispatching anything", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    let dispatched = false;
    const result = await dispatchPrCommentSweep(request(), {
      ledger,
      readCurrentCarrier: async () => carrier({ carrierState: "GENERATING" }),
      dispatch: async () => { dispatched = true; }
    });

    expect(result).toMatchObject({ status: "BLOCKED", reason: "carrier_not_ready" });
    expect(dispatched).toBe(false);
    expect(await ledger.list()).toHaveLength(0);
  });

  it("keeps a proven-not-actuated refusal on PR_COMMENT_SWEEP and converges back to PREPARED", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    const result = await dispatchPrCommentSweep(request(), {
      ledger,
      readCurrentCarrier: async () => carrier(),
      dispatch: async () => { throw provenNotActuatedRefusal("chatgpt_composer_not_empty"); }
    });

    expect(result.status).toBe("REFUSED");
    const operation = await ledger.get("pr-comment-sweep-1");
    expect(operation?.operationKind).toBe("PR_COMMENT_SWEEP");
    expect(operation?.state).toBe("PREPARED");
    expect(operation?.dispatchReceipt?.outcome).toBe("refused");
  });
});
