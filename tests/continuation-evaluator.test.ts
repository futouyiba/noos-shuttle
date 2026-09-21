import { describe, expect, it, vi } from "vitest";
import {
  BCR_EVALUATOR_ALLOWED_HOST,
  buildEvaluatorMessages,
  evaluateContinuation,
  mapStopReason,
  normalizeEvaluatorConfig,
  stopVetoHit,
  type ContinuationEvaluatorConfig
} from "../src/core/continuation-evaluator";
import type { ContinuationAssessment } from "../src/core/continuation-eligibility";

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
    expect(mapStopReason(assessment({ confidence: "MEDIUM" }))).toBe("WAIT_HUMAN");
    expect(mapStopReason(assessment({ goal_status: "UNCERTAIN" }))).toBe("WAIT_HUMAN");
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

  it("stops on low confidence even when every other field looks continuable", async () => {
    const fetchImpl = vi.fn(async () => chatResponse(JSON.stringify(assessment({ confidence: "LOW" }))));
    const verdict = await evaluateContinuation({ goal: "g", scope: "s", assistantTurnExcerpt: "advanced" }, config, fetchImpl as unknown as typeof fetch);
    expect(verdict.decision).toBe("WOULD_STOP");
    expect(verdict.stopReason).toBe("WAIT_HUMAN");
  });

  it("lets the deterministic veto override an LLM continue", async () => {
    const fetchImpl = vi.fn(async () => chatResponse(JSON.stringify(assessment())));
    const verdict = await evaluateContinuation({ goal: "g", scope: "s", assistantTurnExcerpt: "推进完成。下一步你需要选择 A 还是 B。" }, config, fetchImpl as unknown as typeof fetch);
    expect(verdict.decision).toBe("WOULD_STOP");
    expect(verdict.stopReason).toBe("WAIT_HUMAN");
    expect(verdict.vetoHit).toBe(true);
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
