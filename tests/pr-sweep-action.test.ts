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
  it("refuses a missing explicit PR ref before touching inputs or dispatching", async () => {
    const h = harness({ readInputs: () => ({ prRef: "", explicitCursor: CURSOR }) });

    const result = await runPrSweepAction(h.deps);

    expect(result).toEqual({ status: "refused", reason: "missing_pr_ref" });
    expect(h.calls.dispatches).toBe(0);
  });

  it("refuses when the explicit cursor is empty: there is no stored fallback", async () => {
    const h = harness({ readInputs: () => ({ prRef: PR_REF, explicitCursor: "" }) });

    const result = await runPrSweepAction(h.deps);

    expect(result).toEqual({ status: "refused", reason: "missing_cursor" });
    expect(h.calls.dispatches).toBe(0);
  });

  it("refuses while a bounded run is ACTIVE without touching inputs", async () => {
    const h = harness({ isRunActive: () => true });
    const readInputs = vi.fn(h.deps.readInputs);
    h.deps.readInputs = readInputs;

    const result = await runPrSweepAction(h.deps);

    expect(result).toEqual({ status: "refused", reason: "run_active" });
    expect(readInputs).not.toHaveBeenCalled();
    expect(h.calls.dispatches).toBe(0);
  });

  it("refuses without the browser runtime", async () => {
    const h = harness({ isRuntimeAvailable: () => false });

    const result = await runPrSweepAction(h.deps);

    expect(result).toEqual({ status: "refused", reason: "runtime_unavailable" });
    expect(h.calls.dispatches).toBe(0);
  });

  it("has no stored-cursor dependency: the boundary cannot read or commit a watermark", () => {
    // This replaces the old "stored cursor unreadable" case. The capability is
    // gone, not merely broken: see the designer ruling on PR #151 (path B).
    const source = readFileSync(fileURLToPath(new URL("../src/content/pr-sweep-action.ts", import.meta.url)), "utf8");
    expect(source).not.toContain("NOOS_PR_SWEEP_CURSOR");
    expect(source).not.toContain("readStoredCursor");
    expect(source).not.toContain("storedCursor");
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
      operationId: "pr-comment-sweep-test"
    });
  });

  it("builds the payload solely from the explicit cursor", async () => {
    const h = harness({ readInputs: () => ({ prRef: PR_REF, explicitCursor: "human-range-1" }) });

    const result = await runPrSweepAction(h.deps);

    expect(result.status).toBe("DISPATCHED");
    expect(h.requests[0].payload).toContain("自 human-range-1 以来");
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

  it("wires the echo to observation only, with no durable cursor lane", () => {
    expect(index).not.toContain("NOOS_PR_SWEEP_CURSOR");
    expect(index).not.toContain("commitPrSweepCursor");
    expect(index).toContain("reportPrSweepCursorObservation(app, capture.cursor)");
  });
});
