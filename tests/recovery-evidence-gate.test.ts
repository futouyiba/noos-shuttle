import { describe, expect, it } from "vitest";
import {
  chargeGoSlotOnAcceptance,
  evaluateRecoveryGate,
  recoveryEvidenceFromReconcileOutcome,
  type RecoveryGateInput,
  type RecoveryLoopContext,
} from "../src/core/recovery-evidence-gate";
import {
  CONTEXT_REBASE_ACTION,
  createRecoveryBudget,
  type ProviderBinding,
  type RecoveryAction,
  type RecoveryActionId,
  type RecoveryAttemptLedgerEntry,
  type RecoveryBudget,
  type RecoveryBudgetScope,
  type RecoveryEvidence,
  type RecoveryGateDenyReason,
} from "../src/core/recovery-evidence-types";

function binding(overrides: Partial<ProviderBinding> = {}): ProviderBinding {
  return { providerConversationRef: "conv-1", bindingGeneration: 1, headFingerprint: "head-a", ...overrides };
}

function scope(overrides: Partial<RecoveryBudgetScope> = {}): RecoveryBudgetScope {
  return {
    logicalThreadId: "thread-1",
    providerConversationRef: "conv-1",
    bindingGeneration: 1,
    interruptedRoundRef: "round-1",
    ...overrides,
  };
}

function budget(overrides: Partial<RecoveryBudget> = {}): RecoveryBudget {
  return { ...createRecoveryBudget({ budgetId: "bud-1", scope: scope(), maxAttempts: 3, goSlots: { maxSlots: 2 } }), ...overrides };
}

function loopContext(overrides: Partial<RecoveryLoopContext> = {}): RecoveryLoopContext {
  return { binding: binding(), evidenceRevision: 7, ...overrides };
}

function gate(
  action: RecoveryActionId,
  evidence: RecoveryEvidence = {},
  context: RecoveryLoopContext = loopContext(),
  budgetOverride?: RecoveryBudget,
  observedBinding?: ProviderBinding,
) {
  const input: RecoveryGateInput = {
    action,
    binding: context.binding,
    observedBinding: observedBinding ?? context.binding,
    evidence,
    context,
    budget: budgetOverride ?? budget(),
    operationId: "op-1",
    now: 1_000,
  };
  return evaluateRecoveryGate(input);
}

function expectDeny(decision: ReturnType<typeof gate>["decision"], reason: RecoveryGateDenyReason) {
  expect(decision.verdict).toBe("DENY");
  if (decision.verdict !== "DENY") throw new Error("unreachable");
  expect(decision.reason).toBe(reason);
}

/**
 * Narrow an ALLOW to its recovery-attempt record, asserting the invariant that
 * an allowance for an actuating action always carries exactly one.
 */
function attemptOf(result: ReturnType<typeof gate>): RecoveryAttemptLedgerEntry {
  expect(result.decision.verdict).toBe("ALLOW");
  const decision = result.decision;
  if (decision.verdict !== "ALLOW" || decision.ledgerEntry === undefined) {
    throw new Error("expected an acting allowance with a ledger entry");
  }
  return decision.ledgerEntry;
}

/** Evidence that satisfies every REFRESH check. */
const REFRESH_OK: RecoveryEvidence = {
  sameProviderConversation: true,
  executionOwnershipUnambiguous: true,
  refreshSafe: true,
  humanStateSafety: { draftPresent: false, ephemeralHumanStatePresent: false },
};

/** Evidence that satisfies every SHUTTLE_RETRY check. */
const SHUTTLE_RETRY_OK: RecoveryEvidence = {
  turnAcceptance: "PROVEN_NOT_ACCEPTED",
  logicalOperationId: "op-original",
  dispatchAttemptRef: "attempt-2",
  priorAttemptRefs: ["attempt-1"],
};

/** Evidence that satisfies the acceptance half of CONTINUE_PROVIDER_TURN. */
const CONTINUE_ACCEPTED_OK: RecoveryEvidence = {
  turnAcceptance: "ACCEPTED",
  acceptedOperationId: "op-accepted",
  acceptedOperationKind: "GO",
  acceptedTurnRef: "turn-9",
  assistantPartialOutputObserved: true,
  assistantGeneration: "DEFINITELY_INTERRUPTED",
  sideEffectsOutstanding: false,
  sameProviderConversation: true,
};

/** Evidence that satisfies every PROVIDER_NATIVE_RETRY check. */
const NATIVE_RETRY_OK: RecoveryEvidence = {
  turnAcceptance: "ACCEPTED",
  assistantGeneration: "DEFINITELY_INTERRUPTED",
  sideEffectsOutstanding: false,
  providerRetrySemantics: {
    status: "VERIFIED",
    targetTurnRef: "turn-9",
    effect: "REGENERATE_EXISTING_TURN",
    toolEffects: "NONE",
    providerVersionRef: "chatgpt@fixture-0",
  },
};

describe("fail-closed property: absent evidence never reads as a pass", () => {
  // The decisive statement: "Unknown is not permission to recover by side
  // effect." These cases pass NO evidence at all and must all deny.
  it("denies every recovery action when handed no evidence", () => {
    const expected: Record<RecoveryAction, RecoveryGateDenyReason> = {
      REFRESH: "SAME_CONVERSATION_UNPROVEN",
      PROVIDER_NATIVE_RETRY: "PROVIDER_RETRY_SEMANTICS_UNPROVEN",
      SHUTTLE_RETRY: "ACCEPTANCE_UNKNOWN",
      CONTINUE_PROVIDER_TURN: "ACCEPTANCE_NOT_PROVEN",
    };
    for (const action of Object.keys(expected) as RecoveryAction[]) {
      expectDeny(gate(action).decision, expected[action]);
    }
  });

  it("denies even when the only thing wrong is one unread field", () => {
    const { refreshSafe: _dropped, ...withoutRefreshSafe } = REFRESH_OK;
    expectDeny(gate("REFRESH", withoutRefreshSafe).decision, "REFRESH_SAFETY_UNPROVEN");
    expectDeny(gate("REFRESH", { ...withoutRefreshSafe, refreshSafe: undefined }).decision, "REFRESH_SAFETY_UNPROVEN");
  });

  it("denies refresh when the execution-ownership read is missing", () => {
    const { executionOwnershipUnambiguous: _dropped, ...rest } = REFRESH_OK;
    expectDeny(gate("REFRESH", rest).decision, "EXECUTION_OWNERSHIP_AMBIGUOUS");
  });
});

/**
 * The counterexamples that falsified "there is no code path in which a missing
 * field reads as a pass". Each one drops a single field from an otherwise
 * fully-satisfying evidence set, so the denial cannot be attributed to any other
 * clause — which is exactly what the older "no evidence denies every action"
 * case could not show: it denied REFRESH on the FIRST clause
 * (`SAME_CONVERSATION_UNPROVEN`) and so never reached the human-state pair.
 */
describe("absent side-effect / human-state evidence denies (§4.2: ambiguity fails closed)", () => {
  it("denies CONTINUE_PROVIDER_TURN when sideEffectsOutstanding was never read", () => {
    const { sideEffectsOutstanding: _unread, ...sideEffectsUnread } = CONTINUE_ACCEPTED_OK;
    // Control first: the same set WITH the read is a pass, so the denial below
    // is attributable to the unread field and nothing else.
    expect(gate("CONTINUE_PROVIDER_TURN", CONTINUE_ACCEPTED_OK).decision.verdict).toBe("ALLOW");
    const result = gate("CONTINUE_PROVIDER_TURN", sideEffectsUnread);
    expectDeny(result.decision, "SIDE_EFFECTS_UNRESOLVED");
    // A refusal authorizes nothing and burns no budget (§5.2).
    expect(result.budget.consumedAttempts).toBe(0);
  });

  it("denies PROVIDER_NATIVE_RETRY when sideEffectsOutstanding was never read", () => {
    const { sideEffectsOutstanding: _unread, ...sideEffectsUnread } = NATIVE_RETRY_OK;
    expect(gate("PROVIDER_NATIVE_RETRY", NATIVE_RETRY_OK).decision.verdict).toBe("ALLOW");
    expectDeny(gate("PROVIDER_NATIVE_RETRY", sideEffectsUnread).decision, "SIDE_EFFECTS_UNRESOLVED");
  });

  it("denies REFRESH when the human-state safety record is absent", () => {
    const { humanStateSafety: _unread, ...humanStateUnread } = REFRESH_OK;
    expect(gate("REFRESH", REFRESH_OK).decision.verdict).toBe("ALLOW");
    const result = gate("REFRESH", humanStateUnread);
    expectDeny(result.decision, "REFRESH_UNSAFE_FOR_HUMAN_STATE");
    expect(result.budget.consumedAttempts).toBe(0);
  });

  it("distinguishes 'known outstanding' from 'never read' in the audit detail", () => {
    // Both deny for the same reason — an unresolved side effect IS the failure
    // §8.2 names — but an audit must be able to tell which one it was.
    const { sideEffectsOutstanding: _unread, ...sideEffectsUnread } = CONTINUE_ACCEPTED_OK;
    const neverRead = gate("CONTINUE_PROVIDER_TURN", sideEffectsUnread).decision;
    const knownOutstanding = gate("CONTINUE_PROVIDER_TURN", { ...CONTINUE_ACCEPTED_OK, sideEffectsOutstanding: true }).decision;
    expectDeny(neverRead, "SIDE_EFFECTS_UNRESOLVED");
    expectDeny(knownOutstanding, "SIDE_EFFECTS_UNRESOLVED");
    if (neverRead.verdict !== "DENY" || knownOutstanding.verdict !== "DENY") throw new Error("unreachable");
    expect(neverRead.detail).not.toBe(knownOutstanding.detail);
  });
});

/**
 * The generic form of the same property, and the guard against the failure
 * recurring: rather than trusting a hand-picked case per clause, this drops one
 * satisfied field at a time from each fully-satisfying set. A clause that can be
 * masked by an earlier one no longer passes unnoticed, and a polarity slip like
 * `=== true` is caught for every field it could be written on.
 */
describe("every satisfied evidence field is load-bearing (§4.2)", () => {
  const MUST_DENY_WHEN_DROPPED: ReadonlyArray<readonly [RecoveryAction, RecoveryEvidence, readonly string[]]> = [
    ["REFRESH", REFRESH_OK, ["sameProviderConversation", "executionOwnershipUnambiguous", "refreshSafe", "humanStateSafety"]],
    ["PROVIDER_NATIVE_RETRY", NATIVE_RETRY_OK, ["turnAcceptance", "assistantGeneration", "sideEffectsOutstanding", "providerRetrySemantics"]],
    [
      "CONTINUE_PROVIDER_TURN",
      CONTINUE_ACCEPTED_OK,
      [
        "turnAcceptance",
        "acceptedOperationId",
        "acceptedOperationKind",
        "acceptedTurnRef",
        "assistantPartialOutputObserved",
        "assistantGeneration",
        "sideEffectsOutstanding",
        "sameProviderConversation",
      ],
    ],
    // `priorAttemptRefs` is the one field deliberately NOT listed: it records
    // attempts already burned, so its absence is "no retry has happened yet",
    // which is a legitimate pass rather than an unread question.
    ["SHUTTLE_RETRY", SHUTTLE_RETRY_OK, ["turnAcceptance", "logicalOperationId", "dispatchAttemptRef"]],
  ];

  it("denies when any one of them is dropped", () => {
    for (const [action, base, fields] of MUST_DENY_WHEN_DROPPED) {
      expect(gate(action, base).decision.verdict, `${action}: the base set must be a pass`).toBe("ALLOW");
      for (const field of fields) {
        const dropped = { ...base } as Record<string, unknown>;
        delete dropped[field];
        expect(gate(action, dropped as RecoveryEvidence).decision.verdict, `${action} without ${field}`).toBe("DENY");
      }
    }
  });
});

describe("WAIT / REOBSERVE / RECONCILE: the only path out of UNKNOWN (§4.1)", () => {
  it("allows all three with no evidence and charges nothing", () => {
    for (const action of ["WAIT", "REOBSERVE", "RECONCILE"] as const) {
      const result = gate(action);
      expect(result.decision.verdict).toBe("ALLOW");
      expect(result.budget.consumedAttempts).toBe(0);
      expect(result.budget.goSlots.consumedSlots).toBe(0);
    }
  });

  it("still allows observation under UNKNOWN acceptance", () => {
    expect(gate("REOBSERVE", { turnAcceptance: "UNKNOWN" }).decision.verdict).toBe("ALLOW");
  });
});

describe("per-action gates are independent, not one shared 'looks fine' check (§4.1)", () => {
  it("a passing REFRESH gate does not authorize any other action", () => {
    expect(gate("REFRESH", REFRESH_OK).decision.verdict).toBe("ALLOW");
    expectDeny(gate("PROVIDER_NATIVE_RETRY", REFRESH_OK).decision, "PROVIDER_RETRY_SEMANTICS_UNPROVEN");
    expectDeny(gate("SHUTTLE_RETRY", REFRESH_OK).decision, "ACCEPTANCE_UNKNOWN");
    expectDeny(gate("CONTINUE_PROVIDER_TURN", REFRESH_OK).decision, "ACCEPTANCE_NOT_PROVEN");
  });

  it("a passing CONTINUE gate does not authorize a Shuttle retry, or vice versa", () => {
    // §4.2: an ACCEPTED turn and a PROVEN_NOT_ACCEPTED turn are mutually
    // exclusive, so these two actions can never both be permitted on one turn.
    expectDeny(gate("SHUTTLE_RETRY", CONTINUE_ACCEPTED_OK).decision, "ACCEPTED_TURN_MUST_NOT_BE_SHUTTLE_RETRIED");
    expectDeny(gate("CONTINUE_PROVIDER_TURN", SHUTTLE_RETRY_OK).decision, "ACCEPTANCE_NOT_PROVEN");
  });

  it("a passing SHUTTLE_RETRY gate does not authorize a provider-native Retry", () => {
    expect(gate("SHUTTLE_RETRY", SHUTTLE_RETRY_OK).decision.verdict).toBe("ALLOW");
    expectDeny(gate("PROVIDER_NATIVE_RETRY", SHUTTLE_RETRY_OK).decision, "PROVIDER_RETRY_SEMANTICS_UNPROVEN");
  });
});

describe("REFRESH gate (§4.1)", () => {
  it("allows only with same-conversation, unambiguous ownership and refresh-safe evidence", () => {
    expect(gate("REFRESH", REFRESH_OK).decision.verdict).toBe("ALLOW");
  });

  it("denies when the action would discard a composer draft", () => {
    expectDeny(
      gate("REFRESH", { ...REFRESH_OK, humanStateSafety: { draftPresent: true, draftPreservedByAction: false } }).decision,
      "REFRESH_UNSAFE_FOR_HUMAN_STATE",
    );
    expect(gate("REFRESH", { ...REFRESH_OK, humanStateSafety: { draftPresent: true, draftPreservedByAction: true } }).decision.verdict).toBe("ALLOW");
  });

  it("denies when the action would discard ephemeral Human state", () => {
    expectDeny(
      gate("REFRESH", { ...REFRESH_OK, humanStateSafety: { ephemeralHumanStatePresent: true } }).decision,
      "REFRESH_UNSAFE_FOR_HUMAN_STATE",
    );
  });

  it("denies refresh against a different provider conversation", () => {
    expectDeny(gate("REFRESH", { ...REFRESH_OK, sameProviderConversation: false }).decision, "SAME_CONVERSATION_UNPROVEN");
  });
});

describe("PROVIDER_NATIVE_RETRY gate (§4.1, §8.2)", () => {
  it("denies for generic ChatGPT even with every other fact favourable: no verified semantics exist", () => {
    // §8.2 lists generic provider-native Retry as HUMAN_REQUIRED. This is the
    // test that pins that: a well-formed, fully favourable evidence set with
    // UNKNOWN semantics still denies.
    expectDeny(
      gate("PROVIDER_NATIVE_RETRY", { ...NATIVE_RETRY_OK, providerRetrySemantics: { status: "UNKNOWN" } }).decision,
      "PROVIDER_RETRY_SEMANTICS_UNPROVEN",
    );
  });

  it("denies when verified semantics omit the target turn or the regenerate/resubmit effect", () => {
    expectDeny(
      gate("PROVIDER_NATIVE_RETRY", { ...NATIVE_RETRY_OK, providerRetrySemantics: { status: "VERIFIED", providerVersionRef: "p@1" } }).decision,
      "PROVIDER_RETRY_TARGET_UNPROVEN",
    );
    expectDeny(
      gate("PROVIDER_NATIVE_RETRY", {
        ...NATIVE_RETRY_OK,
        providerRetrySemantics: { status: "VERIFIED", targetTurnRef: "turn-9", providerVersionRef: "p@1" },
      }).decision,
      "PROVIDER_RETRY_TARGET_UNPROVEN",
    );
  });

  it("denies a native Retry on a turn that was never proven accepted", () => {
    expectDeny(gate("PROVIDER_NATIVE_RETRY", { ...NATIVE_RETRY_OK, turnAcceptance: "UNKNOWN" }).decision, "ACCEPTANCE_NOT_PROVEN");
    expectDeny(gate("PROVIDER_NATIVE_RETRY", { ...NATIVE_RETRY_OK, turnAcceptance: "PROVEN_NOT_ACCEPTED" }).decision, "ACCEPTANCE_NOT_PROVEN");
  });

  it("denies when the assistant generation is not determinately interrupted", () => {
    expectDeny(gate("PROVIDER_NATIVE_RETRY", { ...NATIVE_RETRY_OK, assistantGeneration: "STILL_GENERATING" }).decision, "ASSISTANT_GENERATION_STILL_RUNNING");
    expectDeny(gate("PROVIDER_NATIVE_RETRY", { ...NATIVE_RETRY_OK, assistantGeneration: "UNKNOWN" }).decision, "ASSISTANT_GENERATION_UNKNOWN");
  });

  it("denies with outstanding tool/external side effects", () => {
    expectDeny(gate("PROVIDER_NATIVE_RETRY", { ...NATIVE_RETRY_OK, sideEffectsOutstanding: true }).decision, "SIDE_EFFECTS_UNRESOLVED");
  });

  it("allows only under fully verified provider/version semantics", () => {
    expect(gate("PROVIDER_NATIVE_RETRY", NATIVE_RETRY_OK).decision.verdict).toBe("ALLOW");
  });
});

describe("SHUTTLE_RETRY gate (§4.1, §4.2, §5.1)", () => {
  it("denies on UNCERTAIN: uncertain is never evidence of non-acceptance", () => {
    // The core prohibition. `UNKNOWN` here is the model's value for the
    // ledger's STILL_AMBIGUOUS (see recoveryEvidenceFromReconcileOutcome).
    expectDeny(gate("SHUTTLE_RETRY", { ...SHUTTLE_RETRY_OK, turnAcceptance: "UNKNOWN" }).decision, "ACCEPTANCE_UNKNOWN");
  });

  it("denies with a named reason when the turn is accepted — never resend an accepted turn", () => {
    expectDeny(gate("SHUTTLE_RETRY", { ...SHUTTLE_RETRY_OK, turnAcceptance: "ACCEPTED" }).decision, "ACCEPTED_TURN_MUST_NOT_BE_SHUTTLE_RETRIED");
  });

  it("requires a new dispatch attempt/fence", () => {
    expectDeny(gate("SHUTTLE_RETRY", { ...SHUTTLE_RETRY_OK, dispatchAttemptRef: undefined }).decision, "CONTINUATION_OPERATION_UNPROVEN");
    expectDeny(gate("SHUTTLE_RETRY", { ...SHUTTLE_RETRY_OK, dispatchAttemptRef: "  " }).decision, "CONTINUATION_OPERATION_UNPROVEN");
  });

  it("refuses a re-used dispatch attempt as a new attempt", () => {
    expectDeny(gate("SHUTTLE_RETRY", { ...SHUTTLE_RETRY_OK, dispatchAttemptRef: "attempt-1" }).decision, "CONTINUATION_OPERATION_UNPROVEN");
  });

  it("requires the logical operation identity", () => {
    expectDeny(gate("SHUTTLE_RETRY", { ...SHUTTLE_RETRY_OK, logicalOperationId: undefined }).decision, "CONTINUATION_OPERATION_UNPROVEN");
  });

  it("allows only after PROVEN_NOT_ACCEPTED with a fresh attempt", () => {
    expect(gate("SHUTTLE_RETRY", SHUTTLE_RETRY_OK).decision.verdict).toBe("ALLOW");
  });
});

describe("CONTINUE_PROVIDER_TURN gate (§4.1, §4.2, §5.2)", () => {
  it("allows on a fully evidenced accepted-and-interrupted turn", () => {
    expect(gate("CONTINUE_PROVIDER_TURN", CONTINUE_ACCEPTED_OK).decision.verdict).toBe("ALLOW");
  });

  it("denies without observable assistant partial output", () => {
    expectDeny(gate("CONTINUE_PROVIDER_TURN", { ...CONTINUE_ACCEPTED_OK, assistantPartialOutputObserved: false }).decision, "CONTINUATION_PARTIAL_OUTPUT_UNPROVEN");
    expectDeny(gate("CONTINUE_PROVIDER_TURN", { ...CONTINUE_ACCEPTED_OK, assistantPartialOutputObserved: undefined }).decision, "CONTINUATION_PARTIAL_OUTPUT_UNPROVEN");
  });

  it("denies when the generation is not determinately interrupted", () => {
    expectDeny(gate("CONTINUE_PROVIDER_TURN", { ...CONTINUE_ACCEPTED_OK, assistantGeneration: "COMPLETED" }).decision, "ASSISTANT_GENERATION_UNKNOWN");
    expectDeny(gate("CONTINUE_PROVIDER_TURN", { ...CONTINUE_ACCEPTED_OK, assistantGeneration: "STILL_GENERATING" }).decision, "ASSISTANT_GENERATION_STILL_RUNNING");
  });

  it("denies with unresolved side effects", () => {
    expectDeny(gate("CONTINUE_PROVIDER_TURN", { ...CONTINUE_ACCEPTED_OK, sideEffectsOutstanding: true }).decision, "SIDE_EFFECTS_UNRESOLVED");
  });

  it("refuses acceptance borrowed from a discovery operation (§4.1)", () => {
    for (const kind of ["BOOTSTRAP", "REVIEW_DISPATCH", "SEDIMENT", "DELIVER_CHILD_RESULT", "REANCHOR_GOAL"]) {
      expectDeny(gate("CONTINUE_PROVIDER_TURN", { ...CONTINUE_ACCEPTED_OK, acceptedOperationKind: kind }).decision, "CONTINUATION_NOT_THE_RECOVERY_ACTION");
    }
  });

  it("refuses a context-limit or unclassified provider error as continue evidence (§10-1)", () => {
    expectDeny(
      gate("CONTINUE_PROVIDER_TURN", { ...CONTINUE_ACCEPTED_OK, providerError: { kind: "CONTEXT_LIMIT" } }).decision,
      "CONTINUATION_NOT_THE_RECOVERY_ACTION",
    );
    expectDeny(
      gate("CONTINUE_PROVIDER_TURN", { ...CONTINUE_ACCEPTED_OK, providerError: { kind: "UNCLASSIFIED" } }).decision,
      "CONTINUATION_NOT_THE_RECOVERY_ACTION",
    );
  });

  it("denies when no accepted turn ref is pinned", () => {
    expectDeny(gate("CONTINUE_PROVIDER_TURN", { ...CONTINUE_ACCEPTED_OK, acceptedTurnRef: "" }).decision, "CONTINUATION_OPERATION_UNPROVEN");
  });

  it("denies when there is no remaining Go × N slot (§5.2, §5.3)", () => {
    expectDeny(
      gate("CONTINUE_PROVIDER_TURN", CONTINUE_ACCEPTED_OK, loopContext(), budget({ goSlots: { maxSlots: 2, consumedSlots: 2 } })).decision,
      "CONTINUATION_SLOT_BUDGET_EXHAUSTED",
    );
  });

  it("still allows a REFRESH with no remaining Go slot: refresh burns no slot", () => {
    expect(gate("REFRESH", REFRESH_OK, loopContext(), budget({ goSlots: { maxSlots: 2, consumedSlots: 2 } })).decision.verdict).toBe("ALLOW");
  });
});

describe("context rebase is denied by Go × N authorization (§6.2, §8.2)", () => {
  it("refuses a rebase request with an attributed reason rather than by omission", () => {
    expectDeny(gate(CONTEXT_REBASE_ACTION).decision, "REBASE_NOT_AUTHORIZED_BY_GO_N");
  });

  it("refuses a rebase even with otherwise favourable evidence and fresh budget", () => {
    const result = gate(CONTEXT_REBASE_ACTION, CONTINUE_ACCEPTED_OK);
    expectDeny(result.decision, "REBASE_NOT_AUTHORIZED_BY_GO_N");
    expect(result.budget.consumedAttempts).toBe(0);
  });
});

describe("run-level context gates", () => {
  it("a Stop latch cancels not-yet-actuated recovery actions, even with perfect evidence", () => {
    for (const action of ["REFRESH", "SHUTTLE_RETRY", "CONTINUE_PROVIDER_TURN", "PROVIDER_NATIVE_RETRY"] as const) {
      const evidence =
        action === "REFRESH" ? REFRESH_OK : action === "SHUTTLE_RETRY" ? SHUTTLE_RETRY_OK : action === "PROVIDER_NATIVE_RETRY" ? NATIVE_RETRY_OK : CONTINUE_ACCEPTED_OK;
      expectDeny(gate(action, evidence, loopContext({ stopLatched: true })).decision, "STOP_LATCHED");
    }
  });

  it("a Stop latch does not block passive re-observation", () => {
    // §6.1: already-issued actions may still be observed and reconciled; the
    // latch cancels *actuation*, not reading.
    expect(gate("REOBSERVE", {}, loopContext({ stopLatched: true })).decision.verdict).toBe("ALLOW");
  });

  it("Human intervention blocks every actuating action with perfect evidence", () => {
    const evidenceFor: Record<RecoveryAction, RecoveryEvidence> = {
      REFRESH: REFRESH_OK,
      SHUTTLE_RETRY: SHUTTLE_RETRY_OK,
      CONTINUE_PROVIDER_TURN: CONTINUE_ACCEPTED_OK,
      PROVIDER_NATIVE_RETRY: NATIVE_RETRY_OK,
    };
    for (const [action, evidence] of Object.entries(evidenceFor) as Array<[RecoveryAction, RecoveryEvidence]>) {
      expectDeny(gate(action, evidence, loopContext({ humanIntervention: true })).decision, "HUMAN_INTERVENTION");
    }
  });

  it("leaves observation opening under Human intervention, because no read actuates", () => {
    // §4.1 makes wait/re-observe/reconcile the only path by which the Run can
    // reach the evidence that would otherwise lift it; blocking them under
    // intervention would leave it unable to ever establish what happened.
    for (const action of ["WAIT", "REOBSERVE", "RECONCILE"] as const) {
      expect(gate(action, {}, loopContext({ humanIntervention: true })).decision.verdict).toBe("ALLOW");
    }
  });

  it("still refuses a rebase under Human intervention, and says why", () => {
    expectDeny(gate(CONTEXT_REBASE_ACTION, {}, loopContext({ humanIntervention: true })).decision, "REBASE_NOT_AUTHORIZED_BY_GO_N");
  });

  it("a binding change ends actuation regardless of evidence (§6.2)", () => {
    const context = loopContext({ binding: binding({ bindingGeneration: 2 }) });
    expectDeny(gate("REFRESH", REFRESH_OK, context).decision, "BINDING_CHANGED");
    expectDeny(gate("CONTINUE_PROVIDER_TURN", CONTINUE_ACCEPTED_OK, context).decision, "BINDING_CHANGED");
  });

  it("a budget scoped to a superseded generation cannot actuate", () => {
    expectDeny(
      gate("REFRESH", REFRESH_OK, loopContext(), budget({ scope: scope({ bindingGeneration: 5 }) })).decision,
      "BINDING_CHANGED",
    );
  });

  it("a carrier identity change alone does not block recovery (§4.1)", () => {
    expect(gate("REFRESH", REFRESH_OK, loopContext({ currentCarrierRef: "carrier-b" })).decision.verdict).toBe("ALLOW");
  });

  it("refuses evidence read against a different Provider Conversation", () => {
    // Perfect evidence about conv-1 must not authorize an action on conv-2.
    expectDeny(
      gate("REFRESH", REFRESH_OK, loopContext({ binding: binding({ providerConversationRef: "conv-2" }) }), undefined, binding({ providerConversationRef: "conv-1" })).decision,
      "SAME_CONVERSATION_UNPROVEN",
    );
  });
});

describe("RecoveryBudget consumption (§5.2)", () => {
  it("charges exactly one attempt per allowed recovery action and reports it", () => {
    const first = gate("REFRESH", REFRESH_OK);
    expect(first.budget.consumedAttempts).toBe(1);
    expect(first.budget.revision).toBe(1);
    if (first.decision.verdict !== "ALLOW") throw new Error("unreachable");
    const entry = attemptOf(first);
    expect(first.decision.verdict === "ALLOW" && first.decision.ledgerEntryId).toBe("recov:bud-1:1");
    expect(entry.action).toBe("REFRESH");
    expect(entry.operationId).toBe("op-1");
    expect(entry.consideredEvidence).toEqual(binding());
  });

  it("charges nothing on denial, so persisting a denial cannot burn budget", () => {
    const starting = budget({ consumedAttempts: 1 });
    const result = gate("SHUTTLE_RETRY", {}, loopContext(), starting);
    expect(result.decision.verdict).toBe("DENY");
    expect(result.budget).toBe(starting);
    expect(result.budget.consumedAttempts).toBe(1);
  });

  it("does not charge a Go slot merely for requesting a continue", () => {
    const result = gate("CONTINUE_PROVIDER_TURN", CONTINUE_ACCEPTED_OK);
    expect(result.budget.consumedAttempts).toBe(1);
    expect(result.budget.goSlots.consumedSlots).toBe(0);
    expect(attemptOf(result).goSlot).toEqual({ slotRef: "recov:bud-1:1:go", state: "ESTIMATED" });
  });

  it("gives no Go-slot placeholder to an action that creates no user turn", () => {
    expect(attemptOf(gate("PROVIDER_NATIVE_RETRY", NATIVE_RETRY_OK)).goSlot).toBeUndefined();
  });

  it("exhausts to HUMAN_REQUIRED and stops allowing actuation, while leaving observation open", () => {
    const exhausted = budget({ consumedAttempts: 3, revision: 3 });
    expectDeny(gate("REFRESH", REFRESH_OK, loopContext(), exhausted).decision, "RECOVERY_BUDGET_EXHAUSTED");
    expectDeny(gate("CONTINUE_PROVIDER_TURN", CONTINUE_ACCEPTED_OK, loopContext(), exhausted).decision, "RECOVERY_BUDGET_EXHAUSTED");
    expect(gate("WAIT", {}, loopContext(), exhausted).decision.verdict).toBe("ALLOW");
  });

  it("consumes the budget one attempt at a time down to exhaustion", () => {
    let current = budget({ maxAttempts: 2 });
    for (const expectedRemaining of [1, 0]) {
      const result = gate("REFRESH", REFRESH_OK, loopContext(), current);
      expect(result.decision.verdict).toBe("ALLOW");
      current = result.budget;
      expect(current.maxAttempts - current.consumedAttempts).toBe(expectedRemaining);
    }
    expectDeny(gate("REFRESH", REFRESH_OK, loopContext(), current).decision, "RECOVERY_BUDGET_EXHAUSTED");
  });
});

describe("Go × N slot charge is exactly-once and acceptance-gated (§5.2, §5.3)", () => {
  function continueAllowance(): { entry: RecoveryAttemptLedgerEntry; bud: RecoveryBudget } {
    const result = gate("CONTINUE_PROVIDER_TURN", CONTINUE_ACCEPTED_OK);
    return { entry: attemptOf(result), bud: result.budget };
  }

  it("charges the slot on proven acceptance", () => {
    const { entry, bud } = continueAllowance();
    const charged = chargeGoSlotOnAcceptance({ budget: bud, entry, acceptedTurnRef: "turn-10", acceptanceProven: true, now: 2_000 });
    expect(charged.budget.goSlots.consumedSlots).toBe(1);
    expect(charged.entry.goSlot).toEqual({ slotRef: "recov:bud-1:1:go", state: "CONSUMED", consumedTurnRef: "turn-10" });
  });

  it("does not double-charge when the same acceptance evidence is redelivered", () => {
    const { entry, bud } = continueAllowance();
    const first = chargeGoSlotOnAcceptance({ budget: bud, entry, acceptedTurnRef: "turn-10", acceptanceProven: true, now: 2_000 });
    const second = chargeGoSlotOnAcceptance({ budget: first.budget, entry: first.entry, acceptedTurnRef: "turn-10", acceptanceProven: true, now: 2_100 });
    expect(second.changed).toBe(false);
    expect(second.budget.goSlots.consumedSlots).toBe(1);
  });

  it("releases rather than charges the slot when acceptance is not proven", () => {
    const { entry, bud } = continueAllowance();
    const released = chargeGoSlotOnAcceptance({ budget: bud, entry, acceptedTurnRef: "turn-10", acceptanceProven: false, now: 2_000 });
    expect(released.budget.goSlots.consumedSlots).toBe(0);
    expect(released.entry.goSlot?.state).toBe("ESTIMATED");
    expect(released.error).toContain("acceptance not proven");
  });

  it("refuses to charge a slot for an action that has none", () => {
    const result = gate("REFRESH", REFRESH_OK);
    const charged = chargeGoSlotOnAcceptance({
      budget: result.budget,
      entry: attemptOf(result),
      acceptedTurnRef: "turn-10",
      acceptanceProven: true,
      now: 2_000,
    });
    expect(charged.changed).toBe(false);
    expect(charged.error).toContain("no Go × N slot");
  });

  it("refuses to charge an entry against a different budget", () => {
    const { entry, bud } = continueAllowance();
    const charged = chargeGoSlotOnAcceptance({
      budget: { ...bud, budgetId: "bud-other" },
      entry,
      acceptedTurnRef: "turn-10",
      acceptanceProven: true,
      now: 2_000,
    });
    expect(charged.changed).toBe(false);
    expect(charged.error).toBe("budget/attempt mismatch");
  });
});

describe("reconcile-outcome adapter (§4.1, §5.1)", () => {
  it("maps STILL_AMBIGUOUS to UNKNOWN, never to 'not accepted'", () => {
    // The one mapping that could quietly widen recovery, pinned here: §4.1
    // forbids reading UNCERTAIN as unaccepted, which is what would make a
    // Shuttle resend look authorized.
    expect(recoveryEvidenceFromReconcileOutcome({ outcome: "STILL_AMBIGUOUS" })).toEqual({ turnAcceptance: "UNKNOWN", basis: "STILL_AMBIGUOUS" });
    // And the consequence, end to end:
    expectDeny(gate("SHUTTLE_RETRY", { ...SHUTTLE_RETRY_OK, turnAcceptance: "UNKNOWN" }).decision, "ACCEPTANCE_UNKNOWN");
  });

  it("maps PROVEN_ACCEPTED and PROVEN_NOT_ACCEPTED through", () => {
    expect(recoveryEvidenceFromReconcileOutcome({ outcome: "PROVEN_ACCEPTED", authority: "OK" }).turnAcceptance).toBe("ACCEPTED");
    expect(recoveryEvidenceFromReconcileOutcome({ outcome: "PROVEN_NOT_ACCEPTED", authority: "OK" }).turnAcceptance).toBe("PROVEN_NOT_ACCEPTED");
  });

  it("refuses acceptance evidence from an operation whose authority is not OK", () => {
    for (const authority of ["ABSENT", "SUPERSEDED", undefined] as const) {
      const evidence = recoveryEvidenceFromReconcileOutcome({ outcome: "PROVEN_ACCEPTED", ...(authority ? { authority } : {}) });
      expect(evidence.turnAcceptance).toBe("UNKNOWN");
    }
  });
});
