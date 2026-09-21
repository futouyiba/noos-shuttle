/**
 * Offline Recovery Evidence / RecoveryBudget data model for the ChatGPT Provider
 * Recovery ("Go × N") semantics. Pure types and pure constructors only: no
 * runtime authority, no actuation, no wiring into the wake/watcher paths.
 *
 * Authority: `docs/deliberation-harness/chatgpt-provider-recovery-go-n-proposal-v0.md`
 * at the exact revision accepted by the Issue #54 design disposition
 * (`e4a7a816dbf25b987b9a25b21243ce827956e0e4`), plus that disposition's three
 * decisive statements. Where this module could be read as weakening one of
 * them, the readable text in the module that enforces it is authoritative.
 */

// ---------------------------------------------------------------------------
// 1. Action taxonomy (§4.1, §5.1, §8)
// ---------------------------------------------------------------------------

/**
 * OBSERVATION_ONLY_ACTIONS never actuate the provider conversation: they wait,
 * re-observe and reconcile. Proposal §4.1 makes them "the only automatic path
 * out of `UNKNOWN/UNCERTAIN`", bounded by time/observation count, charged no Go
 * slot and no recovery attempt. `RECONCILE` is included deliberately — it is the
 * read that produces acceptance evidence, not an action taken on that evidence.
 */
export const OBSERVATION_ONLY_ACTIONS = ["WAIT", "REOBSERVE", "RECONCILE"] as const;

/**
 * RECOVERY_ACTIONS are the actions that may touch the provider conversation.
 * Each one owns an independent, action-specific evidence gate (§4.1, §5.1):
 * a passing gate for one of them never authorizes another.
 *
 * The three provider-facing recovery operations are deliberately distinct
 * operations, not one "retry" (§5):
 *  - `REFRESH` recovers observation capability only; it does not imply resend.
 *  - `PROVIDER_NATIVE_RETRY` regenerates provider work for an already-accepted
 *    user turn; it creates no user turn and consumes no Go slot.
 *  - `SHUTTLE_RETRY` re-attempts the ORIGINAL user submission, and is reachable
 *    only after the original operation is `PROVEN_NOT_ACCEPTED`.
 *  - `CONTINUE_PROVIDER_TURN` sends a new user turn, so provider acceptance
 *    consumes one Go × N slot in addition to one recovery attempt.
 */
export const RECOVERY_ACTIONS = [
  "REFRESH",
  "PROVIDER_NATIVE_RETRY",
  "SHUTTLE_RETRY",
  "CONTINUE_PROVIDER_TURN",
] as const;

/**
 * `CONTEXT_REBASE` is modelled but is NOT in `RECOVERY_ACTIONS`: §6.2 and §8.2
 * place it outside the recoverable set entirely. It is kept in the taxonomy so
 * the gate can deny it by name with a reason rather than by omission — a
 * rebase request must never fall through to "unrecognized action".
 */
export const OUT_OF_SCOPE_ACTIONS = ["CONTEXT_REBASE"] as const;

export type ObservationOnlyAction = (typeof OBSERVATION_ONLY_ACTIONS)[number];
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];
export type OutOfScopeAction = (typeof OUT_OF_SCOPE_ACTIONS)[number];
export type RecoveryActionId = ObservationOnlyAction | RecoveryAction | OutOfScopeAction;

/** Named so callers and tests can request the rebase refusal without retyping the literal. */
export const CONTEXT_REBASE_ACTION: OutOfScopeAction = "CONTEXT_REBASE";

/** One recovery attempt ≡ one recovery action that actuates; drives the RecoveryBudget counter (§5.2). */
export function isRecoveryAction(action: RecoveryActionId): action is RecoveryAction {
  return (RECOVERY_ACTIONS as readonly string[]).includes(action);
}

/**
 * True for the actions that create a new user turn. Only these are additionally
 * subject to the remaining Go × N budget (§5.2, §5.3).
 */
export function consumesGoSlotOnAcceptance(action: RecoveryActionId): boolean {
  return action === "CONTINUE_PROVIDER_TURN";
}

// ---------------------------------------------------------------------------
// 2. Binding identity (§6.2)
// ---------------------------------------------------------------------------

/**
 * The three fields that make up a *binding*. `carrierRef` is intentionally
 * absent: a Browser Carrier identity change is explicitly not a binding change
 * (proposal §4.1, §6.2), and a predicate over this type therefore cannot see it.
 * `logicalThreadId` is likewise absent — a binding change preserves the Logical
 * Thread.
 */
export interface ProviderBinding {
  readonly providerConversationRef: string;
  readonly bindingGeneration: number;
  readonly headFingerprint: string;
}

// ---------------------------------------------------------------------------
// 3. Evidence model (§4, §9.1)
// ---------------------------------------------------------------------------

/**
 * What the ledger can say about the ORIGINAL user turn's acceptance.
 *
 * `UNKNOWN` is a first-class value and not a synonym for "not accepted": the
 * decisive statement forbids reading the absence of acceptance evidence as
 * permission. §4.1 in particular requires `UNCERTAIN` never to be treated as
 * unaccepted, which is why the reconcile adapter maps `STILL_AMBIGUOUS` here.
 */
export type TurnAcceptance =
  | "ACCEPTED"
  | "PROVEN_NOT_ACCEPTED"
  | "UNKNOWN";

/**
 * Whether the assistant generation for an accepted turn is determinately over
 * vs. possibly still running. Collapsing these is the failure mode §4.1 guards
 * against, so the type keeps a distinct `UNKNOWN`.
 */
export type AssistantGenerationStatus =
  | "DEFINITELY_INTERRUPTED"
  | "STILL_GENERATING"
  | "COMPLETED"
  | "UNKNOWN";

/**
 * A typed, fail-closed answer to one gate question.
 *
 * `UNKNOWN` exists as its own variant rather than as a missing key: reading an
 * absent field as a pass is exactly the fail-open the evidence gate forbids.
 * Every consumer compares against `"YES"`, so every other value denies.
 */
export type EvidenceVerdict<T extends string> =
  | { readonly status: "YES"; readonly basis: T }
  | { readonly status: "UNKNOWN" }
  | { readonly status: "NO"; readonly basis: T };

/** Provider/version-specific Retry semantics are unverified for generic ChatGPT (§2, §8.2): always `UNKNOWN` until REAL_DOGFOOD evidence exists. */
export type ProviderRetrySemanticsStatus = "VERIFIED" | "UNKNOWN";

/** Slice 2 (§9.1) will replace this with a classified error surface; §2 requires unknown classification to stay fail-closed. */
export type ProviderErrorKind =
  | "CONTEXT_LIMIT"
  | "TRANSPORT"
  | "RATE_LIMIT"
  | "POLICY_OR_AUTH"
  | "GENERATION_INTERRUPTION"
  | "UNCLASSIFIED";

export interface ProviderRetrySemantics {
  readonly status: ProviderRetrySemanticsStatus;
  /**
   * The turn the Retry targets, and whether the verified semantics regenerate
   * existing provider work or resubmit the user turn. §4.1 requires both to be
   * pinned before a Retry can be automated; an unpinned target is `UNKNOWN`.
   */
  readonly targetTurnRef?: string;
  readonly effect?: "REGENERATE_EXISTING_TURN" | "RESUBMIT_USER_TURN";
  /** §4.1 requires the semantics to state whether tools/external effects are re-run. */
  readonly toolEffects?: "NONE" | "RERUNS_TOOLS";
  /** Which adapter/provider/version the semantics were verified against. */
  readonly providerVersionRef?: string;
}

export interface HumanStateSafety {
  /** A composer draft the refresh must not destroy (§4.1). */
  readonly draftPresent?: boolean;
  readonly draftPreservedByAction?: boolean;
  /** Attachments or other ephemeral Human state the action must not lose. */
  readonly ephemeralHumanStatePresent?: boolean;
  readonly ephemeralHumanStatePreservedByAction?: boolean;
}

export interface ProviderErrorEvidence {
  readonly kind: ProviderErrorKind;
  readonly providerVersionRef?: string;
}

/**
 * Candidate material the caller supplies. Everything is optional on purpose:
 * an absent field is `UNKNOWN`, and §4's rule is that `UNKNOWN` is never
 * permission. The gate is the only place that decides sufficiency.
 *
 * Which binding the evidence was read against is NOT here — that belongs to the
 * claim (`RecoveryGateInput.observedBinding`), because it describes where the
 * reader looked rather than what they saw, and the gate must check it against
 * the binding it is authorizing for.
 */
export interface RecoveryEvidence {
  readonly turnAcceptance?: TurnAcceptance;
  /** §4.2: an accepted turn's assistant side may interrupt; Shuttle must never resend it. */
  readonly assistantGeneration?: AssistantGenerationStatus;
  /**
   * §4.2 / §4.1 / §8.2: unresolved tool or external side effects fail both the
   * continue gate and the provider-native Retry gate closed. Only an explicit
   * `false` passes — an unread question denies exactly like an outstanding side
   * effect, because "nobody checked" and "there are none" must never collapse
   * into the same value when the consequence of being wrong is a duplicate
   * external effect.
   */
  readonly sideEffectsOutstanding?: boolean;

  // §6.1's Stop latch and Human intervention are deliberately NOT modelled here.
  // They are run-side state rather than evidence, and the gate reads them from
  // `RecoveryLoopContext` (see `recovery-evidence-gate.ts`); defining them a
  // second time on this type would be a silent second truth that no code reads,
  // inviting a caller to set a latch in the one place that has no effect.

  // -- REFRESH evidence --
  /** Same Provider Conversation + binding generation, no execution-owning ambiguity (§4.1). */
  readonly sameProviderConversation?: boolean;
  readonly executionOwnershipUnambiguous?: boolean;
  /** The action is safe against draft/attachment/ephemeral Human state (§4.1, §10-2). */
  readonly refreshSafe?: boolean;
  readonly humanStateSafety?: HumanStateSafety;

  // -- provider-native Retry evidence --
  readonly providerRetrySemantics?: ProviderRetrySemantics;

  // -- Shuttle retry evidence --
  /** The logical operation identity the original dispatch and every retry attempt share (§5.1). */
  readonly logicalOperationId?: string;
  /** A new dispatch attempt/fence is required for every retry; reusing one is not a new attempt (§5.1). */
  readonly dispatchAttemptRef?: string;
  readonly priorAttemptRefs?: readonly string[];

  // -- CONTINUE_PROVIDER_TURN evidence --
  /** The logical operation id backing the acceptance claim; must be the run's own continuation history (§4.1). */
  readonly acceptedOperationId?: string;
  readonly acceptedOperationKind?: string;
  readonly acceptedTurnRef?: string;
  readonly assistantPartialOutputObserved?: boolean;
  /** §10-1 / §2: context-limit and unclassified surfaces are not `CONTINUE_PROVIDER_TURN` evidence. */
  readonly providerError?: ProviderErrorEvidence;
}

// ---------------------------------------------------------------------------
// 4. RecoveryBudget (§5.2)
// ---------------------------------------------------------------------------

/**
 * Identifies the one interrupted Go × N round a budget bounds. A budget is
 * scoped to (thread, conversation, binding generation, interrupted round), so
 * it cannot silently outlive the binding it was granted under.
 */
export interface RecoveryBudgetScope {
  readonly logicalThreadId: string;
  readonly providerConversationRef: string;
  readonly bindingGeneration: number;
  readonly interruptedRoundRef: string;
}

/**
 * Recovery budget bounds recovery attempts for one interrupted Go × N round.
 *
 * `goSlots` mirrors the remaining Go × N allowance for the same scope. It is
 * duplicated here rather than read from `ContinuationRun` so that the invariant
 * "remaining Go × N budget never crosses a binding change as actuation
 * authority" stays decidable from this object alone (`carryAcrossBinding`)
 * without this module depending on the Run reducer.
 */
export interface RecoveryBudget {
  readonly budgetId: string;
  readonly scope: RecoveryBudgetScope;
  readonly maxAttempts: number;
  readonly consumedAttempts: number;
  readonly goSlots: {
    readonly maxSlots: number;
    readonly consumedSlots: number;
  };
  /** Monotonic, so an attempt claim can be attributed and made idempotent. */
  readonly revision: number;
}

/**
 * How one executed recovery action charges the budget.
 *
 * A `CONTINUE_PROVIDER_TURN` allowance carries a `goSlot`, but it starts
 * `ESTIMATED`: the Go × N slot is charged only on provider acceptance (§5.2), so
 * an act that never reached the provider does not silently burn a slot.
 */
export interface RecoveryAttemptLedgerEntry {
  readonly attemptId: string;
  readonly budgetId: string;
  readonly action: RecoveryAction;
  readonly operationId: string;
  readonly revision: number;
  readonly requestedAt: number;
  readonly consideredEvidence: ProviderBinding;
  readonly goSlot?: {
    readonly slotRef: string;
    readonly state: "ESTIMATED" | "CONSUMED";
    readonly consumedTurnRef?: string;
  };
}

export const RECOVERY_ALLOWANCE_SCOPE = "RECOVERY_SCOPE_MISMATCH";
export const RECOVERY_ALLOWANCE_ACTION = "ACTION_NOT_A_RECOVERY_ACTION";

export type RecoveryAllowance =
  | { readonly ok: false; readonly error: typeof RECOVERY_ALLOWANCE_SCOPE; readonly allowed: false }
  | { readonly ok: false; readonly error: typeof RECOVERY_ALLOWANCE_ACTION; readonly allowed: false }
  | {
      readonly ok: true;
      readonly allowed: true;
      readonly ledgerEntryId: string;
      readonly budget: RecoveryBudget;
      readonly scope: RecoveryBudgetScope;
    };

// ---------------------------------------------------------------------------
// 5. Budget / scope helpers
// ---------------------------------------------------------------------------

export interface CreateRecoveryBudgetInput {
  readonly budgetId: string;
  readonly scope: RecoveryBudgetScope;
  readonly maxAttempts: number;
  /** A fresh budget always starts with nothing consumed, so `consumedSlots` is not an input. */
  readonly goSlots: { readonly maxSlots: number };
}

export function createRecoveryBudget(input: CreateRecoveryBudgetInput): RecoveryBudget {
  return {
    budgetId: input.budgetId,
    scope: input.scope,
    maxAttempts: input.maxAttempts,
    consumedAttempts: 0,
    goSlots: { maxSlots: input.goSlots.maxSlots, consumedSlots: 0 },
    revision: 0,
  };
}

export function budgetScopeMatches(a: RecoveryBudgetScope, b: RecoveryBudgetScope): boolean {
  return (
    a.logicalThreadId === b.logicalThreadId &&
    a.providerConversationRef === b.providerConversationRef &&
    a.bindingGeneration === b.bindingGeneration &&
    a.interruptedRoundRef === b.interruptedRoundRef
  );
}

/** Attempts left, or `0` once exhausted. Exhaustion is a stop boundary: `HUMAN_REQUIRED` (§5.2). */
export function remainingRecoveryAttempts(budget: RecoveryBudget): number {
  return Math.max(0, budget.maxAttempts - budget.consumedAttempts);
}

export function remainingGoSlots(budget: RecoveryBudget): number {
  return Math.max(0, budget.goSlots.maxSlots - budget.goSlots.consumedSlots);
}

export function recoveryBudgetExhausted(budget: RecoveryBudget): boolean {
  return remainingRecoveryAttempts(budget) <= 0;
}

/**
 * THE BINDING-CHANGE INVARIANT, as a decidable function.
 *
 * "Remaining Go × N budget never crosses a binding change as actuation
 * authority" (§5.3, §6). This is total: there is no parameter — no provenance, no
 * authority flag, no Human gesture — under which the answer is `true`. A new
 * Provider Conversation gets its budget only through the Continuity workflow
 * after `RESUME_ELIGIBLE`, never by carrying the previous round's remainder.
 */
export function carryAcrossBinding(_args: {
  readonly budget: RecoveryBudget;
  readonly from: ProviderBinding;
  readonly to: ProviderBinding;
}): false {
  return false;
}

/**
 * True when two bindings differ in any binding-identity field. A carrier change
 * alone cannot make this true, because carrier identity is not part of
 * `ProviderBinding` (§4.1: "ordinary carrier identity change is not a rebase
 * sufficient condition").
 */
export function bindingChanged(from: ProviderBinding, to: ProviderBinding): boolean {
  return (
    from.providerConversationRef !== to.providerConversationRef ||
    from.bindingGeneration !== to.bindingGeneration ||
    from.headFingerprint !== to.headFingerprint
  );
}

/** Which binding-identity field(s) moved; for the audit record, never for the decision. */
export function bindingChangeReasons(from: ProviderBinding, to: ProviderBinding): string[] {
  const reasons: string[] = [];
  if (from.providerConversationRef !== to.providerConversationRef) reasons.push("providerConversationRef");
  if (from.bindingGeneration !== to.bindingGeneration) reasons.push("bindingGeneration");
  if (from.headFingerprint !== to.headFingerprint) reasons.push("headFingerprint");
  return reasons;
}

// ---------------------------------------------------------------------------
// 6. Gate decision vocabulary
// ---------------------------------------------------------------------------

/**
 * One reason code per check the gate performs. Denials are attributed to the
 * specific unsatisfied check so a reviewer can read a denial without replaying
 * the evidence.
 */
export type RecoveryGateDenyReason =
  // binding / run-level
  | "BINDING_CHANGED"
  | "HUMAN_INTERVENTION"
  | "STOP_LATCHED"
  | "ACTION_NOT_RECOVERABLE"
  | "REBASE_NOT_AUTHORIZED_BY_GO_N"
  // evidence sufficiency (the `UNKNOWN` denials from §4)
  | "ACCEPTANCE_UNKNOWN"
  | "ACCEPTANCE_NOT_PROVEN"
  | "ASSISTANT_GENERATION_UNKNOWN"
  | "ASSISTANT_GENERATION_STILL_RUNNING"
  | "SIDE_EFFECTS_UNRESOLVED"
  | "SAME_CONVERSATION_UNPROVEN"
  | "EXECUTION_OWNERSHIP_AMBIGUOUS"
  | "REFRESH_SAFETY_UNPROVEN"
  | "REFRESH_UNSAFE_FOR_HUMAN_STATE"
  | "PROVIDER_RETRY_SEMANTICS_UNPROVEN"
  | "PROVIDER_RETRY_TARGET_UNPROVEN"
  | "ACCEPTED_TURN_MUST_NOT_BE_SHUTTLE_RETRIED"
  | "CONTINUATION_OPERATION_UNPROVEN"
  | "CONTINUATION_PARTIAL_OUTPUT_UNPROVEN"
  | "CONTINUATION_NOT_THE_RECOVERY_ACTION"
  | "CONTINUATION_SLOT_BUDGET_EXHAUSTED"
  // budget
  | "RECOVERY_BUDGET_EXHAUSTED";

export interface RecoveryGateDeny {
  readonly verdict: "DENY";
  /** Ordered: the first check that failed. Deterministic, so tests and audits agree. */
  readonly reason: RecoveryGateDenyReason;
  readonly detail?: string;
}

export interface RecoveryGateAllow {
  readonly verdict: "ALLOW";
  /**
   * The recovery action authorized, or `undefined` for a non-actuating allow.
   * `WAIT`/`REOBSERVE`/`RECONCILE` are allowed without authorizing anything: §4.1
   * charges them no recovery attempt and no Go slot, and no attempt happened, so
   * there is nothing to record in the ledger.
   */
  readonly action?: RecoveryAction;
  /** Bookkeeping advanced by the allowance; unchanged from the input for a non-actuating allow. */
  readonly allowance: RecoveryBudget;
  /** Present iff `action` is a recovery action. */
  readonly ledgerEntryId?: string;
  readonly ledgerEntry?: RecoveryAttemptLedgerEntry;
}

export type RecoveryGateDecision = RecoveryGateDeny | RecoveryGateAllow;

/** Verdict of `evaluateRecoveryGate`; a denial returns the input budget unchanged. */
export interface RecoveryGateEvaluation {
  readonly decision: RecoveryGateDecision;
  readonly budget: RecoveryBudget;
}
