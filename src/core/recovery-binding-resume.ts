/**
 * Binding-change, `RESUME_ELIGIBLE` and resume-authorization decisions (§6.2).
 *
 * The decisive statement this module enforces:
 *
 *   > Same-conversation recovery pauses a ContinuationRun; a Provider
 *   > Conversation rebase ends that Run. Remaining Go × N budget never crosses a
 *   > binding change as actuation authority.
 *
 *   > Context rebase is not authorized by ordinary Go × N authorization. It ends
 *   > the current Run, preserves the same Logical Thread, establishes a new
 *   > Provider Conversation through the Continuity workflow, and requires a new
 *   > continuation authorization after `RESUME_ELIGIBLE`.
 *
 * The distinction the second statement turns on — `RESUME_ELIGIBLE` is a
 * PRECONDITION for asking, never the permission itself — is made structural by
 * `resumeAuthorizationRequired`: satisfying every eligibility clause still
 * returns "a new continuation authorization is required". There is no `true`-ish
 * return value that a caller could mistake for a go-ahead.
 *
 * Like the gate module, this has no runtime authority and no caller in this
 * slice. The Run reducer (`continuation-run.ts`) is owned by another slice and
 * is deliberately not modified here; this module returns verdicts in that
 * reducer's own vocabulary (`ContinuationStopReason`, 'ENDED'/'FAILED_SAFE').
 */

import type { ContinuationStopReason } from "./continuation-run";
import {
  bindingChangeReasons,
  carryAcrossBinding,
  createRecoveryBudget,
  remainingGoSlots,
  remainingRecoveryAttempts,
  type ProviderBinding,
  type RecoveryBudget,
  type RecoveryBudgetScope,
} from "./recovery-evidence-types";

// ---------------------------------------------------------------------------
// 1. What ends a Run, and what merely pauses it
// ---------------------------------------------------------------------------

/**
 * `END` mirrors `ContinuationRunStatus`'s terminal members; `PAUSED` is the
 * same-conversation recovery state that §6.1 requires ("interrupted/uncertain
 * recovery puts the run in a candidate `PAUSED/RECOVERING`, not an ending"). The
 * current reducer's status union has no `PAUSED` member — that addition belongs
 * to the Run-reducer slice — so this module reports the intent and lets that
 * slice map it.
 */
export type RunDisposition = "PAUSED" | "END";

export interface BindingChangeDecision {
  readonly changed: boolean;
  readonly disposition: RunDisposition;
  /** Present when `disposition === "END"`; the reason vocabulary is the reducer's. */
  readonly endStatus?: "FAILED_SAFE";
  readonly stopReason?: ContinuationStopReason;
  /** Field-level audit trail. Never used for the decision itself. */
  readonly reasons: readonly string[];
}

const SAME_BINDING: BindingChangeDecision = { changed: false, disposition: "PAUSED", reasons: [] };

/**
 * A binding change ends the Run.
 *
 * A carrier change, an ordinary reload or a single interrupted generation never
 * reach this function's `changed` branch: carrier identity is not part of
 * `ProviderBinding`, and reload/interruption are not binding changes (§6.2).
 */
export function bindingChangeDecision(from: ProviderBinding, to: ProviderBinding): BindingChangeDecision {
  const reasons = bindingChangeReasons(from, to);
  if (reasons.length === 0) return SAME_BINDING;
  return {
    changed: true,
    disposition: "END",
    endStatus: "FAILED_SAFE",
    stopReason: "CONVERSATION_REBASE_REQUIRED",
    reasons,
  };
}

/**
 * §6.1: same-conversation recovery pauses the Run and forbids the next ordinary
 * `go` while paused. No binding change and no end.
 */
export function pauseForSameConversationRecovery(args: {
  readonly runId: string;
  readonly reason: "INTERRUPTED" | "UNCERTAIN";
  readonly binding: ProviderBinding;
  readonly evidenceRevision: number;
}): { readonly disposition: "PAUSED"; readonly runId: string; readonly allowsNextGo: false; readonly reason: string; readonly binding: ProviderBinding; readonly evidenceRevision: number } {
  return {
    disposition: "PAUSED",
    runId: args.runId,
    allowsNextGo: false,
    reason: args.reason,
    binding: args.binding,
    evidenceRevision: args.evidenceRevision,
  };
}

// ---------------------------------------------------------------------------
// 2. RESUME_ELIGIBLE
// ---------------------------------------------------------------------------

/**
 * The three inputs §6.2 names, each a required clause. All are required and all
 * must be present-and-true: a missing verification is "missing", not "passed"
 * ("resume verification not passed, or its result missing, must all be handled
 * as a stop boundary, never fail-open").
 *
 * `bootstrapFailedButBindingCommitted` records the CC §11 path this proposal
 * adopts as its criterion: the binding commit can succeed while `BOOTSTRAP`
 * fails, leaving C2 canonical-current and the checkpoint restored — and that is
 * exactly the case in which resuming without re-asking would silently skip
 * Goal/authorization.
 */
export interface ResumeEligibilityInput {
  /** Continuity `BOOTSTRAP` operation completed. */
  readonly bootstrapComplete: boolean;
  /** Hard resume verification passed. */
  readonly hardVerificationPassed: boolean;
  /** Soft verification produced no mismatch. */
  readonly softVerificationMismatch: boolean;
  /** Diagnostic only; cannot flip the verdict. */
  readonly bindingCommitted?: boolean;
  readonly bootstrapFailedButBindingCommitted?: boolean;
}

export interface ResumeEligibility {
  readonly eligible: boolean;
  readonly unsatisfied: readonly string[];
  /**
   * Always false when `eligible` is true, and always true when it is false.
   * `RESUME_ELIGIBLE` is a precondition for asking for authorization, never the
   * permission to resume — so this field can never express "may proceed".
   */
  readonly authorizesGo: false;
  readonly requiresNewContinuationAuthorization: true;
}

export function evaluateResumeEligible(input: ResumeEligibilityInput): ResumeEligibility {
  const unsatisfied: string[] = [];
  if (input.bootstrapComplete !== true) unsatisfied.push("BOOTSTRAP_NOT_COMPLETE");
  if (input.hardVerificationPassed !== true) unsatisfied.push("HARD_RESUME_VERIFICATION_NOT_PASSED");
  if (input.softVerificationMismatch !== false) unsatisfied.push("SOFT_VERIFICATION_MISMATCH_OR_MISSING");
  return {
    eligible: unsatisfied.length === 0,
    unsatisfied,
    authorizesGo: false,
    requiresNewContinuationAuthorization: true,
  };
}

/**
 * The stop boundary to use when `RESUME_ELIGIBLE` is false, or when resume
 * verification is missing — §6.2 requires both to be handled as stop boundaries
 * with the pause held, never fail-open.
 */
export function resumeEligibilityStopBoundary(eligibility: ResumeEligibility): {
  readonly disposition: "PAUSED";
  readonly stopBoundary: "RESUME_ELIGIBLE_FALSE";
  readonly unsatisfied: readonly string[];
  readonly authorizesGo: false;
} {
  return {
    disposition: "PAUSED",
    stopBoundary: "RESUME_ELIGIBLE_FALSE",
    unsatisfied: eligibility.unsatisfied,
    authorizesGo: false,
  };
}

// ---------------------------------------------------------------------------
// 3. Resume authorization: eligibility is necessary, not sufficient
// ---------------------------------------------------------------------------

export type ResumeAuthorizationDenial =
  | "RESUME_ELIGIBLE_FALSE"
  | "NO_NEW_CONTINUATION_AUTHORIZATION"
  | "AUTHORIZATION_NOT_ESTABLISHED_AFTER_PAUSE";

export interface ResumeAuthorizationDecision {
  readonly authorized: boolean;
  readonly denial?: ResumeAuthorizationDenial;
  readonly detail?: string;
}

/**
 * §6.2's "and requires a new continuation authorization after `RESUME_ELIGIBLE`",
 * made non-skippable.
 *
 * The first clause denies when eligibility is false — including when the
 * verification result is missing, since `evaluateResumeEligible` models a missing
 * clause as unsatisfied. The second and third deny when no authorization exists,
 * or when the only authorization on hand predates the pause: the old run's
 * authorization is spent, and re-presenting it is exactly the fail-open §6.2
 * names ("不得因'已恢复工作位'而跳过 Goal/授权询问").
 */
export function resumeAuthorizationRequired(args: {
  readonly eligibility: ResumeEligibility;
  /** The new continuation authorization's ref, if the Human/authority has issued one. */
  readonly newAuthorizationRef?: string;
  /** The pre-pause run's authorization, carried only so a re-presentation can be refused. */
  readonly priorAuthorizationRef?: string;
  /** Process time the new authorization was established, if any. */
  readonly newAuthorizationEstablishedAt?: number;
  /** Process time the run was paused. */
  readonly pausedAt?: number;
}): ResumeAuthorizationDecision {
  if (!args.eligibility.eligible) {
    return {
      authorized: false,
      denial: "RESUME_ELIGIBLE_FALSE",
      detail: `unsatisfied: ${args.eligibility.unsatisfied.join(", ") || "RESUME_ELIGIBLE not established"}`,
    };
  }
  const issued = args.newAuthorizationRef;
  if (issued === undefined || issued.trim() === "") {
    return {
      authorized: false,
      denial: "NO_NEW_CONTINUATION_AUTHORIZATION",
      detail: "RESUME_ELIGIBLE is a precondition for asking, not the permission to resume",
    };
  }
  if (args.priorAuthorizationRef !== undefined && issued === args.priorAuthorizationRef) {
    return {
      authorized: false,
      denial: "AUTHORIZATION_NOT_ESTABLISHED_AFTER_PAUSE",
      detail: "the pre-pause authorization cannot be reused across a binding change",
    };
  }
  if (args.pausedAt !== undefined && (args.newAuthorizationEstablishedAt === undefined || args.newAuthorizationEstablishedAt <= args.pausedAt)) {
    return {
      authorized: false,
      denial: "AUTHORIZATION_NOT_ESTABLISHED_AFTER_PAUSE",
      detail: "the presented authorization was not established after the pause",
    };
  }
  return { authorized: true };
}

// ---------------------------------------------------------------------------
// 4. Budget at the binding boundary
// ---------------------------------------------------------------------------

export interface ResumeBudgetDecision {
  readonly disposition: RunDisposition;
  /** The fresh budget for the new Provider Conversation. Always empty. */
  readonly budget?: RecoveryBudget;
  /** The old round's remainder, reported for the audit record only. */
  readonly priorRemainder?: {
    readonly remainingAttempts: number;
    readonly remainingGoSlots: number;
  };
  readonly carried: false;
  readonly reason: string;
}

/**
 * A new Provider Conversation starts with its OWN budget.
 *
 * The old round's remainder is reported so an audit can state what was left
 * behind, and is never transferred: `carried` is `false` on every branch, and the
 * fresh budget is always `consumedAttempts: 0` / `consumedSlots: 0`. §6.2 is
 * explicit that the old Run's remaining Go budget "does not become the new
 * conversation's actuation authority".
 */
export function budgetForResumedConversation(args: {
  readonly budget: RecoveryBudget;
  readonly from: ProviderBinding;
  readonly to: ProviderBinding;
  readonly newScope: RecoveryBudgetScope;
  readonly newBudgetId: string;
  /** Defaults to the old round's `maxAttempts`; the Authority §10-3 has not yet fixed one. */
  readonly maxAttempts?: number;
}): ResumeBudgetDecision {
  const decision = bindingChangeDecision(args.from, args.to);
  const priorRemainder = {
    remainingAttempts: remainingRecoveryAttempts(args.budget),
    remainingGoSlots: remainingGoSlots(args.budget),
  };
  if (!decision.changed) {
    return {
      disposition: "PAUSED",
      priorRemainder,
      carried: false,
      reason: "no binding change; same-conversation recovery keeps the existing budget",
    };
  }
  if (carryAcrossBinding({ budget: args.budget, from: args.from, to: args.to }) as boolean) {
    // Unreachable by construction — `carryAcrossBinding` is total and returns
    // false. Written out so that relaxing it is a visible, reviewable edit.
    return { disposition: "END", priorRemainder, carried: false, reason: "carryAcrossBinding returned true; invariant violated" };
  }
  return {
    disposition: "END",
    budget: createRecoveryBudget({
      budgetId: args.newBudgetId,
      scope: args.newScope,
      maxAttempts: args.maxAttempts ?? args.budget.maxAttempts,
      goSlots: { maxSlots: args.budget.goSlots.maxSlots },
    }),
    priorRemainder,
    carried: false,
    reason: "binding changed; the new Provider Conversation gets a fresh budget and requires a new continuation authorization",
  };
}
