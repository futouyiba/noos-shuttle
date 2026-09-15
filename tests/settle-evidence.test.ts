import { describe, expect, it } from "vitest";
import { OperationalStateReducer, type ReducerSubmissionOperation } from "../src/core/operational-state-reducer";
import { settleFromEvidence, toReducerDispatchFence, type JournalFence } from "../src/core/settle-evidence";
import { dispatchFenceFingerprint, type ExecutionJournalEntry } from "../src/core/execution-journal";

// Distinct values so a swapped mapping (binding↔lease generation) cannot pass.
const fence: JournalFence = {
  providerConversationRef: "conversation-2",
  bindingEpoch: 2,
  leaseGeneration: 1,
  leaseOwnerRef: "owner-1",
  targetCarrierRef: "tab-1"
};

function entry(overrides: Partial<ExecutionJournalEntry> = {}): ExecutionJournalEntry {
  return {
    executionAttemptId: "attempt-1",
    operationId: "op-1",
    dispatchFenceFingerprint: dispatchFenceFingerprint(fence),
    eventKind: "ACCEPTANCE_OBSERVED",
    evidence: { observed: true },
    recordedAt: 35,
    ...overrides
  };
}

function claimedReducer(): OperationalStateReducer {
  const reducer = new OperationalStateReducer();
  expect(reducer.commitCurrentConversationBinding({
    logicalThreadId: "thread-1", providerConversationRef: "conversation-1", expected: null, actor: "system", now: 1
  }).ok).toBe(true);
  // Rollover so the binding generation (2) differs from the lease generation (1).
  expect(reducer.commitCurrentConversationBinding({
    logicalThreadId: "thread-1", providerConversationRef: "conversation-2",
    expected: { logicalThreadId: "thread-1", providerConversationRef: "conversation-1", generation: 1, mutationAt: 1 },
    actor: "system", now: 2
  }).ok).toBe(true);
  expect(reducer.transferActuationLease({
    logicalThreadId: "thread-1", providerConversationRef: "conversation-2",
    expectedBindingGeneration: 2, expectedLeaseGeneration: null, carrierRef: "tab-1", actor: "system", now: 10
  }).ok).toBe(true);
  reducer.seedOperation({
    operationId: "op-1",
    logicalThreadId: "thread-1",
    providerConversationRef: "conversation-2",
    carrierRef: "tab-1",
    bindingGeneration: 2,
    leaseGeneration: 1,
    state: "PREPARED",
    operationRevision: 0
  } satisfies ReducerSubmissionOperation);
  const claim = reducer.claimSubmissionDispatch({
    operationId: "op-1", logicalThreadId: "thread-1", providerConversationRef: "conversation-2",
    bindingGeneration: 2, leaseGeneration: 1, carrierRef: "tab-1", actor: "human", now: 30
  });
  expect(claim.ok).toBe(true);
  if (claim.ok) {
    (globalThis as unknown as { __op1: { revision: number; fenceId: string } }).__op1 = {
      revision: claim.value.operationRevision,
      fenceId: claim.value.dispatchFence!.dispatchFenceId
    };
  }
  return reducer;
}
function attemptContext(): { revision: number; fenceId: string } {
  return (globalThis as unknown as { __op1: { revision: number; fenceId: string } }).__op1;
}

function settle(reducer: OperationalStateReducer, overrides: Record<string, unknown> = {}) {
  const attempt = attemptContext();
  return settleFromEvidence(reducer, {
    operationId: "op-1",
    evidence: entry(),
    fence,
    targetState: "OBSERVED_ACCEPTED",
    expectedOperationRevision: attempt.revision,
    expectedDispatchFenceId: attempt.fenceId,
    reason: "provider acceptance observed",
    actor: "worker",
    now: 40,
    ...overrides
  });
}

describe("fence mapping", () => {
  it("maps the journal spelling onto the reducer spelling field by field", () => {
    expect(toReducerDispatchFence(fence)).toEqual({
      providerConversationRef: "conversation-2",
      carrierRef: "tab-1",
      bindingGeneration: 2,
      leaseGeneration: 1
    });
  });
});

describe("settle from evidence", () => {
  it("settles DISPATCHING to OBSERVED_ACCEPTED from an acceptance entry", () => {
    const reducer = claimedReducer();
    const result = settle(reducer);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("OBSERVED_ACCEPTED");
      expect(result.value.dispatchFence).toMatchObject(toReducerDispatchFence(fence));
      expect(result.value.dispatchFence?.dispatchFenceId).toBe(attemptContext().fenceId);
      expect(result.value.operationRevision).toBe(attemptContext().revision + 1);
    }
  });

  it("completes from a turn-completion entry after acceptance on the same fence", () => {
    const reducer = claimedReducer();
    const accepted = settle(reducer);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) attemptContext().revision = accepted.value.operationRevision;
    const completed = settle(reducer, {
      evidence: entry({ eventKind: "TURN_COMPLETION_OBSERVED", executionAttemptId: "attempt-2" }),
      targetState: "COMPLETED",
      reason: "result-bearing turn finished"
    });
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      expect(completed.value.state).toBe("COMPLETED");
      // Same attempt identity across both hops (adjudication W11 D1).
      expect(completed.value.dispatchFence?.dispatchFenceId).toBe(attemptContext().fenceId);
      expect(completed.value.operationRevision).toBe(attemptContext().revision + 1);
    }
  });

  it("settles UNCERTAIN from a blind-dispatch-attempt or provider-ack entry", () => {
    for (const eventKind of ["BLIND_DISPATCH_ATTEMPT", "PROVIDER_ACK"] as const) {
      const reducer = claimedReducer();
      const result = settle(reducer, {
        evidence: entry({ eventKind }),
        targetState: "UNCERTAIN",
        reason: "acknowledgement lost"
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.state).toBe("UNCERTAIN");
    }
  });

  it("fails closed when the evidence belongs to another operation", () => {
    const reducer = claimedReducer();
    expect(() => settle(reducer, { evidence: entry({ operationId: "op-2" }) })).toThrow("evidence_operation_mismatch");
  });

  it("fails closed when the evidence was recorded under a different fence", () => {
    const reducer = claimedReducer();
    expect(() => settle(reducer, {
      // The entry carries a fingerprint that does not match the supplied fence.
      evidence: entry({ dispatchFenceFingerprint: "fence:deadbeef" })
    })).toThrow("evidence_fence_mismatch");
  });

  it("fails closed when a transport-level fact claims acceptance or a terminal state", () => {
    const reducer = claimedReducer();
    for (const eventKind of ["BLIND_DISPATCH_ATTEMPT", "PROVIDER_ACK"] as const) {
      for (const targetState of ["OBSERVED_ACCEPTED", "COMPLETED", "FAILED_SAFE", "CANCELLED"] as const) {
        expect(() => settle(reducer, { evidence: entry({ eventKind }), targetState }))
          .toThrow(`evidence_kind_cannot_settle_target:${eventKind}->${targetState}`);
      }
    }
  });

  it("still respects the reducer's own fence and transition guards", () => {
    const reducer = claimedReducer();
    // The attempt identity is the minted fence id: a settle naming another
    // attempt fails the reducer's authority check.
    const wrongAttempt = settle(reducer, { expectedDispatchFenceId: "fence-not-this-attempt" });
    expect(wrongAttempt.ok).toBe(false);
    if (!wrongAttempt.ok) expect(wrongAttempt.error.code).toBe("SETTLE_FENCE_MISMATCH");

    const wrongRevision = settle(reducer, { expectedOperationRevision: 99 });
    expect(wrongRevision.ok).toBe(false);
    if (!wrongRevision.ok) expect(wrongRevision.error.code).toBe("SETTLE_REVISION_MISMATCH");

    const illegal = settle(reducer, { targetState: "COMPLETED" });
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.error.code).toBe("SETTLE_TRANSITION_INVALID");
  });

  it("settles FAILED_SAFE only from reconciliation evidence deriving PROVEN_NOT_ACCEPTED", () => {
    const reducer = claimedReducer();
    const attempt = attemptContext();
    const ok = settleFromEvidence(reducer, {
      operationId: "op-1",
      evidence: entry({ eventKind: "RECONCILIATION_EVIDENCE", executionAttemptId: "attempt-na", evidence: { outcome: "PROVEN_NOT_ACCEPTED" } }),
      fence,
      targetState: "FAILED_SAFE",
      expectedOperationRevision: attempt.revision,
      expectedDispatchFenceId: attempt.fenceId,
      reason: "proven not accepted", actor: "worker", now: 40
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.state).toBe("FAILED_SAFE");
    // A reconciliation entry whose outcome is not PROVEN_NOT_ACCEPTED refuses.
    const fresh = claimedReducer();
    const freshAttempt = attemptContext();
    expect(() => settleFromEvidence(fresh, {
      operationId: "op-1",
      evidence: entry({ eventKind: "RECONCILIATION_EVIDENCE", evidence: { outcome: "STILL_AMBIGUOUS" } }),
      fence,
      targetState: "FAILED_SAFE",
      expectedOperationRevision: freshAttempt.revision,
      expectedDispatchFenceId: freshAttempt.fenceId,
      reason: "ambiguous", actor: "worker", now: 40
    })).toThrow("evidence_not_proven_not_accepted");
    // An acceptance observation can never prove not-accepted.
    const fresh2 = claimedReducer();
    const freshAttempt2 = attemptContext();
    expect(() => settleFromEvidence(fresh2, {
      operationId: "op-1",
      evidence: entry({ eventKind: "ACCEPTANCE_OBSERVED" }),
      fence,
      targetState: "FAILED_SAFE",
      expectedOperationRevision: freshAttempt2.revision,
      expectedDispatchFenceId: freshAttempt2.fenceId,
      reason: "acceptance cannot prove not-accepted", actor: "worker", now: 40
    })).toThrow("evidence_kind_cannot_settle_target:ACCEPTANCE_OBSERVED->FAILED_SAFE");
  });

  it("rejects a settle whose revision expectation is stale", () => {
    const reducer = claimedReducer();
    settle(reducer);
    // The caller's revision predates the accepted hop: fail closed. Replay
    // safety belongs to the delta layer, not to re-settling.
    const stale = settle(reducer);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("SETTLE_REVISION_MISMATCH");
  });
});
