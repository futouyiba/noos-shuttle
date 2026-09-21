import { describe, expect, it, vi } from "vitest";
import {
  BCR_EVALUATOR_ALLOWED_HOST,
  BCR_MIN_EVALUATOR_EXCERPT_CHARS,
  buildEvaluatorMessages,
  evaluateContinuation,
  isEvaluatorExcerptUsable,
  mapStopReason,
  normalizeEvaluatorConfig,
  stopVetoHit,
  type ContinuationEvaluatorConfig
} from "../src/core/continuation-evaluator";
import { decideContinuation, type ContinuationAssessment } from "../src/core/continuation-eligibility";

const config: ContinuationEvaluatorConfig = { baseUrl: `https://${BCR_EVALUATOR_ALLOWED_HOST}`, apiKey: "sk-test", model: "deepseek-chat" };

function assessment(overrides: Partial<ContinuationAssessment> = {}): ContinuationAssessment {
  return {
    goal_status: "IN_PROGRESS",
    focus_status: "OPEN_ADVANCING",
    scope_relation: "WITHIN_SCOPE",
    dependency: "NONE",
    anchor_need: "NONE",
    confidence: "HIGH",
    ...overrides
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function chatResponse(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

describe("normalizeEvaluatorConfig", () => {
  it("accepts only https keys on the allowlisted host", () => {
    expect(normalizeEvaluatorConfig({ baseUrl: `https://${BCR_EVALUATOR_ALLOWED_HOST}`, apiKey: "k", model: "m" })).toEqual({ baseUrl: `https://${BCR_EVALUATOR_ALLOWED_HOST}`, apiKey: "k", model: "m" });
    expect(normalizeEvaluatorConfig({ baseUrl: "https://evil.example.com", apiKey: "k", model: "m" })).toBeUndefined();
    expect(normalizeEvaluatorConfig({ baseUrl: "http://api.deepseek.com", apiKey: "k", model: "m" })).toBeUndefined();
    expect(normalizeEvaluatorConfig({ baseUrl: "not a url", apiKey: "k", model: "m" })).toBeUndefined();
    expect(normalizeEvaluatorConfig({ baseUrl: `https://${BCR_EVALUATOR_ALLOWED_HOST}`, apiKey: "  ", model: "m" })).toBeUndefined();
    expect(normalizeEvaluatorConfig(null)).toBeUndefined();
  });
});

describe("stopVetoHit", () => {
  it("flags stop-boundary phrases in the turn tail", () => {
    expect(stopVetoHit("设计已经推进到这里。下一步你需要选择 A 还是 B。")).toBe(true);
    expect(stopVetoHit("All checks pass. The task is complete and verified.")).toBe(true);
    expect(stopVetoHit("当前无法继续，需要等待审核结果。")).toBe(true);
  });

  it("does not flag ordinary advancing turns", () => {
    expect(stopVetoHit("我对比了两种 reducer 方案，锁的粒度问题已经定位，接下来验证恢复路径。")).toBe(false);
    expect(stopVetoHit("Traced the fence rotation; the stale lease is now proven and I will check the recovery path next.")).toBe(false);
  });
});

describe("isEvaluatorExcerptUsable", () => {
  it("refuses an excerpt with no material to judge", () => {
    // The observed degenerate reads: an unrendered node, or a near-empty one.
    for (const excerpt of [undefined, "", "  \n ", "OK", "Done.", "已经完成"]) {
      expect(isEvaluatorExcerptUsable(excerpt), JSON.stringify(excerpt)).toBe(false);
    }
  });

  it("accepts a normal turn and ignores surrounding whitespace", () => {
    expect(isEvaluatorExcerptUsable("x".repeat(BCR_MIN_EVALUATOR_EXCERPT_CHARS))).toBe(true);
    expect(isEvaluatorExcerptUsable(`\n\n${"x".repeat(BCR_MIN_EVALUATOR_EXCERPT_CHARS - 1)}\n`)).toBe(false);
    expect(isEvaluatorExcerptUsable(`  ${"x".repeat(BCR_MIN_EVALUATOR_EXCERPT_CHARS)}  `)).toBe(true);
  });

  it("keeps the threshold above the observed degenerate reads and below the veto window", () => {
    expect(BCR_MIN_EVALUATOR_EXCERPT_CHARS).toBeGreaterThan(19);
    expect(BCR_MIN_EVALUATOR_EXCERPT_CHARS).toBeLessThanOrEqual(400);
  });
});

describe("mapStopReason", () => {
  it("maps every stop-relevant field faithfully", () => {
    expect(mapStopReason(assessment({ goal_status: "SATISFIED" }))).toBe("GOAL_SATISFIED");
    expect(mapStopReason(assessment({ scope_relation: "OUT_OF_SCOPE" }))).toBe("SCOPE_DRIFT");
    expect(mapStopReason(assessment({ scope_relation: "OPTIONAL_EXTENSION" }))).toBe("OPTIONAL_SCOPE_EXTENSION");
    expect(mapStopReason(assessment({ dependency: "NEEDS_HUMAN" }))).toBe("WAIT_HUMAN");
    expect(mapStopReason(assessment({ dependency: "NEEDS_REVIEW" }))).toBe("WAIT_REVIEW");
    expect(mapStopReason(assessment({ dependency: "NEEDS_EVIDENCE" }))).toBe("WAIT_EVIDENCE");
    expect(mapStopReason(assessment({ dependency: "NEEDS_EXTERNAL" }))).toBe("WAIT_EXTERNAL");
    expect(mapStopReason(assessment({ focus_status: "STALLED_SUSPECTED" }))).toBe("STALLED");
  });

  // The reported reason must name the term that actually blocked the gate, so a
  // confidence-blocked stop no longer reads as "the model asked for a Human".
  it("names the blocking gate term instead of folding it into WAIT_HUMAN", () => {
    expect(mapStopReason(assessment({ confidence: "LOW" }))).toBe("CONFIDENCE_TOO_LOW");
    expect(mapStopReason(assessment({ goal_status: "UNCERTAIN" }))).toBe("ASSESSMENT_UNCERTAIN");
    expect(mapStopReason(assessment({ scope_relation: "UNCERTAIN" }))).toBe("ASSESSMENT_UNCERTAIN");
    expect(mapStopReason(assessment({ dependency: "UNCERTAIN" }))).toBe("ASSESSMENT_UNCERTAIN");
    expect(mapStopReason(assessment({ focus_status: "UNCERTAIN" }))).toBe("ASSESSMENT_UNCERTAIN");
    expect(mapStopReason(assessment({ focus_status: "BLOCKED" }))).toBe("FOCUS_NOT_ADVANCING");
    expect(mapStopReason(assessment({ focus_status: "SATISFIED" }))).toBe("FOCUS_NOT_ADVANCING");
  });

  // issue #85 (ACCEPT 2026-09-21) widened the gate from HIGH alone to HIGH | MEDIUM.
  // The reason is therefore named for "below what the gate accepts", not for HIGH:
  // a fully green MEDIUM reading is authorized and never reaches the mapping, and
  // pinning both halves here keeps the vocabulary honest if the gate moves again.
  it("keeps the confidence reason tied to the levels the gate accepts", () => {
    expect(decideContinuation(assessment({ confidence: "HIGH" }))).toBe("WOULD_CONTINUE");
    expect(decideContinuation(assessment({ confidence: "MEDIUM" }))).toBe("WOULD_CONTINUE");
    expect(decideContinuation(assessment({ confidence: "LOW" }))).toBe("WOULD_STOP");
    expect(mapStopReason(assessment({ confidence: "LOW" }))).toBe("CONFIDENCE_TOO_LOW");
  });

  it("keeps the named conditions ahead of the generic ones", () => {
    // Two terms can block at once; the vocabulary's own named condition wins.
    expect(mapStopReason(assessment({ goal_status: "SATISFIED", confidence: "LOW" }))).toBe("GOAL_SATISFIED");
    expect(mapStopReason(assessment({ dependency: "NEEDS_REVIEW", confidence: "LOW" }))).toBe("WAIT_REVIEW");
    expect(mapStopReason(assessment({ scope_relation: "OUT_OF_SCOPE", focus_status: "BLOCKED" }))).toBe("SCOPE_DRIFT");
  });
});

describe("buildEvaluatorMessages", () => {
  it("keeps the envelope bounded and the JSON contract explicit", () => {
    const messages = buildEvaluatorMessages({ goal: "g", scope: "s", assistantTurnExcerpt: "turn text" });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("STRICT JSON");
    expect(messages[0].content).toContain("must NOT plan");
    expect(messages[1].content).toContain("Current Goal (frozen for this run): g");
    expect(messages[1].content).toContain("turn text");
  });

  it("falls back to the built-in continue-its-own-direction contract without a goal", () => {
    const messages = buildEvaluatorMessages({ assistantTurnExcerpt: "turn text" });
    expect(messages[1].content).toContain("Continue the assistant's own stated next step");
    expect(messages[1].content).not.toContain("undefined");
  });
});

describe("evaluateContinuation", () => {
  it("returns WOULD_CONTINUE only for the exact conservative conjunction", async () => {
    const fetchImpl = vi.fn(async () => chatResponse(JSON.stringify(assessment())));
    const verdict = await evaluateContinuation({ goal: "g", scope: "s", assistantTurnExcerpt: "advanced" }, config, fetchImpl as unknown as typeof fetch);
    expect(verdict.decision).toBe("WOULD_CONTINUE");
    expect(verdict.stopReason).toBeUndefined();
    expect(verdict.vetoHit).toBe(false);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${config.baseUrl}/chat/completions`);
    expect(String((init.headers as Record<string, string>).Authorization)).toBe("Bearer sk-test");
  });

  it("maps a satisfied goal to a faithful stop", async () => {
    const fetchImpl = vi.fn(async () => chatResponse(JSON.stringify(assessment({ goal_status: "SATISFIED" }))));
    const verdict = await evaluateContinuation({ goal: "g", scope: "s", assistantTurnExcerpt: "done" }, config, fetchImpl as unknown as typeof fetch);
    expect(verdict.decision).toBe("WOULD_STOP");
    expect(verdict.stopReason).toBe("GOAL_SATISFIED");
  });

  it("wraps fenced JSON and ignores prose around it", async () => {
    const content = "Here is my assessment:\n```json\n" + JSON.stringify(assessment()) + "\n```";
    const fetchImpl = vi.fn(async () => chatResponse(content));
    const verdict = await evaluateContinuation({ goal: "g", scope: "s", assistantTurnExcerpt: "advanced" }, config, fetchImpl as unknown as typeof fetch);
    expect(verdict.decision).toBe("WOULD_CONTINUE");
  });

  // LOW is the one confidence level the gate still rejects: issue #85 widened the
  // accepted set to HIGH | MEDIUM, and the MEDIUM-continues case is pinned below.
  it("stops on low confidence even when every other field looks continuable", async () => {
    const fetchImpl = vi.fn(async () => chatResponse(JSON.stringify(assessment({ confidence: "LOW" }))));
    const verdict = await evaluateContinuation({ goal: "g", scope: "s", assistantTurnExcerpt: "advanced" }, config, fetchImpl as unknown as typeof fetch);
    expect(verdict.decision).toBe("WOULD_STOP");
    expect(verdict.stopReason).toBe("CONFIDENCE_TOO_LOW");
  });

  it("reports a model that declined to judge as its own reason, not as a Human wait", async () => {
    const fetchImpl = vi.fn(async () => chatResponse(JSON.stringify(assessment({ goal_status: "UNCERTAIN", dependency: "UNCERTAIN" }))));
    const verdict = await evaluateContinuation({ goal: "g", scope: "s", assistantTurnExcerpt: "advanced" }, config, fetchImpl as unknown as typeof fetch);
    expect(verdict.decision).toBe("WOULD_STOP");
    expect(verdict.stopReason).toBe("ASSESSMENT_UNCERTAIN");
  });

  it("lets the deterministic veto override an LLM continue", async () => {
    const fetchImpl = vi.fn(async () => chatResponse(JSON.stringify(assessment())));
    const verdict = await evaluateContinuation({ goal: "g", scope: "s", assistantTurnExcerpt: "推进完成。下一步你需要选择 A 还是 B。" }, config, fetchImpl as unknown as typeof fetch);
    expect(verdict.decision).toBe("WOULD_STOP");
    expect(verdict.stopReason).toBe("WAIT_HUMAN");
    expect(verdict.vetoHit).toBe(true);
  });

  // The all-green assessment the veto flips is exactly the input that used to be
  // indistinguishable from a model-authored stop once it reached the durable
  // candidate pool: the verdict carries vetoHit, and the round record must keep it.
  it("hands the veto flag to the caller alongside an all-green assessment", async () => {
    const fetchImpl = vi.fn(async () => chatResponse(JSON.stringify(assessment())));
    const verdict = await evaluateContinuation({ goal: "g", scope: "s", assistantTurnExcerpt: "推进完成。下一步你需要选择 A 还是 B。" }, config, fetchImpl as unknown as typeof fetch);
    expect(verdict.assessment).toEqual(assessment());
    expect(verdict.decision).toBe("WOULD_STOP");
    expect(verdict.stopReason).toBe("WAIT_HUMAN");
    expect(verdict.vetoHit).toBe(true);
  });

  it("leaves the veto flag unset when no veto evaluation ran", async () => {
    const failing = vi.fn(async () => { throw new Error("network down"); });
    const denied = await evaluateContinuation({ goal: "g", scope: "s", assistantTurnExcerpt: "x" }, config, failing as unknown as typeof fetch);
    expect(denied.stopReason).toBe("EVALUATOR_UNAVAILABLE");
    expect(denied.vetoHit).toBeUndefined();
  });

  it("fails closed on invalid JSON, HTTP errors, and transport failures", async () => {
    const badJson = vi.fn(async () => chatResponse("I think we should continue because reasons."));
    expect((await evaluateContinuation({ goal: "g", scope: "s", assistantTurnExcerpt: "x" }, config, badJson as unknown as typeof fetch)).stopReason).toBe("EVALUATOR_UNAVAILABLE");
    const httpError = vi.fn(async () => new Response("no", { status: 401 }));
    const denied = await evaluateContinuation({ goal: "g", scope: "s", assistantTurnExcerpt: "x" }, config, httpError as unknown as typeof fetch);
    expect(denied.decision).toBe("WOULD_STOP");
    expect(denied.error).toBe("evaluator_http_401");
    const failing = vi.fn(async () => { throw new Error("network down"); });
    expect((await evaluateContinuation({ goal: "g", scope: "s", assistantTurnExcerpt: "x" }, config, failing as unknown as typeof fetch)).stopReason).toBe("EVALUATOR_UNAVAILABLE");
  });

  it("rejects assessments with unknown enum values", async () => {
    const fetchImpl = vi.fn(async () => chatResponse(JSON.stringify({ ...assessment(), goal_status: "DONE" })));
    const verdict = await evaluateContinuation({ goal: "g", scope: "s", assistantTurnExcerpt: "x" }, config, fetchImpl as unknown as typeof fetch);
    expect(verdict.stopReason).toBe("EVALUATOR_UNAVAILABLE");
  });

  // The runtime verdict over the issue #85 confidence gate: this is the shape the
  // reported bug produced — four green semantic fields, only the evaluator's
  // self-reported certainty at MEDIUM — and the old rule reported it to the Human
  // as WAIT_HUMAN ("waiting for your decision") without any boundary being stated.
  it("continues a fully green MEDIUM assessment through the runtime verdict (issue #85 ACCEPT)", async () => {
    const fetchImpl = vi.fn(async () => chatResponse(JSON.stringify(assessment({ confidence: "MEDIUM" }))));
    const verdict = await evaluateContinuation({ goal: "g", scope: "s", assistantTurnExcerpt: "I traced the loader and the re-entry path is genuinely missing." }, config, fetchImpl as unknown as typeof fetch);
    expect(verdict.decision).toBe("WOULD_CONTINUE");
    expect(verdict.stopReason).toBeUndefined();
    expect(verdict.vetoHit).toBe(false);
    expect(verdict.assessment?.confidence).toBe("MEDIUM");
  });
});
