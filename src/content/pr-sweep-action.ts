/**
 * PR comment sweep action boundary (issue #61 slice 5).
 *
 * This module owns everything that must happen before the governed transport is
 * allowed to prepare/claim/dispatch a sweep, plus the dispatch call itself:
 *
 *  - run/bounded-authorization gates;
 *  - explicit PR ref and explicit/stored cursor resolution;
 *  - a READY carrier observation and the pre-claim composer guard;
 *  - the reply-baseline capture taken immediately before dispatch.
 *
 * The UI supplies these as dependencies, so a test drives the same boundary the
 * content script uses. The dispatch closure is the only path to
 * `HumanGoRuntime`, which means a refusal above is structurally unable to
 * prepare, claim or dispatch anything: the closure is simply never called.
 */
import { buildShortcutPayload } from "../core/continuation-payload";
import type { HumanGoResult } from "../core/human-go-runtime";
import type { SubmissionBaseline, SubmissionOperation } from "../core/submission-operation";
import type { PrCommentSweepDispatchRequest } from "./pr-comment-sweep-dispatch";
import type { PrSweepReplyBaseline } from "./pr-sweep-reply-capture";

/** The observation fields the sweep boundary reads; the live observer carries more. */
export interface PrSweepActionObservation {
  providerConversationRef: string;
  carrierRef: string;
  sourceEpoch: number;
  executionInstanceRef: string;
  observedAt: number;
  assistantMessageCount?: number;
  userMessageCount?: number;
}

export interface PrSweepStoredCursorRead {
  ok?: boolean;
  cursor?: string;
  error?: string;
}

export type PrSweepMessageEvidence = Pick<
  SubmissionBaseline,
  "headFingerprint" | "lastUserMessageFingerprint" | "lastAssistantMessageFingerprint"
>;

export interface PrSweepActionDeps {
  isRunActive(): boolean;
  readInputs(): { prRef: string; explicitCursor: string };
  isRuntimeAvailable(): boolean;
  readStoredCursor(prRef: string): Promise<PrSweepStoredCursorRead>;
  awaitReadyObservation(): Promise<PrSweepActionObservation | undefined>;
  isComposerEmpty(): boolean;
  routeRef(): string;
  sourceUrl(): string;
  assistantMessageCount(): number;
  readMessageEvidence(): PrSweepMessageEvidence;
  /** Captured after every refusal check and immediately before dispatch. */
  captureReplyBaseline(payload: string): PrSweepReplyBaseline | undefined;
  fingerprintText(value: string): string;
  now(): number;
  createOperationId?(now: number): string;
  /**
   * The governed dispatch (prepare → claim → provider write). The caller binds
   * its own ledger and carrier re-read here; this module never builds them.
   */
  dispatch(request: PrCommentSweepDispatchRequest, observation: PrSweepActionObservation): Promise<HumanGoResult>;
}

export type PrSweepActionRefusalReason =
  | "run_active"
  | "missing_pr_ref"
  | "runtime_unavailable"
  | "cursor_read_failed"
  | "missing_cursor"
  | "observation_unavailable"
  | "composer_not_empty"
  | "reply_baseline_unavailable";

export type PrSweepActionPlan = {
  /** The exact observation the dispatch was bound to. */
  observation: PrSweepActionObservation;
  /** Dispatch time, used for the operation's claim fallback. */
  now: number;
  /** What the wait path must accept a reply relative to. */
  replyBaseline: PrSweepReplyBaseline;
  prRef: string;
  storedCursor: string | null;
  operationId: string;
};

export type PrSweepActionResult =
  | { status: "refused"; reason: PrSweepActionRefusalReason; detail?: string }
  | { status: "failed"; detail: string }
  | ({ status: "BLOCKED"; reason: string } & PrSweepActionPlan)
  | ({
      status: "DISPATCHED" | "UNCERTAIN" | "REFUSED";
      operation: SubmissionOperation;
      /** Present for `REFUSED`; the transport's own reason. */
      reason?: string;
    } & PrSweepActionPlan);

function defaultOperationId(now: number): string {
  return `pr-comment-sweep-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Run the pre-claim boundary and, only when every check passes, hand one exact
 * request to the governed dispatch. No fallback, no retry, no second writer.
 */
export async function runPrSweepAction(deps: PrSweepActionDeps): Promise<PrSweepActionResult> {
  if (deps.isRunActive()) {
    return { status: "refused", reason: "run_active" };
  }

  const { prRef, explicitCursor } = deps.readInputs();
  if (!prRef) return { status: "refused", reason: "missing_pr_ref" };
  if (!deps.isRuntimeAvailable()) return { status: "refused", reason: "runtime_unavailable" };

  let storedCursor: string | null = null;
  try {
    const stored = await deps.readStoredCursor(prRef);
    if (stored?.ok !== true) {
      return { status: "refused", reason: "cursor_read_failed", detail: stored?.error ?? "cursor_read_failed" };
    }
    if (typeof stored.cursor === "string" && stored.cursor.trim()) storedCursor = stored.cursor;
  } catch (error) {
    return {
      status: "refused",
      reason: "cursor_read_failed",
      detail: error instanceof Error ? error.message : String(error)
    };
  }

  const payloadCursor = explicitCursor || storedCursor;
  if (!payloadCursor) return { status: "refused", reason: "missing_cursor" };

  const observation = await deps.awaitReadyObservation();
  if (!observation) return { status: "refused", reason: "observation_unavailable" };

  // Pre-claim only. A Human draft outranks a generated payload, and a claim made
  // before this reading would park the transport as UNCERTAIN (issues #98/#106).
  if (!deps.isComposerEmpty()) return { status: "refused", reason: "composer_not_empty" };

  const now = deps.now();
  const payload = buildShortcutPayload("PR_COMMENT_SWEEP", {
    prRef,
    cursor: payloadCursor,
    sourceUrl: deps.sourceUrl(),
    conversationRef: observation.providerConversationRef
  });
  const replyBaseline = deps.captureReplyBaseline(payload);
  if (!replyBaseline) return { status: "refused", reason: "reply_baseline_unavailable" };

  const baseline: SubmissionBaseline = {
    conversationRef: observation.providerConversationRef,
    routeRef: deps.routeRef(),
    assistantMessageCount: observation.assistantMessageCount ?? deps.assistantMessageCount(),
    userMessageCount: observation.userMessageCount ?? 0,
    ...deps.readMessageEvidence(),
    observedAt: now
  };
  const operationId = (deps.createOperationId ?? defaultOperationId)(now);
  const request: PrCommentSweepDispatchRequest = {
    operationId,
    payload,
    payloadFingerprint: deps.fingerprintText(payload),
    preSubmitBaseline: baseline,
    carrier: {
      providerConversationRef: observation.providerConversationRef,
      targetCarrierRef: observation.carrierRef,
      bindingEpoch: observation.sourceEpoch,
      leaseGeneration: observation.sourceEpoch,
      leaseOwnerRef: observation.executionInstanceRef,
      sourceEpoch: observation.sourceEpoch,
      sourceObservedAt: observation.observedAt
    },
    now
  };

  let result: HumanGoResult;
  try {
    result = await deps.dispatch(request, observation);
  } catch (error) {
    return { status: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
  const plan: PrSweepActionPlan = { observation, now, replyBaseline, prRef, storedCursor, operationId };
  if (result.status === "BLOCKED") {
    return { status: "BLOCKED", reason: result.reason, ...plan };
  }
  return {
    status: result.status,
    operation: result.operation,
    reason: result.status === "REFUSED" ? result.reason : undefined,
    ...plan
  };
}
