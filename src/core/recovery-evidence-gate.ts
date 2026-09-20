/**
 * Action-specific Evidence Gate for provider recovery (§4) and the
 * RecoveryBudget allowance it advances (§5.2).
 *
 * The decisive statement this module enforces:
 *
 *   > Unknown is not permission to recover by side effect. In `UNKNOWN /
 *   > UNCERTAIN`, NOOS may wait, re-observe, and reconcile; it may not refresh,
 *   > Retry, resend, send the continuation token, or rebase until the
 *   > action-specific evidence gate is satisfied.
 *
 * The continuation token is named by reference rather than repeated as a literal
 * so that `continuation-payload.ts` remains the only production site defining
 * it (see `tests/continuation-payload.test.ts`).
 *
 * Two structural properties make that enforcement fail-closed rather than
 * best-effort, and both are load-bearing:
 *
 *  1. Every evidence question is read through `isYes(verdict)`, which returns
 *     true only for the literal `"YES"` variant. Absent, malformed or
 *     explicitly `UNKNOWN` evidence therefore denies by construction — there is
 *     no code path in which a missing field reads as a pass.
 *  2. There is no shared "looks fine" gate. Each action has its own check list in
 *     `checkAction`, and a satisfied list for one action is never consulted for
 *     another. In particular the two things most tempting to conflate — a turn
 *     that is *accepted with an interrupted assistant* (§4.2) and a turn that is
 *     *not accepted* (§5.1) — drive opposite actions and cannot satisfy each
 *     other's gate.
 *
 * This module has no runtime authority. Nothing in `src/content/` or
 * `src/background/` imports it, and it performs no actuation.
 */

import type { SubmissionReconcileResult } from "./submission-operation";
import {
  CONTEXT_REBASE_ACTION,
  carryAcrossBinding,
  bindingChanged,
  bindingChangeReasons,
  consumesGoSlotOnAcceptance,
  isRecoveryAction,
  remainingGoSlots,
  remainingRecoveryAttempts,
  type EvidenceVerdict,
  type ProviderBinding,
  type RecoveryAction,
  type RecoveryActionId,
  type RecoveryAttemptLedgerEntry,
  type RecoveryBudget,
  type RecoveryBudgetScope,
  type RecoveryEvidence,
  type RecoveryGateDecision,
  type RecoveryGateDenyReason,
  type RecoveryGateEvaluation,
  type RecoveryGateAllow,
} from "./recovery-evidence-types";

/**
 * The run-side state the gate reads. It is deliberately a plain data record
 * rather than a `ContinuationRun`: this module must not depend on the Run
 * reducer's internals (that reducer is owned by a different slice), and the gate
 * must stay evaluable when the Run is paused, which the current reducer's status
 * union cannot represent.
 */
export interface RecoveryLoopContext {
  readonly binding: ProviderBinding;
  /** Monotonic evidence revision; carried into the attempt ledger for attribution. */
  readonly evidenceRevision: number;
  /** A Stop latch cancels every not-yet-actuated recovery action (§6.1). */
  readonly stopLatched?: boolean;
  /** Any Human input not attributable to this Run/recovery operation, including a hand-clicked provider Retry (§6.1). */
  readonly humanIntervention?: boolean;
  /** Browser Carrier identity. May change without affecting recovery (§4.1). */
  readonly currentCarrierRef?: string;
}

export interface RecoveryGateInput {
  readonly action: RecoveryActionId;
  readonly binding: ProviderBinding;
  /**
   * The binding the evidence was read against, as claimed by the reader. Checked
   * against `binding` (the binding being authorized for) before any other
   * evidence question is asked: evidence read off a different conversation is
   * not evidence about this one, and must not be able to satisfy this gate.
   */
  readonly observedBinding: ProviderBinding;
  readonly evidence: RecoveryEvidence;
  readonly context: RecoveryLoopContext;
  readonly budget: RecoveryBudget;
  readonly operationId: string;
  readonly now: number;
}

/**
 * The only pass predicate in this module. Everything that is not an explicit
 * `"YES"` — including every `"UNKNOWN"` and every absent field — denies. See
 * property (1) above.
 *
 * It accepts the raw material (`boolean | undefined`) as well as a typed
 * verdict, because an omitted optional field IS the `UNKNOWN` case: the caller
 * that never read a question and the caller that read it and got no answer must
 * both be denied, and neither has a value to wrap in a verdict. Accepting the
 * boolean keeps the fail-closed decision in one place instead of scattering
 * `=== true` through the check lists.
 */
function isYes<T extends string>(verdict: EvidenceVerdict<T> | boolean | undefined): boolean {
  return verdict === true || (typeof verdict === "object" && verdict !== null && verdict.status === "YES");
}

function deny(reason: RecoveryGateDenyReason, detail?: string): RecoveryGateDecision {
  return detail === undefined ? { verdict: "DENY", reason } : { verdict: "DENY", reason, detail };
}

/**
 * Gate ORDER is part of the semantics, not an implementation detail:
 *
 *   1. classify the action by actuation class — a `CONTEXT_REBASE` is refused
 *      by name, and a non-actuating action leaves here immediately, because
 *      every check below this line governs *actuation*;
 *   2. the Stop latch — §6.1 cancels "all not-yet-actuated
 *      refresh/retry/continue/recovery actions", which is exactly this class;
 *   3. Human intervention;
 *   4. binding identity, in both directions (see the two comparisons below);
 *   5. the action's own evidence list.
 *
 * Steps 1 and 2 must stay in this order. A latch or an intervention that fired
 * before step 1 would also halt `WAIT`/`REOBSERVE`/`RECONCILE`, and §4.1 makes
 * those the only automatic path out of `UNKNOWN/UNCERTAIN` — halting them would
 * strand the Run with no way to reach the reconciliation evidence that lifts it.
 */
function contextGate(input: RecoveryGateInput, budget: RecoveryBudget): RecoveryGateDecision | undefined {
  if (input.action === CONTEXT_REBASE_ACTION) {
    // §6.2 / §8.2: not authorized by ordinary Go × N authorization, and its
    // actuation is HUMAN_REQUIRED. Denied here rather than omitted from the
    // taxonomy, so a rebase request gets an attributed refusal.
    return deny(
      "REBASE_NOT_AUTHORIZED_BY_GO_N",
      "context rebase ends the Run, preserves the Logical Thread, establishes a new Provider Conversation through the Continuity workflow, and requires a new continuation authorization after RESUME_ELIGIBLE",
    );
  }
  if (!isRecoveryAction(input.action)) {
    // Non-actuating and in scope: no latch, intervention, binding or budget
    // check applies, because none of them governs a read.
    return undefined;
  }
  // Stop latch: a hard cancellation that no evidence can lift (§6.1).
  if (input.context.stopLatched === true) {
    return deny("STOP_LATCHED", "Stop latch cancels recovery actions that have not yet actuated");
  }
  if (input.context.humanIntervention === true) {
    return deny("HUMAN_INTERVENTION", "Human input outside this Run's recovery operations ends the Run (§6.1)");
  }
  // Evidence read against a different Provider Conversation is not evidence
  // about this one. Checked before the action's own questions so that
  // foreign-conversation material cannot satisfy any of them.
  if (input.observedBinding.providerConversationRef !== input.binding.providerConversationRef) {
    return deny(
      "SAME_CONVERSATION_UNPROVEN",
      `evidence read against ${input.observedBinding.providerConversationRef}, authorizing for ${input.binding.providerConversationRef}`,
    );
  }
  // §6.2: a binding change ends the Run, so the remainder of the old budget is
  // not actuation authority for the new conversation.
  if (bindingChanged(input.context.binding, input.binding)) {
    return deny(
      "BINDING_CHANGED",
      `binding changed (${bindingChangeReasons(input.context.binding, input.binding).join(", ")}); remaining Go × N budget does not cross a binding change as actuation authority`,
    );
  }
  if (budget.scope.bindingGeneration !== input.binding.bindingGeneration) {
    return deny("BINDING_CHANGED", `budget scope generation ${budget.scope.bindingGeneration} ≠ binding generation ${input.binding.bindingGeneration}`);
  }
  return undefined;
}

/** REFRESH: recover observation capability only; never implies resend (§4.1). */
function checkRefresh(evidence: RecoveryEvidence): RecoveryGateDecision | undefined {
  if (!isYes(evidence.sameProviderConversation)) {
    return deny("SAME_CONVERSATION_UNPROVEN", "same Provider Conversation/binding not established");
  }
  if (!isYes(evidence.executionOwnershipUnambiguous)) {
    return deny("EXECUTION_OWNERSHIP_AMBIGUOUS", "an execution-owning operation may still be in flight");
  }
  const humanState = evidence.humanStateSafety;
  if (humanState?.draftPresent === true && humanState.draftPreservedByAction !== true) {
    return deny("REFRESH_UNSAFE_FOR_HUMAN_STATE", "a refresh would discard a composer draft");
  }
  if (humanState?.ephemeralHumanStatePresent === true && humanState.ephemeralHumanStatePreservedByAction !== true) {
    return deny("REFRESH_UNSAFE_FOR_HUMAN_STATE", "a refresh would discard ephemeral Human state");
  }
  if (!isYes(evidence.refreshSafe)) {
    return deny("REFRESH_SAFETY_UNPROVEN", "refresh-safe evidence absent or unknown");
  }
  return undefined;
}

/**
 * PROVIDER_NATIVE_RETRY. §4.1 and §8.2 require provider/version-specific
 * semantics naming the target turn, the regenerate-vs-resubmit effect and
 * whether tools re-run. Today generic ChatGPT has none, so this gate denies —
 * deliberately and permanently until REAL_DOGFOOD evidence lands.
 */
function checkProviderNativeRetry(evidence: RecoveryEvidence): RecoveryGateDecision | undefined {
  const semantics = evidence.providerRetrySemantics;
  if (semantics?.status !== "VERIFIED") {
    return deny(
      "PROVIDER_RETRY_SEMANTICS_UNPROVEN",
      "no verified provider/version-specific Retry semantics; the existence of a Retry control is not evidence (§4.1)",
    );
  }
  if (semantics.targetTurnRef === undefined || semantics.effect === undefined) {
    return deny("PROVIDER_RETRY_TARGET_UNPROVEN", "verified semantics must pin the target turn and the regenerate-vs-resubmit effect");
  }
  // A native Retry regenerates provider work for an ALREADY-ACCEPTED user turn.
  // Without that acceptance this is Shuttle retry's problem, not this one.
  if (evidence.turnAcceptance !== "ACCEPTED") {
    return deny("ACCEPTANCE_NOT_PROVEN", "provider-native Retry requires a proven-accepted user turn");
  }
  if (evidence.assistantGeneration !== "DEFINITELY_INTERRUPTED") {
    return deny(
      evidence.assistantGeneration === "STILL_GENERATING" ? "ASSISTANT_GENERATION_STILL_RUNNING" : "ASSISTANT_GENERATION_UNKNOWN",
      "provider-native Retry requires a determinately interrupted assistant generation",
    );
  }
  if (evidence.sideEffectsOutstanding === true) {
    return deny("SIDE_EFFECTS_UNRESOLVED", "unresolved tool/external side effects");
  }
  return undefined;
}

/**
 * SHUTTLE_RETRY. §5.1: reachable only after `PROVEN_NOT_ACCEPTED`, and
 * `UNCERTAIN` must never be treated as unaccepted (§4.1). Because the acceptance
 * check below matches the literal `"PROVEN_NOT_ACCEPTED"`, an ambiguous or
 * unknown acceptance denies here — that is the mechanism, not a comment.
 */
function checkShuttleRetry(evidence: RecoveryEvidence): RecoveryGateDecision | undefined {
  // §4.2 stated as an assertion, not a preference: a provider-accepted user turn
  // whose assistant generation later interrupted must NEVER be Shuttle-retried.
  if (evidence.turnAcceptance === "ACCEPTED") {
    return deny(
      "ACCEPTED_TURN_MUST_NOT_BE_SHUTTLE_RETRIED",
      "an accepted user turn is recovered on the assistant side only; Shuttle resend of an accepted turn is forbidden",
    );
  }
  if (evidence.turnAcceptance !== "PROVEN_NOT_ACCEPTED") {
    return deny("ACCEPTANCE_UNKNOWN", "Shuttle retry requires PROVEN_NOT_ACCEPTED; UNCERTAIN is not evidence of non-acceptance");
  }
  if (evidence.logicalOperationId === undefined) {
    return deny("CONTINUATION_OPERATION_UNPROVEN", "the logical operation identity being retried is unspecified");
  }
  const attempt = evidence.dispatchAttemptRef;
  if (attempt === undefined || attempt.trim() === "") {
    return deny("CONTINUATION_OPERATION_UNPROVEN", "a retry requires a new dispatch attempt/fence");
  }
  if (evidence.priorAttemptRefs?.includes(attempt) === true) {
    return deny("CONTINUATION_OPERATION_UNPROVEN", `dispatch attempt ${attempt} was already used; re-using an attempt is not a new attempt`);
  }
  return undefined;
}

/** Discovery sentinels that occupy an operation id but assert nothing about a user turn. */
const NON_CONTINUATION_OPERATION_KINDS = new Set([
  "BOOTSTRAP",
  "REVIEW_DISPATCH",
  "SEDIMENT",
  "DELIVER_CHILD_RESULT",
  "REANCHOR_GOAL",
]);

/**
 * CONTINUE_PROVIDER_TURN. §4.1: requires a determinately accepted turn, an
 * observable assistant partial, a determinately interrupted generation, same
 * binding/head, no outstanding side effects and no Human intervention. It is not
 * a re-send of the original prompt (§4.2).
 */
function checkContinueProviderTurn(
  evidence: RecoveryEvidence,
  budget: RecoveryBudget,
): RecoveryGateDecision | undefined {
  if (evidence.turnAcceptance !== "ACCEPTED") {
    return deny("ACCEPTANCE_NOT_PROVEN", "continue requires a proven-accepted original user turn");
  }
  if (evidence.acceptedOperationId === undefined) {
    return deny("CONTINUATION_OPERATION_UNPROVEN", "the operation proving acceptance is unspecified");
  }
  if (evidence.acceptedOperationKind === undefined || NON_CONTINUATION_OPERATION_KINDS.has(evidence.acceptedOperationKind)) {
    return deny(
      "CONTINUATION_NOT_THE_RECOVERY_ACTION",
      `${evidence.acceptedOperationKind ?? "unknown"} acceptance is not continuation evidence (§4.1)`,
    );
  }
  if (evidence.acceptedTurnRef === undefined || evidence.acceptedTurnRef.trim() === "") {
    return deny("CONTINUATION_OPERATION_UNPROVEN", "the accepted turn ref is unspecified");
  }
  // §10-1: context limit and unclassified surfaces are not continue evidence, and
  // dispatching the continuation token under them is the failure §4.1 names by name.
  if (evidence.providerError !== undefined) {
    return deny(
      "CONTINUATION_NOT_THE_RECOVERY_ACTION",
      `provider error ${evidence.providerError.kind} does not satisfy the continue evidence gate`,
    );
  }
  if (!isYes(evidence.assistantPartialOutputObserved)) {
    return deny("CONTINUATION_PARTIAL_OUTPUT_UNPROVEN", "no observable assistant partial output");
  }
  if (evidence.assistantGeneration !== "DEFINITELY_INTERRUPTED") {
    return deny(
      evidence.assistantGeneration === "STILL_GENERATING" ? "ASSISTANT_GENERATION_STILL_RUNNING" : "ASSISTANT_GENERATION_UNKNOWN",
      "continue requires a determinately interrupted assistant generation",
    );
  }
  if (evidence.sideEffectsOutstanding === true) {
    return deny("SIDE_EFFECTS_UNRESOLVED", "unresolved tool/external side effects");
  }
  if (!isYes(evidence.sameProviderConversation)) {
    return deny("SAME_CONVERSATION_UNPROVEN", "same Provider Conversation/binding not established");
  }
  // §5.2 / §5.3: a new user turn is additionally subject to the remaining Go × N
  // budget — recovery does not create free semantic turns.
  if (remainingGoSlots(budget) <= 0) {
    return deny("CONTINUATION_SLOT_BUDGET_EXHAUSTED", "no remaining Go × N slot for a new user turn");
  }
  return undefined;
}

/** The per-action check list. Each action's list is private to that action. */
function checkAction(input: RecoveryGateInput): RecoveryGateDecision | undefined {
  switch (input.action) {
    case "WAIT":
    case "REOBSERVE":
    case "RECONCILE":
      // §4.1: the only automatic path out of UNKNOWN/UNCERTAIN. Bounded by
      // time/observation count by the caller; charged no Go slot and no attempt.
      return undefined;
    case "REFRESH":
      return checkRefresh(input.evidence);
    case "PROVIDER_NATIVE_RETRY":
      return checkProviderNativeRetry(input.evidence);
    case "SHUTTLE_RETRY":
      return checkShuttleRetry(input.evidence);
    case "CONTINUE_PROVIDER_TURN":
      return checkContinueProviderTurn(input.evidence, input.budget);
    default:
      return deny("ACTION_NOT_RECOVERABLE", `unhandled action ${String(input.action)}`);
  }
}

/**
 * Claim one recovery allowance for `input.action`, or deny it.
 *
 * Denials never mutate the budget: the returned `budget` is the one passed in,
 * so a caller that persists the result on every call cannot charge for an action
 * the gate refused. An `ALLOW` advances the attempt counter (observable and
 * attributable) and earns a `CONTINUE_PROVIDER_TURN` a Go-slot placeholder that
 * stays `ESTIMATED` until `chargeGoSlotOnAcceptance` confirms it.
 */
export function evaluateRecoveryGate(input: RecoveryGateInput): RecoveryGateEvaluation {
  const blocked = contextGate(input, input.budget);
  if (blocked !== undefined) return { decision: blocked, budget: input.budget };

  const actionBlocked = checkAction(input);
  if (actionBlocked !== undefined) return { decision: actionBlocked, budget: input.budget };

  // Non-actuating and in scope. Allowed unconditionally — no evidence, no
  // attempt, no slot — because that is what makes it the path that stays open
  // when everything else is denied. Returning before the budget checks below is
  // the mechanism: an exhausted budget, a latch or an intervention must not be
  // able to strand a Run with no way to read.
  if (!isRecoveryAction(input.action)) {
    return { decision: { verdict: "ALLOW", allowance: input.budget }, budget: input.budget };
  }

  // Read the invariant at claim time. It is total today, so this branch is
  // unreachable — the point is that it is written down where a future reviewer
  // would have to delete it deliberately to break the rule.
  const carries = carryAcrossBinding({ budget: input.budget, from: input.context.binding, to: input.binding }) as boolean;
  if (carries && bindingChanged(input.context.binding, input.binding)) {
    return { decision: deny("BINDING_CHANGED", "budget would cross a binding change"), budget: input.budget };
  }

  if (remainingRecoveryAttempts(input.budget) <= 0) {
    // §5.2: RecoveryBudget exhausted → HUMAN_REQUIRED. The caller maps this
    // denial to the human-required stop boundary; the gate does not resume.
    return { decision: deny("RECOVERY_BUDGET_EXHAUSTED", `maxAttempts ${input.budget.maxAttempts} exhausted`), budget: input.budget };
  }

  const revision = input.budget.revision + 1;
  const attemptId = `recov:${input.budget.budgetId}:${revision}`;
  const action = input.action as RecoveryAction;
  const ledgerEntry: RecoveryAttemptLedgerEntry = {
    attemptId,
    budgetId: input.budget.budgetId,
    action,
    operationId: input.operationId,
    revision,
    requestedAt: input.now,
    consideredEvidence: input.binding,
    ...(consumesGoSlotOnAcceptance(action) ? { goSlot: { slotRef: `${attemptId}:go`, state: "ESTIMATED" as const } } : {}),
  };
  const advanced: RecoveryBudget = {
    ...input.budget,
    consumedAttempts: input.budget.consumedAttempts + 1,
    revision,
  };
  const allowance: RecoveryGateAllow = {
    verdict: "ALLOW",
    action,
    allowance: advanced,
    ledgerEntryId: attemptId,
    ledgerEntry,
  };
  return { decision: allowance, budget: advanced };
}

/**
 * Confirm or release a `CONTINUE_PROVIDER_TURN` Go × N slot.
 *
 * §5.2 charges the slot on provider ACCEPTANCE, and only then. The
 * already-consumed guard is what makes the charge exactly-once: re-delivering
 * the same acceptance evidence returns a no-op instead of a second slot, so a
 * duplicated acceptance message cannot burn the budget twice (§5.3: "repeated
 * evidence for `COMPLETED` must be idempotent").
 */
export function chargeGoSlotOnAcceptance(args: {
  readonly budget: RecoveryBudget;
  readonly entry: RecoveryAttemptLedgerEntry;
  readonly acceptedTurnRef: string;
  readonly acceptanceProven: boolean;
  readonly now: number;
}): { readonly budget: RecoveryBudget; readonly entry: RecoveryAttemptLedgerEntry; readonly changed: boolean; readonly error?: string } {
  const { budget, entry } = args;
  if (entry.goSlot === undefined) {
    return { budget, entry, changed: false, error: "attempt has no Go × N slot to charge" };
  }
  if (budget.budgetId !== entry.budgetId) {
    return { budget, entry, changed: false, error: "budget/attempt mismatch" };
  }
  if (entry.goSlot.state === "CONSUMED") {
    return { budget, entry, changed: false };
  }
  if (!args.acceptanceProven) {
    // Not accepted → the estimated slot is released, not charged. The recovery
    // attempt itself stays consumed: the action was taken, it just did not land.
    return {
      budget: { ...budget, revision: budget.revision + 1 },
      entry: { ...entry, goSlot: { slotRef: entry.goSlot.slotRef, state: "ESTIMATED" } },
      changed: true,
      error: "acceptance not proven; Go × N slot not charged",
    };
  }
  return {
    budget: {
      ...budget,
      goSlots: { ...budget.goSlots, consumedSlots: budget.goSlots.consumedSlots + 1 },
      revision: budget.revision + 1,
    },
    entry: { ...entry, goSlot: { slotRef: entry.goSlot.slotRef, state: "CONSUMED", consumedTurnRef: args.acceptedTurnRef } },
    changed: true,
  };
}

// ---------------------------------------------------------------------------
// Reconcile-outcome adapter
// ---------------------------------------------------------------------------

/**
 * Map the durable ledger's reconcile verdict onto the gate's acceptance
 * vocabulary (§5.1).
 *
 * This is a naming adapter, NOT an authorization: producing an
 * `ALLOW`-shaped value here does not actuate anything, and this slice adds no
 * caller. It lives here so the one mapping that could quietly widen recovery —
 * reading `STILL_AMBIGUOUS` as "not accepted" — is written once, next to the
 * gate that forbids it.
 *
 * `PROVEN_ACCEPTED` additionally requires an authority verdict of `OK`: an
 * operation whose authority was superseded or absent is not acceptance evidence.
 */
export function recoveryEvidenceFromReconcileOutcome(outcome: SubmissionReconcileResult): {
  readonly turnAcceptance: "ACCEPTED" | "PROVEN_NOT_ACCEPTED" | "UNKNOWN";
  readonly basis: string;
} {
  if (outcome.outcome === "PROVEN_ACCEPTED") {
    if (outcome.authority !== "OK") {
      return { turnAcceptance: "UNKNOWN", basis: `PROVEN_ACCEPTED without OK authority (authority=${outcome.authority ?? "absent"})` };
    }
    return { turnAcceptance: "ACCEPTED", basis: "PROVEN_ACCEPTED" };
  }
  if (outcome.outcome === "PROVEN_NOT_ACCEPTED") {
    return { turnAcceptance: "PROVEN_NOT_ACCEPTED", basis: "PROVEN_NOT_ACCEPTED" };
  }
  // STILL_AMBIGUOUS ⇒ UNCERTAIN. §4.1: "UNCERTAIN 绝不能当作未接受".
  return { turnAcceptance: "UNKNOWN", basis: "STILL_AMBIGUOUS" };
}

/** Exposed for the binding-change / resume decision module. */
export type { ProviderBinding, RecoveryBudgetScope };

export { bindingChanged, carryAcrossBinding, remainingGoSlots, remainingRecoveryAttempts };
