/** Minimal durable Bounded Continuation Run: one Human authorization for at most N governed GO rounds. Pure transitions; storage, actuation, and observation live with the caller (background coordinator + HumanGoRuntime). ASSISTED mode asks the Human every round; AUTO_X5 advances rounds through an isolated evaluator behind the same conservative gate. */
export type ContinuationRunStatus = "CREATED" | "ACTIVE" | "ENDED" | "CANCELLED" | "FAILED_SAFE";
export type ContinuationRunMode = "ASSISTED" | "AUTO_X5";
export type ContinuationRunPhase = "READY_TO_GO" | "DISPATCHING" | "ASSISTANT_GENERATING" | "STABILIZING" | "AWAITING_HUMAN_DECISION" | "EVALUATING" | "ENDED";
export type ContinuationStopReason =
  | "BUDGET_EXHAUSTED"
  | "WAIT_HUMAN"
  | "WAIT_REVIEW"
  | "WAIT_EVIDENCE"
  | "WAIT_EXTERNAL"
  | "GOAL_SATISFIED"
  | "OPTIONAL_SCOPE_EXTENSION"
  | "SCOPE_DRIFT"
  | "STALLED"
  | "USER_CANCELLED"
  | "USER_INTERVENTION"
  | "AUTHORITY_CHANGED"
  | "CONVERSATION_REBASE_REQUIRED"
  | "SUBMISSION_UNCERTAIN"
  | "CARRIER_FAILURE"
  | "EVALUATOR_UNAVAILABLE";

/** Budgets surfaced in the UI; <= EXPERIMENTAL_MAX_BUDGET can actually start. */
export const BCR_ALLOWED_BUDGETS = [1, 5, 10, 20] as const;
/** Experimental gate: real-evidence budget cap for auto/assisted runs until the offline gate produces evidence. */
export const BCR_EXPERIMENTAL_MAX_BUDGET = 5;

export interface ContinuationRun {
  runId: string;
  workItemId: string;
  logicalThreadId: string;
  providerConversationRef: string;
  bindingEpoch: number;
  mode: ContinuationRunMode;
  /** Run-local Goal/Scope snapshot frozen at start (AUTO_X5 requires a goal; ASSISTED may omit it). */
  goal?: string;
  scope?: string;
  maxContinuations: number;
  consumedContinuations: number;
  status: ContinuationRunStatus;
  phase: ContinuationRunPhase;
  stopReason?: ContinuationStopReason;
  pendingSubmissionOperationId?: string;
  acceptedOperationId?: string;
  lastConsumedTurnRef?: string;
  lastDecision?: "HUMAN_CONTINUE" | "HUMAN_STOP";
  createdAt: number;
  updatedAt: number;
}

export type ContinuationRunEvent =
  | { type: "DISPATCH_ISSUED"; operationId: string; providerConversationRef?: string; bindingEpoch?: number }
  | { type: "CARRIER_PHASE"; carrierState: "GENERATING" | "STABILIZING" | "BROKEN" }
  | { type: "REBIND"; bindingEpoch: number }
  | { type: "OPERATION_ACCEPTED"; operationId: string; turnRef?: string }
  | { type: "OPERATION_COMPLETED"; operationId: string; turnRef?: string }
  | { type: "OPERATION_UNCERTAIN"; operationId: string }
  | { type: "HUMAN_CONTINUE" }
  | { type: "EVALUATION_PASSED" }
  | { type: "EVALUATION_STOPPED"; reason: ContinuationStopReason }
  | { type: "HUMAN_STOP" }
  | { type: "USER_INTERVENTION" }
  | { type: "AUTHORITY_CHANGED" }
  | { type: "CONVERSATION_REBASE_REQUIRED" }
  | { type: "CARRIER_FAILURE" };

export interface ContinuationRunTransition { run: ContinuationRun; changed: boolean; error?: string; }

export interface StartContinuationRunInput {
  runId: string;
  workItemId: string;
  logicalThreadId: string;
  providerConversationRef: string;
  bindingEpoch: number;
  maxContinuations: number;
  mode?: ContinuationRunMode;
  goal?: string;
  scope?: string;
  now: number;
}

export function startContinuationRun(input: StartContinuationRunInput): ContinuationRun {
  for (const field of ["runId", "workItemId", "logicalThreadId", "providerConversationRef"] as const) {
    if (typeof input[field] !== "string" || input[field].trim() === "") throw new Error(`${field}: non-empty string required`);
  }
  if (!Number.isFinite(input.bindingEpoch) || input.bindingEpoch < 0) throw new Error("bindingEpoch: non-negative number required");
  if (!(BCR_ALLOWED_BUDGETS as readonly number[]).includes(input.maxContinuations)) throw new Error(`maxContinuations: expected one of ${BCR_ALLOWED_BUDGETS.join(" | ")}`);
  if (input.maxContinuations > BCR_EXPERIMENTAL_MAX_BUDGET) throw new Error(`maxContinuations ${input.maxContinuations} exceeds experimental cap ${BCR_EXPERIMENTAL_MAX_BUDGET} (real-evidence gate not passed)`);
  if (!Number.isFinite(input.now)) throw new Error("now: number required");
  const mode = input.mode ?? "ASSISTED";
  // AUTO_X5 runs need no user-authored goal: the evaluator's baseline is the
  // built-in "continue the assistant's own stated next step" contract.
  if (input.goal !== undefined && (typeof input.goal !== "string" || input.goal.trim() === "")) throw new Error("goal: non-empty string required when provided");
  if (input.scope !== undefined && (typeof input.scope !== "string" || input.scope.trim() === "")) throw new Error("scope: non-empty string required when provided");
  return {
    runId: input.runId,
    workItemId: input.workItemId,
    logicalThreadId: input.logicalThreadId,
    providerConversationRef: input.providerConversationRef,
    bindingEpoch: input.bindingEpoch,
    mode,
    goal: input.goal?.trim(),
    scope: input.scope?.trim(),
    maxContinuations: input.maxContinuations,
    consumedContinuations: 0,
    status: "ACTIVE",
    phase: "READY_TO_GO",
    createdAt: input.now,
    updatedAt: input.now
  };
}

/** True when the run may issue its next governed GO right now. MAX_IN_FLIGHT = 1 by construction: a dispatch requires no pending operation and a human-authorized decision slot. */
export function canDispatch(run: ContinuationRun, current: { providerConversationRef: string; bindingEpoch: number }): { ok: true } | { ok: false; error: string } {
  if (run.status !== "ACTIVE") return { ok: false, error: `run ${run.status}` };
  if (run.phase !== "READY_TO_GO") return { ok: false, error: `phase ${run.phase}` };
  if (run.pendingSubmissionOperationId !== undefined) return { ok: false, error: "pending submission in flight (MAX_IN_FLIGHT=1)" };
  if (run.consumedContinuations >= run.maxContinuations) return { ok: false, error: "budget exhausted" };
  if (current.providerConversationRef !== run.providerConversationRef) return { ok: false, error: "provider conversation changed" };
  if (current.bindingEpoch !== run.bindingEpoch) return { ok: false, error: "binding generation changed" };
  return { ok: true };
}

export function applyRunEvent(run: ContinuationRun, event: ContinuationRunEvent, now?: number): ContinuationRunTransition {
  if (isTerminal(run.status)) return { run, changed: false, error: `run already ${run.status}` };
  const next = { ...run };
  switch (event.type) {
    case "DISPATCH_ISSUED": {
      if (run.phase !== "READY_TO_GO") return { run, changed: false, error: `phase ${run.phase}, expected READY_TO_GO` };
      if (run.pendingSubmissionOperationId !== undefined) return { run, changed: false, error: "pending submission in flight" };
      if (event.providerConversationRef !== undefined && event.providerConversationRef !== run.providerConversationRef) return { run, changed: false, error: "provider conversation changed" };
      if (event.bindingEpoch !== undefined && event.bindingEpoch !== run.bindingEpoch) return { run, changed: false, error: "binding generation changed" };
      next.pendingSubmissionOperationId = event.operationId;
      next.phase = "ASSISTANT_GENERATING";
      break;
    }
    case "CARRIER_PHASE": {
      if (run.pendingSubmissionOperationId === undefined) return { run, changed: false };
      if (event.carrierState === "GENERATING") next.phase = "ASSISTANT_GENERATING";
      else if (event.carrierState === "STABILIZING") next.phase = "STABILIZING";
      else {
        next.status = "FAILED_SAFE";
        next.phase = "ENDED";
        next.stopReason = "CARRIER_FAILURE";
      }
      break;
    }
    case "REBIND": {
      if (run.phase !== "READY_TO_GO") return { run, changed: false, error: `phase ${run.phase}, expected READY_TO_GO` };
      if (run.pendingSubmissionOperationId !== undefined) return { run, changed: false, error: "pending submission in flight" };
      if (!Number.isFinite(event.bindingEpoch) || event.bindingEpoch < 0) return { run, changed: false, error: "bindingEpoch: non-negative number required" };
      next.bindingEpoch = event.bindingEpoch;
      break;
    }
    case "OPERATION_ACCEPTED": {
      if (run.pendingSubmissionOperationId !== event.operationId) return { run, changed: false, error: "acceptance for a non-pending operation" };
      if (run.acceptedOperationId === event.operationId) return { run, changed: false };
      next.acceptedOperationId = event.operationId;
      next.consumedContinuations = run.consumedContinuations + 1;
      if (event.turnRef !== undefined) next.lastConsumedTurnRef = event.turnRef;
      break;
    }    case "OPERATION_COMPLETED": {
      if (run.pendingSubmissionOperationId !== event.operationId) return { run, changed: false, error: "completion for a non-pending operation" };
      next.pendingSubmissionOperationId = undefined;
      if (run.acceptedOperationId !== event.operationId) {
        // Completion implies proven acceptance (Slice 1 records COMPLETED only
        // after PROVEN_ACCEPTED + a stable turn); backfill so budget
        // consumption stays exactly-once even if the ACCEPT event was lost.
        next.acceptedOperationId = event.operationId;
        next.consumedContinuations = run.consumedContinuations + 1;
      }
      if (event.turnRef !== undefined) next.lastConsumedTurnRef = event.turnRef;
      if (next.consumedContinuations >= next.maxContinuations) {
        next.status = "ENDED";
        next.phase = "ENDED";
        next.stopReason = "BUDGET_EXHAUSTED";
      } else if (next.mode === "AUTO_X5") {
        next.phase = "EVALUATING";
      } else {
        next.phase = "AWAITING_HUMAN_DECISION";
      }
      break;
    }
    case "OPERATION_UNCERTAIN": {
      if (run.pendingSubmissionOperationId !== event.operationId) return { run, changed: false, error: "uncertainty for a non-pending operation" };
      next.status = "FAILED_SAFE";
      next.phase = "ENDED";
      next.stopReason = "SUBMISSION_UNCERTAIN";
      break;
    }
    case "HUMAN_CONTINUE": {
      if (run.phase !== "AWAITING_HUMAN_DECISION") return { run, changed: false, error: `phase ${run.phase}, expected AWAITING_HUMAN_DECISION` };
      if (run.consumedContinuations >= run.maxContinuations) return { run, changed: false, error: "budget exhausted" };
      next.phase = "READY_TO_GO";
      next.lastDecision = "HUMAN_CONTINUE";
      break;
    }
    case "EVALUATION_PASSED": {
      if (run.phase !== "EVALUATING") return { run, changed: false, error: `phase ${run.phase}, expected EVALUATING` };
      next.phase = "READY_TO_GO";
      break;
    }
    case "EVALUATION_STOPPED": {
      if (run.phase !== "EVALUATING") return { run, changed: false, error: `phase ${run.phase}, expected EVALUATING` };
      next.status = "ENDED";
      next.phase = "ENDED";
      next.stopReason = event.reason;
      break;
    }
    case "HUMAN_STOP": {
      next.status = "CANCELLED";
      next.phase = "ENDED";
      next.stopReason = "USER_CANCELLED";
      next.lastDecision = "HUMAN_STOP";
      break;
    }
    case "USER_INTERVENTION": {
      next.status = "CANCELLED";
      next.phase = "ENDED";
      next.stopReason = "USER_INTERVENTION";
      break;
    }
    case "AUTHORITY_CHANGED": {
      next.status = "FAILED_SAFE";
      next.phase = "ENDED";
      next.stopReason = "AUTHORITY_CHANGED";
      break;
    }
    case "CONVERSATION_REBASE_REQUIRED": {
      next.status = "FAILED_SAFE";
      next.phase = "ENDED";
      next.stopReason = "CONVERSATION_REBASE_REQUIRED";
      break;
    }
    case "CARRIER_FAILURE": {
      next.status = "FAILED_SAFE";
      next.phase = "ENDED";
      next.stopReason = "CARRIER_FAILURE";
      break;
    }
    default:
      return { run, changed: false, error: "unknown event type" };
  }
  next.updatedAt = now !== undefined && now > run.updatedAt ? now : run.updatedAt;
  return { run: next, changed: true };
}

export function isTerminal(status: ContinuationRunStatus): boolean {
  return status === "ENDED" || status === "CANCELLED" || status === "FAILED_SAFE";
}

/** Real-use evidence candidate: captured because the run actually happened. Never gate-countable until a named label authority freezes it as a REAL fixture (see fixtures/continuation-eligibility/README.md). */
export interface CandidateContinuationFixture {
  candidateId: string;
  runId: string;
  continuationIndex: number;
  providerConversationRef: string;
  turnRef?: string;
  assistantTurnExcerpt?: string;
  decision: "HUMAN_CONTINUE" | "HUMAN_STOP" | "AUTO_CONTINUE" | "AUTO_STOP" | "BUDGET_ENDED" | "RUN_ABORTED";
  humanAction: "continued" | "stopped" | "intervened" | "pending";
  continuationMode?: "PLAIN_GO" | "REANCHOR_GO";
  assessment?: Record<string, unknown>;
  stopReason?: ContinuationStopReason;
  capturedAt: number;
}

export function createFixtureCandidate(run: ContinuationRun, input: { continuationIndex: number; turnRef?: string; assistantTurnExcerpt?: string; decision: CandidateContinuationFixture["decision"]; humanAction: CandidateContinuationFixture["humanAction"]; continuationMode?: CandidateContinuationFixture["continuationMode"]; assessment?: Record<string, unknown>; stopReason?: ContinuationStopReason; capturedAt: number }): CandidateContinuationFixture {
  return {
    candidateId: `${run.runId}:${input.continuationIndex}`,
    runId: run.runId,
    continuationIndex: input.continuationIndex,
    providerConversationRef: run.providerConversationRef,
    turnRef: input.turnRef,
    assistantTurnExcerpt: input.assistantTurnExcerpt,
    decision: input.decision,
    humanAction: input.humanAction,
    continuationMode: input.continuationMode,
    assessment: input.assessment,
    stopReason: input.stopReason,
    capturedAt: input.capturedAt
  };
}

/** Durable run store owned by the background coordinator (chrome.storage, one authority lock). Terminal runs and candidates are bounded tails; the store is projection source, never a second truth. */
export interface ContinuationRunStore {
  activeByConversation: Record<string, ContinuationRun>;
  ended: ContinuationRun[];
  candidates: CandidateContinuationFixture[];
}

export const CONTINUATION_RUN_STORE_KEY = "noosContinuationRunStore";
export const ENDED_RUN_TAIL_LIMIT = 20;
export const CANDIDATE_TAIL_LIMIT = 100;

export type ContinuationRunMutation =
  | { type: "get_active"; providerConversationRef: string }
  | { type: "start"; input: StartContinuationRunInput }
  | { type: "apply"; runId: string; event: ContinuationRunEvent; now: number }
  | { type: "check_dispatch"; runId: string; providerConversationRef: string; bindingEpoch: number }
  | {
      type: "record_round_evidence";
      runId: string;
      continuationIndex: number;
      turnRef?: string;
      assistantTurnExcerpt?: string;
      decision: CandidateContinuationFixture["decision"];
      humanAction: CandidateContinuationFixture["humanAction"];
      stopReason?: ContinuationStopReason;
      continuationMode?: "PLAIN_GO" | "REANCHOR_GO";
      assessment?: Record<string, unknown>;
      capturedAt: number;
    }
  | { type: "attach_candidate"; candidate: CandidateContinuationFixture };

export type ContinuationRunMutationResult =
  | { ok: true; run?: ContinuationRun; store: ContinuationRunStore }
  | { ok: false; error: string };

export function emptyContinuationRunStore(): ContinuationRunStore {
  return { activeByConversation: {}, ended: [], candidates: [] };
}

/** Pure store reducer; the background coordinator wraps it with storage + an exclusive lock. */
export function reduceContinuationRunStore(store: ContinuationRunStore, mutation: ContinuationRunMutation): ContinuationRunMutationResult {
  switch (mutation.type) {
    case "get_active": {
      if (typeof mutation.providerConversationRef !== "string" || mutation.providerConversationRef.trim() === "") return { ok: false, error: "providerConversationRef required" };
      return { ok: true, run: store.activeByConversation[mutation.providerConversationRef], store };
    }
    case "start": {
      let run: ContinuationRun;
      try {
        run = startContinuationRun(mutation.input);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      const existing = store.activeByConversation[run.providerConversationRef];
      if (existing !== undefined && !isTerminal(existing.status)) return { ok: false, error: `active run ${existing.runId} already exists for this conversation` };
      const activeByConversation = { ...store.activeByConversation, [run.providerConversationRef]: run };
      return { ok: true, run, store: { ...store, activeByConversation } };
    }
    case "apply": {
      const run = store.activeByConversation[mutationKey(store, mutation.runId)];
      if (run === undefined) return { ok: false, error: `unknown run ${mutation.runId}` };
      if (!Number.isFinite(mutation.now)) return { ok: false, error: "now: number required" };
      const transition = applyRunEvent(run, mutation.event, mutation.now);
      if (!transition.changed) return { ok: false, error: transition.error ?? "event not applied" };
      if (isTerminal(transition.run.status)) {
        const activeByConversation = { ...store.activeByConversation };
        delete activeByConversation[transition.run.providerConversationRef];
        return { ok: true, run: transition.run, store: { ...store, activeByConversation, ended: [transition.run, ...store.ended].slice(0, ENDED_RUN_TAIL_LIMIT) } };
      }
      return { ok: true, run: transition.run, store: { ...store, activeByConversation: { ...store.activeByConversation, [transition.run.providerConversationRef]: transition.run } } };
    }
    case "check_dispatch": {
      const run = store.activeByConversation[mutationKey(store, mutation.runId)];
      if (run === undefined) return { ok: false, error: `unknown run ${mutation.runId}` };
      const gate = canDispatch(run, { providerConversationRef: mutation.providerConversationRef, bindingEpoch: mutation.bindingEpoch });
      return gate.ok ? { ok: true, run, store } : { ok: false, error: gate.error };
    }
    case "record_round_evidence": {
      const run = store.activeByConversation[mutationKey(store, mutation.runId)];
      if (run === undefined) return { ok: false, error: `unknown run ${mutation.runId}` };
      if (!Number.isInteger(mutation.continuationIndex) || mutation.continuationIndex < 1) return { ok: false, error: "continuationIndex: positive integer required" };
      if (!Number.isFinite(mutation.capturedAt)) return { ok: false, error: "capturedAt: number required" };
      if (mutation.assessment !== undefined && (typeof mutation.assessment !== "object" || mutation.assessment === null)) return { ok: false, error: "assessment: object required when provided" };
      const candidate = createFixtureCandidate(run, {
        continuationIndex: mutation.continuationIndex,
        turnRef: mutation.turnRef,
        assistantTurnExcerpt: mutation.assistantTurnExcerpt,
        decision: mutation.decision,
        humanAction: mutation.humanAction,
        continuationMode: mutation.continuationMode,
        assessment: mutation.assessment,
        stopReason: mutation.stopReason,
        capturedAt: mutation.capturedAt
      });
      if (store.candidates.some((existing) => existing.candidateId === candidate.candidateId)) return { ok: true, run, store };
      return { ok: true, run, store: { ...store, candidates: [candidate, ...store.candidates].slice(0, CANDIDATE_TAIL_LIMIT) } };
    }
    case "attach_candidate": {
      const candidate = mutation.candidate;
      if (typeof candidate?.candidateId !== "string" || candidate.candidateId.trim() === "") return { ok: false, error: "candidate.candidateId required" };
      if (store.candidates.some((existing) => existing.candidateId === candidate.candidateId)) return { ok: true, store };
      return { ok: true, store: { ...store, candidates: [candidate, ...store.candidates].slice(0, CANDIDATE_TAIL_LIMIT) } };
    }
  }
}

function mutationKey(store: ContinuationRunStore, runId: string): string {
  for (const [conversationRef, run] of Object.entries(store.activeByConversation)) {
    if (run.runId === runId) return conversationRef;
  }
  return "";
}
