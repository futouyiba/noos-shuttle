/**
 * The Run's intervention rule, with the queued-Human-input exception applied
 * (issue #63 delta 3).
 *
 * A Run treats every user turn it did not author as Human intervention, and the
 * remaining budget never resumes. A queued message *is* authored by Shuttle —
 * but the proof arrives late: the carrier reconciles over a probe cycle and the
 * background folds after that, while the Run's watcher ticks faster than either.
 * So the expectation has to exist *before* the turn does, which is what
 * reserving an operation for a Run epoch means.
 *
 * Two failure modes live in this composition, and they pull in opposite
 * directions:
 *
 *  - lose the expectation and a message the Human queued reads as one they typed
 *    mid-Run, cancelling the Run the feature exists to keep alive;
 *  - keep an expectation that nothing can satisfy and a later genuine Human
 *    message hides underneath it, weakening the intervention rule this design
 *    promised not to touch.
 *
 * The rule below is the narrow line between them. It only ever *raises* the
 * expectation, it tolerates at most one unproven turn at a time, and when that
 * turn's attribution is genuinely unknown it neither cancels the Run nor lets
 * it advance.
 */
import type { OutboxRunExpectation } from "./outbox-queue";

export type RunInterventionVerdict =
  /** Nothing to answer for. */
  | "NONE"
  /** A user turn this Run neither authored nor expected. The Run ends. */
  | "HUMAN_INTERVENTION"
  /**
   * The change is above expectation, but an unresolved queued reservation could
   * account for it. Attribution is unknown: hold — do not cancel the Run and do
   * not let it advance (provider recovery owns the reservation, #54/#57 Q3).
   */
  | "AMBIGUOUS_HOLD";

export interface RunInterventionInput {
  /**
   * The Run's own expectation, including its pre-dispatch bump for the governed
   * round it is currently waiting on. `-1` means "not yet baselined".
   */
  governedExpectedUserCount: number;
  observedUserCount: number;
  /** Present only when this Run epoch has queued turns to answer for. */
  outbox?: OutboxRunExpectation;
}

export interface RunInterventionDecision {
  /** The count to carry forward as the Run's expectation. */
  expectedUserCount: number;
  verdict: RunInterventionVerdict;
}

export function decideRunIntervention(input: RunInterventionInput): RunInterventionDecision {
  const expectedUserCount = input.outbox === undefined
    ? input.governedExpectedUserCount
    : Math.max(input.governedExpectedUserCount, input.outbox.expectedUserMessageCount);
  if (input.observedUserCount <= expectedUserCount) return { expectedUserCount, verdict: "NONE" };
  // Above the expectation. If an unresolved queued reservation could account for
  // the extra turn, this is ambiguity rather than attribution.
  if (input.outbox?.ambiguous === true) return { expectedUserCount, verdict: "AMBIGUOUS_HOLD" };
  return { expectedUserCount, verdict: "HUMAN_INTERVENTION" };
}
