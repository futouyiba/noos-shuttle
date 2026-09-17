/** Isolated Continuation Evaluator (V0: DeepSeek via its OpenAI-compatible chat-completions endpoint). Runs in the background service worker only; it never writes into the user's provider conversation and holds no actuation authority. The verdict always passes the conservative deterministic gate; the stop-veto word list can only tighten it. */
import {
  decideContinuation,
  parseAssessment,
  type ContinuationAssessment,
  type ContinuationDecision
} from "./continuation-eligibility";
import type { ContinuationStopReason } from "./continuation-run";

export interface ContinuationEvaluatorConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const BCR_EVALUATOR_CONFIG_KEY = "noosBcrEvaluatorConfig";
export const BCR_EVALUATOR_ALLOWED_HOST = "api.deepseek.com";
export const BCR_EVALUATOR_DEFAULT_MODEL = "deepseek-chat";
const EVALUATOR_TIMEOUT_MS = 30_000;
/** Deterministic stop veto: matched against the tail of the completed assistant turn. The veto can only flip a continue into a stop, never the reverse. */
const BCR_STOP_VETO_PATTERNS: readonly RegExp[] = [
  /你需要(在[^。；\n]{0,12})?(做)?(一个)?(选择|决定|确认)/,
  /请你?(选择|决定|确认|拍板)/,
  /选\s*(a|b|甲|乙)\s*还是/,
  /choose\s+(between\s+)?(a|b|option)/i,
  /you (need to|must) (choose|decide|pick|confirm)/i,
  /任务(已经)?(全部)?(完成|完成度)/,
  /目标(已经)?(完成|达成|满足)/,
  /(this|the) (task|goal) is (now )?(complete|completed|done|satisfied)/i,
  /等待(你|用户|人工|审核|审查|评审|外部|结果)/,
  /(waiting|wait) for (your|human|review|approval|external|the result)/i,
  /证据(仍然)?不足|insufficient evidence/i,
  /无法(继续|推进)|cannot (proceed|continue)/i
];
const VETO_TAIL_CHARS = 400;

export interface EvaluatorInput {
  /** Optional: when absent the built-in "continue its own stated next step" contract is the goal. */
  goal?: string;
  scope?: string;
  assistantTurnExcerpt: string;
}

/** The product-level continuation contract (Human decision, 2026-09-17): the harness exists to let the assistant execute its own declared next step, so this — not a user-authored goal — is the default evaluation basis. */
export const DEFAULT_CONTINUATION_GOAL = "Continue the assistant's own stated next step: the harness sends a plain 'go' so the assistant executes its own declared direction. Do not expand scope. Report any human decision, review/evidence/external wait, completed work, or scope expansion faithfully as the matching stop condition.";

export interface EvaluatorVerdict {
  decision: ContinuationDecision;
  assessment?: ContinuationAssessment;
  stopReason?: ContinuationStopReason;
  vetoHit?: boolean;
  error?: string;
}

export function normalizeEvaluatorConfig(raw: unknown): ContinuationEvaluatorConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = raw as Partial<ContinuationEvaluatorConfig>;
  if (typeof candidate.apiKey !== "string" || candidate.apiKey.trim() === "") return undefined;
  if (typeof candidate.model !== "string" || candidate.model.trim() === "") return undefined;
  if (typeof candidate.baseUrl !== "string") return undefined;
  try {
    const url = new URL(candidate.baseUrl.trim());
    if (url.protocol !== "https:" || url.hostname !== BCR_EVALUATOR_ALLOWED_HOST) return undefined;
    return {
      baseUrl: url.origin,
      apiKey: candidate.apiKey.trim(),
      model: candidate.model.trim()
    };
  } catch {
    return undefined;
  }
}

export function stopVetoHit(assistantTurnExcerpt: string): boolean {
  const tail = assistantTurnExcerpt.slice(-VETO_TAIL_CHARS);
  return BCR_STOP_VETO_PATTERNS.some(pattern => pattern.test(tail));
}

export function mapStopReason(assessment: ContinuationAssessment): ContinuationStopReason {
  if (assessment.goal_status === "SATISFIED") return "GOAL_SATISFIED";
  if (assessment.scope_relation === "OUT_OF_SCOPE") return "SCOPE_DRIFT";
  if (assessment.scope_relation === "OPTIONAL_EXTENSION") return "OPTIONAL_SCOPE_EXTENSION";
  switch (assessment.dependency) {
    case "NEEDS_HUMAN": return "WAIT_HUMAN";
    case "NEEDS_REVIEW": return "WAIT_REVIEW";
    case "NEEDS_EVIDENCE": return "WAIT_EVIDENCE";
    case "NEEDS_EXTERNAL": return "WAIT_EXTERNAL";
  }
  if (assessment.focus_status === "STALLED_SUSPECTED") return "STALLED";
  return "WAIT_HUMAN";
}

export function buildEvaluatorMessages(input: EvaluatorInput): ReadonlyArray<{ role: "system" | "user"; content: string }> {
  const goal = input.goal?.trim() || DEFAULT_CONTINUATION_GOAL;
  const scope = input.scope?.trim() || goal;
  const system = [
    "You are the NOOS Continuation Evaluator: an isolated classifier over a bounded design conversation.",
    "You classify ONLY the state of the deliberation relative to the frozen goal and scope below.",
    "You must NOT plan, invent methods, choose between options, or propose new work. A next-action hint is optional and may only restate an action the assistant turn explicitly stated or clearly entailed.",
    "Any uncertainty resolves to the UNCERTAIN enum value; never guess.",
    'Reply with STRICT JSON only (no prose, no code fences) using exactly these keys:',
    '{"goal_status":"IN_PROGRESS|SATISFIED|UNCERTAIN","focus_status":"OPEN_ADVANCING|SATISFIED|REFINED|BLOCKED|STALLED_SUSPECTED|UNCERTAIN","scope_relation":"WITHIN_SCOPE|OPTIONAL_EXTENSION|OUT_OF_SCOPE|UNCERTAIN","dependency":"NONE|NEEDS_HUMAN|NEEDS_REVIEW|NEEDS_EVIDENCE|NEEDS_EXTERNAL|UNCERTAIN","anchor_need":"NONE|SOFT|REBASE_SUSPECTED","confidence":"HIGH|MEDIUM|LOW"}',
    "Guidance: SATISFIED/UNCERTAIN goal, human choices, review/evidence/external waits, optional future work, scope drift, and stalls must all be reported faithfully — the harness stops on every one of them. A turn that advanced the current focus without stating an explicit next step is OPEN_ADVANCING, and that is a faithful report, not an invitation to invent one."
  ].join(" ");
  const user = [
    `Current Goal (frozen for this run): ${goal}`,
    `Current Scope: ${scope}`,
    "Completed Assistant Turn (excerpt, tail):",
    input.assistantTurnExcerpt
  ].join("\n");
  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user }
  ];
}

function parseEvaluatorContent(content: string): ContinuationAssessment {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  const jsonText = start >= 0 && end > start ? content.slice(start, end + 1) : content;
  return parseAssessment(JSON.parse(jsonText));
}

export async function evaluateContinuation(input: EvaluatorInput, config: ContinuationEvaluatorConfig, fetchImpl: typeof fetch = fetch): Promise<EvaluatorVerdict> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EVALUATOR_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: buildEvaluatorMessages(input),
          temperature: 0,
          max_tokens: 300,
          response_format: { type: "json_object" }
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) return { decision: "WOULD_STOP", stopReason: "EVALUATOR_UNAVAILABLE", error: `evaluator_http_${response.status}` };
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const assessment = parseEvaluatorContent(content);
    const veto = stopVetoHit(input.assistantTurnExcerpt);
    let decision = decideContinuation(assessment);
    let stopReason: ContinuationStopReason | undefined;
    if (decision === "WOULD_STOP") stopReason = mapStopReason(assessment);
    if (veto && decision === "WOULD_CONTINUE") {
      decision = "WOULD_STOP";
      stopReason = "WAIT_HUMAN";
    }
    return { decision, assessment, stopReason, vetoHit: veto };
  } catch (error) {
    return { decision: "WOULD_STOP", stopReason: "EVALUATOR_UNAVAILABLE", error: error instanceof Error ? error.message : String(error) };
  }
}
