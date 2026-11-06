import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildShortcutPayload } from "../src/core/continuation-payload";
import type { HumanGoResult } from "../src/core/human-go-runtime";
import type { SubmissionOperation } from "../src/core/submission-operation";
import type { PrCommentSweepDispatchRequest } from "../src/content/pr-comment-sweep-dispatch";
import { runPrSweepAction, type PrSweepActionDeps, type PrSweepActionObservation } from "../src/content/pr-sweep-action";

/**
 * Issue #61 slice 5, reviewer follow-up: the UI pre-claim wiring must be proven
 * by an integration counterexample, not only by a parser test. These cases drive
 * the same boundary the content script calls (`runPrSweepAction`) with a
 * counting dispatch closure — the closure is the only path to
 * `HumanGoRuntime`'s prepare/claim/transport, so a refusal must leave it at 0.
 */

const PR_REF = "futouyiba/noos-shuttle#61";
const CURSOR = "c-1";
const OBSERVATION: PrSweepActionObservation = {
  providerConversationRef: "conversation:a",
  carrierRef: "browser-tab:7",
  sourceEpoch: 3,
  executionInstanceRef: "observer-abc",
  observedAt: 1_000,
  assistantMessageCount: 2,
  userMessageCount: 1
};
const OPERATION = {
  operationId: "pr-comment-sweep-1",
  logicalThreadId: "thread:conversation:a"
} as unknown as SubmissionOperation;
const REPLAY_BASELINE = { headText: "baseline answer", turnAnchor: "查一下 PR" };

function dispatched(): HumanGoResult {
  return { status: "DISPATCHED", operation: OPERATION };
}

function harness(overrides: Partial<PrSweepActionDeps> = {}) {
  const calls = {
    storedCursorReads: 0,
    dispatches: 0
  };
  const requests: PrCommentSweepDispatchRequest[] = [];
  const dispatch = vi.fn(async (request: PrCommentSweepDispatchRequest): Promise<HumanGoResult> => {
    calls.dispatches += 1;
    requests.push(request);
    return dispatched();
  });
  const deps: PrSweepActionDeps = {
    isRunActive: () => false,
    readInputs: () => ({ prRef: PR_REF, explicitCursor: CURSOR }),
    isRuntimeAvailable: () => true,
    readStoredCursor: async () => {
      calls.storedCursorReads += 1;
      return { ok: true, cursor: "stored-c-1" };
    },
    awaitReadyObservation: async () => OBSERVATION,
    isComposerEmpty: () => true,
    routeRef: () => "/c/example",
    sourceUrl: () => "https://chatgpt.com/c/example",
    assistantMessageCount: () => 2,
    readMessageEvidence: () => ({ headFingerprint: "head-fp" }),
    captureReplyBaseline: () => REPLAY_BASELINE,
    fingerprintText: value => `fp:${value.length}`,
    now: () => 2_000,
    createOperationId: () => "pr-comment-sweep-test",
    dispatch,
    ...overrides
  };
  return { deps, calls, requests, dispatch };
}

describe("runPrSweepAction — pre-claim refusal never reaches prepare/claim/dispatch", () => {
  it("refuses a missing explicit PR ref before reading storage or dispatching", async () => {
    const h = harness({ readInputs: () => ({ prRef: "", explicitCursor: CURSOR }) });

    const result = await runPrSweepAction(h.deps);

    expect(result).toEqual({ status: "refused", reason: "missing_pr_ref" });
    expect(h.calls.storedCursorReads).toBe(0);
    expect(h.calls.dispatches).toBe(0);
  });

  it("refuses when neither an explicit nor a stored cursor exists", async () => {
    const h = harness({
      readInputs: () => ({ prRef: PR_REF, explicitCursor: "" }),
      readStoredCursor: async () => ({ ok: true })
    });

    const result = await runPrSweepAction(h.deps);

    expect(result).toEqual({ status: "refused", reason: "missing_cursor" });
    expect(h.calls.dispatches).toBe(0);
  });

  it("refuses while a bounded run is ACTIVE without touching inputs or storage", async () => {
    const h = harness({ isRunActive: () => true });
    const readInputs = vi.fn(h.deps.readInputs);
    h.deps.readInputs = readInputs;

    const result = await runPrSweepAction(h.deps);

    expect(result).toEqual({ status: "refused", reason: "run_active" });
    expect(readInputs).not.toHaveBeenCalled();
    expect(h.calls.storedCursorReads).toBe(0);
    expect(h.calls.dispatches).toBe(0);
  });

  it("refuses without the browser runtime", async () => {
    const h = harness({ isRuntimeAvailable: () => false });

    const result = await runPrSweepAction(h.deps);

    expect(result).toEqual({ status: "refused", reason: "runtime_unavailable" });
    expect(h.calls.dispatches).toBe(0);
  });

  it("refuses when the stored cursor cannot be read", async () => {
    const h = harness({ readStoredCursor: async () => ({ ok: false, error: "storage_unavailable" }) });

    const result = await runPrSweepAction(h.deps);

    expect(result).toEqual({ status: "refused", reason: "cursor_read_failed", detail: "storage_unavailable" });
    expect(h.calls.dispatches).toBe(0);
  });

  it("refuses without a READY observation", async () => {
    const h = harness({ awaitReadyObservation: async () => undefined });

    const result = await runPrSweepAction(h.deps);

    expect(result).toEqual({ status: "refused", reason: "observation_unavailable" });
    expect(h.calls.dispatches).toBe(0);
  });

  it("keeps the Human's draft ahead of the claim", async () => {
    const h = harness({ isComposerEmpty: () => false });

    const result = await runPrSweepAction(h.deps);

    expect(result).toEqual({ status: "refused", reason: "composer_not_empty" });
    expect(h.calls.dispatches).toBe(0);
  });

  it("refuses when the reply baseline cannot be captured", async () => {
    const h = harness({ captureReplyBaseline: () => undefined });

    const result = await runPrSweepAction(h.deps);

    expect(result).toEqual({ status: "refused", reason: "reply_baseline_unavailable" });
    expect(h.calls.dispatches).toBe(0);
  });
});

describe("runPrSweepAction — a valid plan dispatches exactly once", () => {
  it("builds the canonical PR_COMMENT_SWEEP request and returns the reply boundary", async () => {
    const h = harness();

    const result = await runPrSweepAction(h.deps);

    expect(h.dispatch).toHaveBeenCalledTimes(1);
    const request = h.requests[0];
    expect(request.payload).toBe(buildShortcutPayload("PR_COMMENT_SWEEP", {
      prRef: PR_REF,
      cursor: CURSOR,
      sourceUrl: "https://chatgpt.com/c/example",
      conversationRef: OBSERVATION.providerConversationRef
    }));
    expect(request.payload).toContain(`查一下 PR ${PR_REF} 自 ${CURSOR}`);
    expect(request.operationId).toBe("pr-comment-sweep-test");
    expect(request.preSubmitBaseline).toMatchObject({
      conversationRef: OBSERVATION.providerConversationRef,
      routeRef: "/c/example",
      assistantMessageCount: 2,
      userMessageCount: 1,
      headFingerprint: "head-fp",
      observedAt: 2_000
    });
    expect(request.carrier).toEqual({
      providerConversationRef: OBSERVATION.providerConversationRef,
      targetCarrierRef: OBSERVATION.carrierRef,
      bindingEpoch: OBSERVATION.sourceEpoch,
      leaseGeneration: OBSERVATION.sourceEpoch,
      leaseOwnerRef: OBSERVATION.executionInstanceRef,
      sourceEpoch: OBSERVATION.sourceEpoch,
      sourceObservedAt: OBSERVATION.observedAt
    });
    expect(result).toMatchObject({
      status: "DISPATCHED",
      operation: OPERATION,
      observation: OBSERVATION,
      now: 2_000,
      replyBaseline: REPLAY_BASELINE,
      prRef: PR_REF,
      storedCursor: "stored-c-1",
      operationId: "pr-comment-sweep-test"
    });
  });

  it("uses the stored cursor when the Human left the field empty", async () => {
    const h = harness({ readInputs: () => ({ prRef: PR_REF, explicitCursor: "" }) });

    const result = await runPrSweepAction(h.deps);

    expect(result.status).toBe("DISPATCHED");
    expect(h.requests[0].payload).toContain("自 stored-c-1 以来");
  });

  it("lets an explicit cursor override the stored snapshot for the payload", async () => {
    const h = harness();

    await runPrSweepAction(h.deps);

    expect(h.requests[0].payload).toContain(`自 ${CURSOR} 以来`);
    expect(h.requests[0].payload).not.toContain("自 stored-c-1 以来");
  });

  it("returns a transport failure as failed without claiming success", async () => {
    const h = harness({ dispatch: async () => { throw new Error("transport exploded"); } });

    const result = await runPrSweepAction(h.deps);

    expect(result).toEqual({ status: "failed", detail: "transport exploded" });
  });

  it("passes BLOCKED and REFUSED through unchanged", async () => {
    const blocked = harness({ dispatch: async () => ({ status: "BLOCKED", reason: "carrier_not_ready" }) });
    const refused = harness({
      dispatch: async () => ({
        status: "REFUSED",
        reason: "chatgpt_composer_not_empty",
        operation: OPERATION
      })
    });

    expect(await runPrSweepAction(blocked.deps)).toMatchObject({
      status: "BLOCKED",
      reason: "carrier_not_ready",
      replyBaseline: REPLAY_BASELINE
    });
    expect(await runPrSweepAction(refused.deps)).toMatchObject({
      status: "REFUSED",
      reason: "chatgpt_composer_not_empty",
      operation: OPERATION
    });
  });

  it("passes UNCERTAIN through and still returns the boundary for a non-advancing wait", async () => {
    const h = harness({ dispatch: async () => ({ status: "UNCERTAIN", operation: OPERATION }) });

    const result = await runPrSweepAction(h.deps);

    expect(result).toMatchObject({
      status: "UNCERTAIN",
      operation: OPERATION,
      replyBaseline: REPLAY_BASELINE
    });
  });
});

describe("content script wiring", () => {
  const index = readFileSync(fileURLToPath(new URL("../src/content/index.ts", import.meta.url)), "utf8");

  it("routes the UI action through the tested boundary before the governed dispatch", () => {
    expect(index).toContain("const outcome = await runPrSweepAction({");
    expect(index).toContain("dispatch: (request, observation) => dispatchPrCommentSweep(request, createGovernedDispatchDeps(observation))");
    expect(index.indexOf("runPrSweepAction(")).toBeLessThan(index.indexOf("dispatchPrCommentSweep("));
  });

  it("has no separate direct sweep dispatch outside that closure", () => {
    expect(index).not.toMatch(/await\s+dispatchPrCommentSweep\(/);
  });
});
