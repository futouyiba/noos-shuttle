import { describe, expect, it } from "vitest";
import {
  PROVEN_NOT_ACTUATED_REFUSAL_NAME,
  SubmissionOperationLedger,
  fingerprintSubmissionPayload,
  isProvenNotActuatedRefusal,
  provenNotActuatedRefusal,
  type SubmissionOperation,
} from "../src/core/submission-operation";
import { PROVEN_NOT_ACTUATED_REFUSAL_NAME as CONTENT_NAME, isProvenNotActuatedRefusal as contentRecognizes, provenNotActuatedRefusal as contentConstructs } from "../src/core/proven-refusal";

/**
 * Issue #108's disposition, delta 5 — the discriminating pair, stated as the
 * ruling states it:
 *
 *   ① a post-claim *proven* refusal records a "refused" receipt, converges the
 *     operation to a non-execution-owning state, and a later authorized claim
 *     can proceed;
 *   ② an actually ambiguous attempt still becomes UNCERTAIN and blocks blind
 *     retry.
 *
 * Both directions are pinned here at the contract layer, because the whole
 * point of the slice is that the distinction lives in the ledger, not in any
 * single lane's caller.
 */

function memoryStore() {
  let records: SubmissionOperation[] = [];
  let authorities: Record<string, unknown> = {};
  return {
    get: async (key?: string) => (key === "noosSubmissionAuthority" ? authorities : { noosSubmissionOperations: records }),
    set: async (value: Record<string, unknown>) => {
      if (value.noosSubmissionOperations) records = value.noosSubmissionOperations as SubmissionOperation[];
      if (value.noosSubmissionAuthority) authorities = value.noosSubmissionAuthority as Record<string, unknown>;
      return value;
    },
    getAuthority: async (thread: string) => (authorities[thread] as never) ?? undefined,
    ensureAuthority: async (context: { logicalThreadId: string }) => {
      authorities[context.logicalThreadId] = { ...context, authorityGeneration: 1, authorityEstablishedAt: 1 };
    },
  };
}

const CONTEXT = {
  logicalThreadId: "thread:conv-1",
  providerConversationRef: "conv-1",
  bindingEpoch: 7,
  leaseGeneration: 7,
  leaseOwnerRef: "exec-1",
  targetCarrierRef: "browser-tab:1",
  carrierState: "READY" as const,
  logicalControl: "CONTINUE" as const,
  explicitGo: true,
  sourceEpoch: 7,
  sourceObservedAt: 1_000,
};

const BASELINE = { conversationRef: "conv-1", routeRef: "/c/conv-1", assistantMessageCount: 0, userMessageCount: 0, observedAt: 1_000 };

async function claimedOperation(kind: "GO" | "OUTBOX_MESSAGE" = "GO"): Promise<{ ledger: SubmissionOperationLedger; operationId: string }> {
  const ledger = new SubmissionOperationLedger(memoryStore());
  await ledger.initializeAuthority(CONTEXT);
  const operationId = `${kind.toLowerCase()}-1`;
  await ledger.prepare({
    operationId,
    operationKind: kind,
    workItemId: "wi-1",
    logicalThreadId: CONTEXT.logicalThreadId,
    targetCarrierRef: CONTEXT.targetCarrierRef,
    providerConversationRef: CONTEXT.providerConversationRef,
    dispatchFence: CONTEXT,
    payloadFingerprint: fingerprintSubmissionPayload("PAYLOAD"),
    payload: "PAYLOAD",
    preSubmitBaseline: BASELINE,
    now: 1_000,
  });
  const claimed = await ledger.claim(operationId, CONTEXT, 1_100);
  if (claimed?.state !== "DISPATCHING") throw new Error("fixture: claim did not produce DISPATCHING");
  return { ledger, operationId };
}

describe("delta 5 ①: post-claim proven refusal is recoverable (issue #108)", () => {
  it("records a 'refused' receipt, returns to PREPARED, and is not execution-owning", async () => {
    const { ledger, operationId } = await claimedOperation();
    const refused = await ledger.refuse(operationId, "chatgpt_composer_not_empty", 1_200);
    expect(refused?.state).toBe("PREPARED");
    expect(refused?.error).toBe("chatgpt_composer_not_empty");
    expect(refused?.dispatchReceipt).toMatchObject({ outcome: "refused", claimedAt: 1_100, attemptedAt: 1_200 });
    // The refused attempt is auditable: the claim stamp and fence survive.
    expect(refused?.dispatchClaimedAt).toBe(1_100);
    expect(refused?.dispatchReceipt?.fence.providerConversationRef).toBe("conv-1");
  });

  it("lets a later authorized claim proceed — the wedge UNCERTAIN used to cause", async () => {
    const { ledger, operationId } = await claimedOperation();
    await ledger.refuse(operationId, "chatgpt_composer_not_empty", 1_200);
    // The recovery delta-5 clause: the very same operation, re-claimed under
    // the still-current fence. Before this contract, a post-claim refusal sat
    // at UNCERTAIN and this claim returned undefined forever.
    const reclaimed = await ledger.claim(operationId, CONTEXT, 1_300);
    expect(reclaimed?.state).toBe("DISPATCHING");
    expect(reclaimed?.dispatchClaimedAt).toBe(1_300);
  });

  it("does not block another operation's claim on the same target", async () => {
    const { ledger, operationId } = await claimedOperation();
    await ledger.refuse(operationId, "chatgpt_composer_not_empty", 1_200);
    await ledger.prepare({
      operationId: "go-2",
      operationKind: "GO",
      workItemId: "wi-1",
      logicalThreadId: CONTEXT.logicalThreadId,
      targetCarrierRef: CONTEXT.targetCarrierRef,
      providerConversationRef: CONTEXT.providerConversationRef,
      dispatchFence: CONTEXT,
      payloadFingerprint: fingerprintSubmissionPayload("PAYLOAD 2"),
      payload: "PAYLOAD 2",
      preSubmitBaseline: { ...BASELINE, observedAt: 1_250 },
      now: 1_250,
    });
    const second = await ledger.claim("go-2", CONTEXT, 1_300);
    expect(second?.state).toBe("DISPATCHING");
  });

  it("refuses to re-fence blindly: a stale fence still fails the bare claim", async () => {
    const { ledger, operationId } = await claimedOperation();
    await ledger.refuse(operationId, "chatgpt_composer_not_empty", 1_200);
    // The page moved: a new epoch means the old fence is stale, and a bare
    // claim under it must not succeed (delta 2's "cannot reuse a stale fence
    // blindly") — the retry has to re-fence through retarget.
    const moved = { ...CONTEXT, bindingEpoch: 8, leaseGeneration: 8, sourceEpoch: 8, sourceObservedAt: 1_400 };
    await ledger.initializeAuthority(moved);
    const reclaimed = await ledger.claim(operationId, moved, 1_400);
    expect(reclaimed).toBeUndefined();
    // And retarget — the sanctioned re-fence — is available to it.
    const retargeted = await ledger.retarget(operationId, moved, { ...BASELINE, observedAt: 1_400 }, 1_400);
    expect(retargeted?.state).toBe("PREPARED");
    expect(retargeted?.dispatchFence?.bindingEpoch).toBe(8);
    expect(await (await ledger.claim(operationId, moved, 1_500))?.state).toBe("DISPATCHING");
  });

  it("applies to every specialization, not only GO", async () => {
    const { ledger, operationId } = await claimedOperation("OUTBOX_MESSAGE");
    const refused = await ledger.refuse(operationId, "chatgpt_composer_not_empty", 1_200);
    expect(refused?.state).toBe("PREPARED");
  });

  it("refuses anything that is not a proven post-claim refusal", async () => {
    const { ledger, operationId } = await claimedOperation();
    // Pre-claim: a PREPARED operation has nothing to refuse.
    const fresh = new SubmissionOperationLedger(memoryStore());
    await fresh.initializeAuthority(CONTEXT);
    await fresh.prepare({
      operationId: "prepared-1", operationKind: "GO", workItemId: "wi-1", logicalThreadId: CONTEXT.logicalThreadId,
      targetCarrierRef: CONTEXT.targetCarrierRef, providerConversationRef: CONTEXT.providerConversationRef,
      dispatchFence: CONTEXT, payloadFingerprint: fingerprintSubmissionPayload("P"), payload: "P", preSubmitBaseline: BASELINE, now: 1_000,
    });
    expect(await fresh.refuse("prepared-1", "chatgpt_composer_not_empty", 1_100)).toBeUndefined();
    // Ambiguous already recorded: UNCERTAIN is not re-writable by refuse.
    await ledger.record(operationId, "UNCERTAIN", { now: 1_200, error: "boom" });
    expect(await ledger.refuse(operationId, "chatgpt_composer_not_empty", 1_300)).toBeUndefined();
    expect((await ledger.get(operationId))?.state).toBe("UNCERTAIN");
    // Empty reason and non-monotonic now are not valid refusals either.
    const { ledger: l3, operationId: id3 } = await claimedOperation();
    expect(await l3.refuse(id3, "  ", 1_200)).toBeUndefined();
    expect(await l3.refuse(id3, "chatgpt_composer_not_empty", 1_000)).toBeUndefined();
    expect((await l3.get(id3))?.state).toBe("DISPATCHING");
  });

  it("survives the store round-trip with a refused receipt", async () => {
    const { ledger, operationId } = await claimedOperation();
    await ledger.refuse(operationId, "chatgpt_composer_not_empty", 1_200);
    const reloaded = await ledger.get(operationId);
    expect(reloaded?.dispatchReceipt?.outcome).toBe("refused");
    expect(reloaded?.state).toBe("PREPARED");
  });
});

describe("delta 5 ②: an actually ambiguous attempt stays fail-closed (issue #108 delta 4)", () => {
  it("records UNCERTAIN for an ambiguous failure and blocks a later claim on the same target", async () => {
    const { ledger, operationId } = await claimedOperation();
    // The submit failed after insertion — genuinely ambiguous, no refusal proof.
    await ledger.record(operationId, "UNCERTAIN", { now: 1_200, error: "chatgpt_composer_unavailable" });
    expect((await ledger.get(operationId))?.state).toBe("UNCERTAIN");
    await ledger.prepare({
      operationId: "go-2",
      operationKind: "GO",
      workItemId: "wi-1",
      logicalThreadId: CONTEXT.logicalThreadId,
      targetCarrierRef: CONTEXT.targetCarrierRef,
      providerConversationRef: CONTEXT.providerConversationRef,
      dispatchFence: CONTEXT,
      payloadFingerprint: fingerprintSubmissionPayload("PAYLOAD 2"),
      payload: "PAYLOAD 2",
      preSubmitBaseline: { ...BASELINE, observedAt: 1_250 },
      now: 1_250,
    });
    // Blind retry is blocked: the UNCERTAIN operation still owns execution.
    expect(await ledger.claim("go-2", CONTEXT, 1_300)).toBeUndefined();
  });

  it("reconcile from UNCERTAIN without provider evidence returns STILL_AMBIGUOUS", async () => {
    const { ledger, operationId } = await claimedOperation();
    await ledger.record(operationId, "UNCERTAIN", { now: 1_200, error: "boom" });
    const result = await ledger.reconcile(operationId, {
      conversationRef: "conv-1", routeRef: "/c/conv-1", assistantMessageCount: 0, userMessageCount: 0,
      observedAt: 1_400, sourceEpoch: 7, generationActive: false,
    });
    expect(result.outcome).toBe("STILL_AMBIGUOUS");
  });

  it("the record lane still cannot move DISPATCHING to PREPARED — refuse is the only door", async () => {
    const { ledger, operationId } = await claimedOperation();
    const recorded = await ledger.record(operationId, "PREPARED", { now: 1_200 });
    expect(recorded?.state).toBe("DISPATCHING");
  });
});

describe("the refusal signal crosses its bundle boundary intact", () => {
  it("pins the canonical and content-reachable names to one string", () => {
    expect(CONTENT_NAME).toBe(PROVEN_NOT_ACTUATED_REFUSAL_NAME);
  });

  it("each side recognizes the other's construction", () => {
    expect(contentRecognizes(provenNotActuatedRefusal("chatgpt_composer_not_empty"))).toBe(true);
    expect(isProvenNotActuatedRefusal(contentConstructs("chatgpt_composer_not_empty"))).toBe(true);
  });

  it("does not recognize ordinary errors", () => {
    expect(isProvenNotActuatedRefusal(new Error("chatgpt_composer_not_empty"))).toBe(false);
    expect(contentRecognizes(new Error("chatgpt_composer_unavailable"))).toBe(false);
    expect(isProvenNotActuatedRefusal(undefined)).toBe(false);
    expect(isProvenNotActuatedRefusal("chatgpt_composer_not_empty")).toBe(false);
  });
});
