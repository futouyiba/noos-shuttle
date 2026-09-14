import { describe, expect, it } from "vitest";
import { OperationalStateReducer, type ReducerSubmissionOperation } from "../src/core/operational-state-reducer";
import { settleFromEvidence, toReducerDispatchFence, type JournalFence } from "../src/core/settle-evidence";
import type { ExecutionJournalEntry } from "../src/core/execution-journal";

const fence: JournalFence = {
  providerConversationRef: "conversation-1",
  bindingEpoch: 1,
  leaseGeneration: 1,
  leaseOwnerRef: "owner-1",
  targetCarrierRef: "tab-1"
};

function entry(overrides: Partial<ExecutionJournalEntry> = {}): ExecutionJournalEntry {
  return {
    executionAttemptId: "attempt-1",
    operationId: "op-1",
    dispatchFenceFingerprint: "fence:1a",
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
  expect(reducer.transferActuationLease({
    logicalThreadId: "thread-1", providerConversationRef: "conversation-1",
    expectedBindingGeneration: 1, expectedLeaseGeneration: null, carrierRef: "tab-1", actor: "system", now: 10
  }).ok).toBe(true);
  reducer.seedOperation({
    operationId: "op-1",
    logicalThreadId: "thread-1",
    providerConversationRef: "conversation-1",
    carrierRef: "tab-1",
    bindingGeneration: 1,
    leaseGeneration: 1,
    state: "PREPARED"
  } satisfies ReducerSubmissionOperation);
  expect(reducer.claimSubmissionDispatch({
    operationId: "op-1", logicalThreadId: "thread-1", providerConversationRef: "conversation-1",
    bindingGeneration: 1, leaseGeneration: 1, carrierRef: "tab-1", actor: "human", now: 30
  }).ok).toBe(true);
  return reducer;
}

describe("fence mapping", () => {
  it("maps the journal spelling onto the reducer spelling", () => {
    expect(toReducerDispatchFence(fence)).toEqual({
      providerConversationRef: "conversation-1",
      carrierRef: "tab-1",
      bindingGeneration: 1,
      leaseGeneration: 1
    });
  });
});

describe("settle from evidence", () => {
  it("settles DISPATCHING to OBSERVED_ACCEPTED from an acceptance entry", () => {
    const reducer = claimedReducer();
    const result = settleFromEvidence(reducer, {
      operationId: "op-1",
      evidence: entry(),
      fence,
      targetState: "OBSERVED_ACCEPTED",
      expectedCurrentState: "DISPATCHING",
      reason: "provider acceptance observed",
      actor: "worker",
      now: 40
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("OBSERVED_ACCEPTED");
      expect(result.value.dispatchFence).toEqual(toReducerDispatchFence(fence));
    }
  });

  it("completes from a turn-completion entry after acceptance", () => {
    const reducer = claimedReducer();
    settleFromEvidence(reducer, {
      operationId: "op-1", evidence: entry(), fence,
      targetState: "OBSERVED_ACCEPTED", expectedCurrentState: "DISPATCHING",
      reason: "accepted", actor: "worker", now: 40
    });
    const completed = settleFromEvidence(reducer, {
      operationId: "op-1",
      evidence: entry({ eventKind: "TURN_COMPLETION_OBSERVED", executionAttemptId: "attempt-2" }),
      fence,
      targetState: "COMPLETED",
      expectedCurrentState: "OBSERVED_ACCEPTED",
      reason: "result-bearing turn finished",
      actor: "worker",
      now: 50
    });
    expect(completed.ok).toBe(true);
    if (completed.ok) expect(completed.value.state).toBe("COMPLETED");
  });

  it("settles UNCERTAIN from a blind-dispatch-attempt entry", () => {
    const reducer = claimedReducer();
    const result = settleFromEvidence(reducer, {
      operationId: "op-1",
      evidence: entry({ eventKind: "BLIND_DISPATCH_ATTEMPT" }),
      fence,
      targetState: "UNCERTAIN",
      expectedCurrentState: "DISPATCHING",
      reason: "acknowledgement lost",
      actor: "worker",
      now: 40
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe("UNCERTAIN");
  });

  it("fails closed when the evidence belongs to another operation", () => {
    const reducer = claimedReducer();
    expect(() => settleFromEvidence(reducer, {
      operationId: "op-1",
      evidence: entry({ operationId: "op-2" }),
      fence,
      targetState: "OBSERVED_ACCEPTED",
      expectedCurrentState: "DISPATCHING",
      reason: "mismatched",
      actor: "worker",
      now: 40
    })).toThrow("evidence_operation_mismatch");
  });

  it("fails closed when the event kind cannot license the target", () => {
    const reducer = claimedReducer();
    expect(() => settleFromEvidence(reducer, {
      operationId: "op-1",
      // A blind attempt proves nothing was observed accepted yet.
      evidence: entry({ eventKind: "BLIND_DISPATCH_ATTEMPT" }),
      fence,
      targetState: "OBSERVED_ACCEPTED",
      expectedCurrentState: "DISPATCHING",
      reason: "over-claiming",
      actor: "worker",
      now: 40
    })).toThrow("evidence_kind_cannot_settle_target:BLIND_DISPATCH_ATTEMPT->OBSERVED_ACCEPTED");
  });

  it("still respects the reducer's own fence and transition guards", () => {
    const reducer = claimedReducer();
    const staleFence = settleFromEvidence(reducer, {
      operationId: "op-1", evidence: entry(),
      fence: { ...fence, bindingEpoch: 2 },
      targetState: "OBSERVED_ACCEPTED", expectedCurrentState: "DISPATCHING",
      reason: "wrong generation", actor: "worker", now: 40
    });
    expect(staleFence.ok).toBe(false);
    if (!staleFence.ok) expect(staleFence.error.code).toBe("SETTLE_FENCE_MISMATCH");

    const illegal = settleFromEvidence(reducer, {
      operationId: "op-1", evidence: entry(), fence,
      targetState: "COMPLETED", expectedCurrentState: "DISPATCHING",
      reason: "skipping acceptance", actor: "worker", now: 40
    });
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.error.code).toBe("SETTLE_TRANSITION_INVALID");
  });
});
