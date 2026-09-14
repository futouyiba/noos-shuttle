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
    state: "PREPARED"
  } satisfies ReducerSubmissionOperation);
  expect(reducer.claimSubmissionDispatch({
    operationId: "op-1", logicalThreadId: "thread-1", providerConversationRef: "conversation-2",
    bindingGeneration: 2, leaseGeneration: 1, carrierRef: "tab-1", actor: "human", now: 30
  }).ok).toBe(true);
  return reducer;
}

function settle(reducer: OperationalStateReducer, overrides: Record<string, unknown> = {}) {
  return settleFromEvidence(reducer, {
    operationId: "op-1",
    evidence: entry(),
    fence,
    targetState: "OBSERVED_ACCEPTED",
    expectedCurrentState: "DISPATCHING",
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
      expect(result.value.dispatchFence).toEqual(toReducerDispatchFence(fence));
    }
  });

  it("completes from a turn-completion entry after acceptance", () => {
    const reducer = claimedReducer();
    settle(reducer);
    const completed = settle(reducer, {
      evidence: entry({ eventKind: "TURN_COMPLETION_OBSERVED", executionAttemptId: "attempt-2" }),
      targetState: "COMPLETED",
      expectedCurrentState: "OBSERVED_ACCEPTED",
      reason: "result-bearing turn finished"
    });
    expect(completed.ok).toBe(true);
    if (completed.ok) expect(completed.value.state).toBe("COMPLETED");
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
    // A journal entry whose fingerprint matches the *modified* fence passes the
    // composer's binding check and reaches the reducer's authority check.
    const staleFenceFence = { ...fence, bindingEpoch: 3 };
    const staleFence = settle(reducer, {
      fence: staleFenceFence,
      evidence: entry({ dispatchFenceFingerprint: dispatchFenceFingerprint(staleFenceFence) })
    });
    expect(staleFence.ok).toBe(false);
    if (!staleFence.ok) expect(staleFence.error.code).toBe("SETTLE_FENCE_MISMATCH");

    const illegal = settle(reducer, { targetState: "COMPLETED" });
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.error.code).toBe("SETTLE_TRANSITION_INVALID");
  });

  it("replays fail closed with a stale expectation and stay idempotent with the settled one", () => {
    const reducer = claimedReducer();
    settle(reducer);
    // Stale expectation: the operation already moved.
    const stale = settle(reducer);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("SETTLE_STATE_MISMATCH");
    // Equal-state replay: idempotent, no further transition.
    const replay = settle(reducer, { expectedCurrentState: "OBSERVED_ACCEPTED", targetState: "OBSERVED_ACCEPTED" });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.value.state).toBe("OBSERVED_ACCEPTED");
  });
});
