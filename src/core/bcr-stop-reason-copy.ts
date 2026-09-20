/**
 * Bounded Continuation Run stop-reason copy.
 *
 * The panel reports why a run ended as `<Reason>: <stopReason>`. The evaluator
 * used to fold every blocking term it could not name into `WAIT_HUMAN`, so a
 * model that merely reported MEDIUM confidence, a model that declined to judge,
 * and a round with no readable assistant text all read to the Human as "the
 * model wants a Human". The reasons are now split per actual cause; this module
 * keeps the mapping from each reason to the sentence shown for it.
 *
 * Copy selection only. It reads nothing, actuates nothing, and never changes
 * which reason a run stopped with — only what the Human is told about a stop
 * the runtime already committed.
 */

import type { ShuttleCopy } from "../shared/i18n";
import type { ContinuationStopReason } from "./continuation-run";

/** Copy keys this map may use — the plain-string entries, since some copy values are formatters. */
type StopReasonCopyKey = { [K in keyof ShuttleCopy]: ShuttleCopy[K] extends string ? K : never }[keyof ShuttleCopy];

/**
 * Which sentence describes each stop reason. Typed as a `Record` over the union
 * rather than a switch so a new `ContinuationStopReason` cannot reach the Human
 * as a bare enum: the build fails until it has copy.
 */
const STOP_REASON_COPY_KEYS: Record<ContinuationStopReason, StopReasonCopyKey> = {
  BUDGET_EXHAUSTED: "bcrStopReasonBudgetExhausted",
  WAIT_HUMAN: "bcrStopReasonWaitHuman",
  WAIT_REVIEW: "bcrStopReasonWaitReview",
  WAIT_EVIDENCE: "bcrStopReasonWaitEvidence",
  WAIT_EXTERNAL: "bcrStopReasonWaitExternal",
  GOAL_SATISFIED: "bcrStopReasonGoalSatisfied",
  OPTIONAL_SCOPE_EXTENSION: "bcrStopReasonOptionalScopeExtension",
  SCOPE_DRIFT: "bcrStopReasonScopeDrift",
  STALLED: "bcrStopReasonStalled",
  ASSESSMENT_UNCERTAIN: "bcrStopReasonAssessmentUncertain",
  CONFIDENCE_BELOW_HIGH: "bcrStopReasonConfidenceBelowHigh",
  FOCUS_NOT_ADVANCING: "bcrStopReasonFocusNotAdvancing",
  EXCERPT_UNAVAILABLE: "bcrStopReasonExcerptUnavailable",
  USER_CANCELLED: "bcrStopReasonUserCancelled",
  USER_INTERVENTION: "bcrStopReasonUserIntervention",
  AUTHORITY_CHANGED: "bcrStopReasonAuthorityChanged",
  CONVERSATION_REBASE_REQUIRED: "bcrStopReasonConversationRebaseRequired",
  SUBMISSION_UNCERTAIN: "bcrStopReasonSubmissionUncertain",
  CARRIER_FAILURE: "bcrStopReasonCarrierFailure",
  EVALUATOR_UNAVAILABLE: "bcrStopReasonEvaluatorUnavailable"
};

/** Every reason this build knows, for callers that need the list at runtime. */
export const CONTINUATION_STOP_REASONS = Object.keys(STOP_REASON_COPY_KEYS) as readonly ContinuationStopReason[];

/**
 * The sentence for a stop reason. A reason this build does not know — a store
 * written by another version — reads as itself rather than as a guess about
 * what it meant.
 */
export function bcrStopReasonLabel(reason: string, copy: ShuttleCopy): string {
  return Object.prototype.hasOwnProperty.call(STOP_REASON_COPY_KEYS, reason)
    ? copy[STOP_REASON_COPY_KEYS[reason as ContinuationStopReason]]
    : reason;
}
