import { describe, expect, it } from "vitest";
import {
  OperationalStateReducer,
  ReducerSubmissionOperation,
  type DispatchFence,
  type SettleSubmissionDispatchInput,
} from "../src/core/operational-state-reducer";

function prepared(
  operationId: string,
  overrides: Partial<ReducerSubmissionOperation> = {},
): ReducerSubmissionOperation {
  return {
    operationId,
    logicalThreadId: "thread-1",
    providerConversationRef: "conversation-1",
    carrierRef: "tab-1",
    bindingGeneration: 1,
    leaseGeneration: 1,
    state: "PREPARED",
    ...overrides,
  };
}

function readyReducer() {
  const reducer = new OperationalStateReducer();
  const bound = reducer.commitCurrentConversationBinding({
    logicalThreadId: "thread-1",
    providerConversationRef: "conversation-1",
    expected: null,
    actor: "system",
    now: 1,
  });
  expect(bound.ok).toBe(true);
  const lease = reducer.transferActuationLease({
    logicalThreadId: "thread-1",
    providerConversationRef: "conversation-1",
    expectedBindingGeneration: 1,
    expectedLeaseGeneration: null,
    carrierRef: "tab-1",
    actor: "system",
    now: 10,
  });
  expect(lease.ok).toBe(true);
  return reducer;
}

describe("OperationalStateReducer", () => {
  it("commits a canonical binding and rejects reverse ownership", () => {
    const reducer = new OperationalStateReducer();
    expect(
      reducer.commitCurrentConversationBinding({
        logicalThreadId: "thread-1",
        providerConversationRef: "conversation-1",
        expected: null,
        actor: "system",
        now: 1,
      }).ok,
    ).toBe(true);
    const conflict = reducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-2",
      providerConversationRef: "conversation-1",
      expected: null,
      actor: "system",
      now: 1,
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe("BINDING_REVERSE_CONFLICT");
  });

  it("fences stale binding expectations and increments generation on rollover", () => {
    const reducer = new OperationalStateReducer();
    reducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      expected: null,
      actor: "system",
      now: 1,
    });
    const stale = reducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-2",
      expected: null,
      actor: "system",
      now: 1,
    });
    expect(stale.ok).toBe(false);
    const rolled = reducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-2",
      expected: {
        logicalThreadId: "thread-1",
        providerConversationRef: "conversation-1",
        generation: 1,
        mutationAt: 1,
      },
      actor: "system",
      now: 10,
    });
    expect(rolled.ok).toBe(true);
    if (rolled.ok) expect(rolled.value.generation).toBe(2);
  });

  it("treats a repeated commit for the current conversation as an idempotent no-op", () => {
    const reducer = readyReducer();
    const repeated = reducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      expected: {
        logicalThreadId: "thread-1",
        providerConversationRef: "conversation-1",
        generation: 1,
        mutationAt: 1,
      },
      actor: "system",
      now: 30,
    });
    expect(repeated.ok).toBe(true);
    if (repeated.ok) expect(repeated.value.generation).toBe(1);
    expect(reducer.getLease("thread-1")?.leaseGeneration).toBe(1);
  });

  it("rejects a rollover whose mutation time predates the current binding", () => {
    const reducer = new OperationalStateReducer();
    const initial = reducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      expected: null,
      actor: "system",
      now: 10,
    });
    expect(initial.ok).toBe(true);
    const stale = reducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-2",
      expected: {
        logicalThreadId: "thread-1",
        providerConversationRef: "conversation-1",
        generation: 1,
        mutationAt: 10,
      },
      actor: "system",
      now: 9,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("INVALID_MUTATION_INPUT");
  });

  it("transfers leases with an independent monotonic lease generation", () => {
    const reducer = readyReducer();
    const next = reducer.transferActuationLease({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      expectedBindingGeneration: 1,
      expectedLeaseGeneration: 1,
      carrierRef: "tab-2",
      actor: "human",
      now: 20,
    });
    expect(next.ok).toBe(true);
    if (next.ok) {
      expect(next.value.carrierRef).toBe("tab-2");
      expect(next.value.leaseGeneration).toBe(2);
    }
  });

  it("claims dispatch only with the current binding and lease fence", () => {
    const reducer = readyReducer();
    reducer.seedOperation(prepared("op-1"));
    const claimed = reducer.claimSubmissionDispatch({
      operationId: "op-1",
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
      carrierRef: "tab-1",
      actor: "human",
      now: 30,
    });
    expect(claimed.ok).toBe(true);
    if (claimed.ok) {
      expect(claimed.value.state).toBe("DISPATCHING");
      expect(claimed.value.dispatchFence?.leaseGeneration).toBe(1);
    }
    const replay = reducer.claimSubmissionDispatch({
      operationId: "op-1",
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
      carrierRef: "tab-1",
      actor: "human",
      now: 31,
    });
    expect(replay.ok).toBe(true);
  });

  it("blocks rollover and a second dispatch while execution is unresolved", () => {
    const reducer = readyReducer();
    reducer.seedOperation(prepared("op-1"));
    expect(
      reducer.claimSubmissionDispatch({
        operationId: "op-1",
        logicalThreadId: "thread-1",
        providerConversationRef: "conversation-1",
        bindingGeneration: 1,
        leaseGeneration: 1,
        carrierRef: "tab-1",
        actor: "human",
        now: 30,
      }).ok,
    ).toBe(true);
    reducer.seedOperation(prepared("op-2"));
    const second = reducer.claimSubmissionDispatch({
      operationId: "op-2",
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
      carrierRef: "tab-1",
      actor: "human",
      now: 31,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("DISPATCH_ALREADY_OWNED");
    const rollover = reducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-2",
      expected: {
        logicalThreadId: "thread-1",
        providerConversationRef: "conversation-1",
        generation: 1,
        mutationAt: 1,
      },
      actor: "system",
      now: 30,
    });
    expect(rollover.ok).toBe(false);
    if (!rollover.ok) expect(rollover.error.code).toBe("BINDING_BLOCKED_BY_EXECUTION");
  });

  it("rejects stale claims after a binding or lease fence changes", () => {
    const reducer = readyReducer();
    reducer.seedOperation(prepared("op-1"));
    const staleBinding = reducer.claimSubmissionDispatch({
      operationId: "op-1",
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-2",
      bindingGeneration: 2,
      leaseGeneration: 1,
      carrierRef: "tab-1",
      actor: "human",
      now: 30,
    });
    expect(staleBinding.ok).toBe(false);
    if (!staleBinding.ok) {
      expect(staleBinding.error.code).toBe(
        "DISPATCH_OPERATION_METADATA_MISMATCH",
      );
    }
    expect(
      reducer.transferActuationLease({
        logicalThreadId: "thread-1",
        providerConversationRef: "conversation-1",
        expectedBindingGeneration: 1,
        expectedLeaseGeneration: 1,
        carrierRef: "tab-2",
        actor: "system",
        now: 20,
      }).ok,
    ).toBe(true);
    const staleLease = reducer.claimSubmissionDispatch({
      operationId: "op-1",
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
      carrierRef: "tab-1",
      actor: "human",
      now: 30,
    });
    expect(staleLease.ok).toBe(false);
    if (!staleLease.ok) expect(staleLease.error.code).toBe("DISPATCH_LEASE_MISMATCH");
  });

  it("rejects a claim whose fence or target disagrees with operation metadata", () => {
    const reducer = readyReducer();
    reducer.seedOperation(prepared("op-1", { carrierRef: "tab-2" }));
    const result = reducer.claimSubmissionDispatch({
      operationId: "op-1",
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
      carrierRef: "tab-1",
      actor: "human",
      now: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DISPATCH_OPERATION_METADATA_MISMATCH");
    }
  });

  it("rejects invalid restored snapshots before they become reducer state", () => {
    const reducer = readyReducer();
    const snapshot = reducer.snapshot();
    snapshot.bindings["thread-2"] = {
      logicalThreadId: "thread-2",
      providerConversationRef: "conversation-1",
      generation: 1,
      mutationAt: 1,
    };
    expect(() => reducer.replace(snapshot)).toThrow(
      "INVALID_STATE_SNAPSHOT",
    );
    const aliasSnapshot = reducer.snapshot();
    delete aliasSnapshot.bindings["thread-1"];
    aliasSnapshot.bindings.alias = {
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-2",
      generation: 1,
      mutationAt: 1,
    };
    expect(() => reducer.replace(aliasSnapshot)).toThrow(
      "INVALID_STATE_SNAPSHOT",
    );
    const reservedSnapshot = reducer.snapshot();
    reservedSnapshot.bindings["__proto__"] = {
      logicalThreadId: "__proto__",
      providerConversationRef: "conversation-2",
      generation: 1,
      mutationAt: 1,
    };
    expect(() => reducer.replace(reservedSnapshot)).toThrow(
      "INVALID_STATE_SNAPSHOT",
    );

    const operation = prepared("op-1");
    const invalidLeaseSnapshot = reducer.snapshot();
    invalidLeaseSnapshot.leases["thread-1"] = {
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      carrierRef: "tab-1",
      bindingGeneration: 99,
      leaseGeneration: 1,
      claimedAt: 1,
      claimedBy: "system",
    };
    expect(() => new OperationalStateReducer(invalidLeaseSnapshot)).toThrow(
      "INVALID_STATE_SNAPSHOT",
    );

    const staleLeaseTime = reducer.snapshot();
    staleLeaseTime.leases["thread-1"].claimedAt = 0;
    expect(() => reducer.replace(staleLeaseTime)).toThrow(
      "INVALID_STATE_SNAPSHOT",
    );

    const invalidExecutionSnapshot = reducer.snapshot();
    invalidExecutionSnapshot.operations[operation.operationId] = {
      ...operation,
      state: "DISPATCHING",
      carrierRef: "tab-2",
      dispatchFence: {
        providerConversationRef: "conversation-1",
        carrierRef: "tab-1",
        bindingGeneration: 1,
        leaseGeneration: 1,
      },
    };
    expect(() => reducer.replace(invalidExecutionSnapshot)).toThrow(
      "INVALID_STATE_SNAPSHOT",
    );
  });

  it("applies the same snapshot invariants to seedOperation", () => {
    const reducer = readyReducer();
    expect(() =>
      reducer.seedOperation({
        ...prepared("op-1"),
        state: "DISPATCHING",
        dispatchFence: {
          providerConversationRef: "conversation-1",
          carrierRef: "tab-2",
          bindingGeneration: 1,
          leaseGeneration: 1,
        },
      }),
    ).toThrow("INVALID_STATE_SNAPSHOT");
  });

  it("does not overwrite an existing operation during idempotent restore", () => {
    const reducer = readyReducer();
    const operation = prepared("op-1");
    reducer.seedOperation(operation);
    reducer.seedOperation({ ...operation });
    expect(() =>
      reducer.seedOperation({ ...operation, carrierRef: "tab-2" }),
    ).toThrow("OPERATION_REUSE_CONFLICT");
  });

  it("rejects generation, state, and time regressions in restored snapshots", () => {
    const reducer = readyReducer();
    const badGeneration = reducer.snapshot();
    badGeneration.bindings["thread-1"].generation = 0;
    expect(() => reducer.replace(badGeneration)).toThrow(
      "INVALID_STATE_SNAPSHOT",
    );

    const badState = reducer.snapshot();
    badState.operations["op-1"] = {
      ...prepared("op-1"),
      state: "UNKNOWN" as never,
    };
    expect(() => reducer.replace(badState)).toThrow("INVALID_STATE_SNAPSHOT");

    const badFence = reducer.snapshot();
    badFence.lastMutationAt = 20;
    badFence.operations["op-1"] = {
      ...prepared("op-1"),
      state: "DISPATCHING",
      dispatchClaimedAt: 20,
      dispatchFence: {
        providerConversationRef: "conversation-1",
        carrierRef: "tab-1",
        bindingGeneration: 1,
        leaseGeneration: 1,
      },
    };
    expect(() => reducer.replace(badFence)).not.toThrow();
    const staleDispatchTime = reducer.snapshot();
    staleDispatchTime.operations["op-1"] = {
      ...badFence.operations["op-1"],
      dispatchClaimedAt: 0,
    };
    expect(() => reducer.replace(staleDispatchTime)).toThrow(
      "INVALID_STATE_SNAPSHOT",
    );
    const timeReducer = readyReducer();
    expect(
      timeReducer.transferActuationLease({
        logicalThreadId: "thread-1",
        providerConversationRef: "conversation-1",
        expectedBindingGeneration: 1,
        expectedLeaseGeneration: 1,
        carrierRef: "tab-2",
        actor: "system",
        now: 9,
      }).ok,
    ).toBe(false);
    const timeResult = timeReducer.transferActuationLease({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      expectedBindingGeneration: 1,
      expectedLeaseGeneration: 1,
      carrierRef: "tab-2",
      actor: "system",
      now: 9,
    });
    if (!timeResult.ok) {
      expect(timeResult.error.code).toBe("INVALID_MUTATION_INPUT");
    }
  });

  it("records mutation actors in the reducer snapshot for audit", () => {
    const reducer = new OperationalStateReducer();
    reducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      expected: null,
      actor: "human",
      now: 1,
    });
    expect(reducer.snapshot().lastMutationActor).toBe("human");
  });

  it("fails closed on invalid mutation inputs and prevents time regression", () => {
    const reducer = new OperationalStateReducer();
    const invalidActor = reducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      expected: null,
      actor: "unknown" as never,
      now: 1,
    });
    expect(invalidActor.ok).toBe(false);
    if (!invalidActor.ok) {
      expect(invalidActor.error.code).toBe("INVALID_MUTATION_INPUT");
    }
    const invalidNow = reducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      expected: null,
      actor: "system",
      now: Number.NaN,
    });
    expect(invalidNow.ok).toBe(false);

    const firstLeaseReducer = new OperationalStateReducer();
    firstLeaseReducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      expected: null,
      actor: "system",
      now: 1,
    });
    const invalidFirstLease = firstLeaseReducer.transferActuationLease({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      expectedBindingGeneration: 1,
      expectedLeaseGeneration: null,
      carrierRef: "tab-1",
      actor: "system",
      now: Number.POSITIVE_INFINITY,
    });
    expect(invalidFirstLease.ok).toBe(false);

    const ready = readyReducer();
    ready.seedOperation(prepared("op-1"));
    const tooEarly = ready.claimSubmissionDispatch({
      operationId: "op-1",
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
      carrierRef: "tab-1",
      actor: "human",
      now: 9,
    });
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.error.code).toBe("INVALID_MUTATION_INPUT");
    const claimed = ready.claimSubmissionDispatch({
      operationId: "op-1",
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
      carrierRef: "tab-1",
      actor: "human",
      now: 10,
    });
    expect(claimed.ok).toBe(true);
    const replay = ready.claimSubmissionDispatch({
      operationId: "op-1",
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
      carrierRef: "tab-1",
      actor: "human",
      now: 9,
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error.code).toBe("INVALID_MUTATION_INPUT");
  });

  it("uses one global mutation time fence across logical threads", () => {
    const reducer = new OperationalStateReducer();
    const first = reducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      expected: null,
      actor: "system",
      now: 10,
    });
    expect(first.ok).toBe(true);
    const second = reducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-2",
      providerConversationRef: "conversation-2",
      expected: null,
      actor: "system",
      now: 9,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("INVALID_MUTATION_INPUT");
  });

  it("rejects restoring a snapshot that moves the current clock backwards", () => {
    const reducer = readyReducer();
    const older = reducer.snapshot();
    older.lastMutationAt = 9;
    older.bindings["thread-1"].mutationAt = 9;
    older.leases["thread-1"].claimedAt = 9;
    expect(() => reducer.replace(older)).toThrow(
      "replacement snapshot would move the mutation clock backwards",
    );
    const missing = reducer.snapshot();
    delete missing.lastMutationAt;
    missing.bindings = Object.create(null);
    missing.leases = Object.create(null);
    expect(() => reducer.replace(missing)).toThrow(
      "replacement snapshot would move the mutation clock backwards",
    );
    const same = reducer.snapshot();
    expect(() => reducer.replace(same)).not.toThrow();
  });

  it("rejects local entity timestamps moving backwards under a newer global clock", () => {
    const reducer = readyReducer();
    const bindingRollback = reducer.snapshot();
    bindingRollback.bindings["thread-1"].mutationAt = 0;
    expect(() => reducer.replace(bindingRollback)).toThrow(
      "binding thread-1 mutation time moved backwards",
    );

    const leaseRollback = reducer.snapshot();
    leaseRollback.leases["thread-1"].claimedAt = 5;
    expect(() => reducer.replace(leaseRollback)).toThrow(
      "lease thread-1 claim time moved backwards",
    );

    reducer.seedOperation(prepared("op-1"));
    const claimed = reducer.claimSubmissionDispatch({
      operationId: "op-1",
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
      carrierRef: "tab-1",
      actor: "human",
      now: 20,
    });
    expect(claimed.ok).toBe(true);
    const operationRollback = reducer.snapshot();
    operationRollback.operations["op-1"].dispatchClaimedAt = 15;
    expect(() => reducer.replace(operationRollback)).toThrow(
      "operation op-1 dispatch time moved backwards",
    );
  });

  it("rejects operation lifecycle rollback during restore", () => {
    const reducer = readyReducer();
    reducer.seedOperation(prepared("op-1"));
    const claimed = reducer.claimSubmissionDispatch({
      operationId: "op-1",
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
      carrierRef: "tab-1",
      actor: "human",
      now: 10,
    });
    expect(claimed.ok).toBe(true);
    const observed = reducer.snapshot();
    observed.operations["op-1"].state = "OBSERVED_ACCEPTED";
    reducer.replace(observed);
    const completed = reducer.snapshot();
    completed.operations["op-1"].state = "COMPLETED";
    reducer.replace(completed);
    const rollback = reducer.snapshot();
    rollback.operations["op-1"].state = "DISPATCHING";
    expect(() => reducer.replace(rollback)).toThrow(
      "lifecycle cannot move from COMPLETED to DISPATCHING",
    );
  });

  it("rejects changing immutable operation identity during restore", () => {
    const reducer = readyReducer();
    reducer.seedOperation(prepared("op-1", { requestFingerprint: "request-a" }));
    const changed = reducer.snapshot();
    changed.operations["op-1"].carrierRef = "tab-2";
    expect(() => reducer.replace(changed)).toThrow(
      "operation op-1 identity metadata changed",
    );

    const changedFingerprint = reducer.snapshot();
    changedFingerprint.operations["op-1"].requestFingerprint = "request-b";
    expect(() => reducer.replace(changedFingerprint)).toThrow(
      "operation op-1 identity metadata changed",
    );
  });

  it("rejects binding and lease generation rollback or deletion during restore", () => {
    const bindingReducer = new OperationalStateReducer();
    bindingReducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      expected: null,
      actor: "system",
      now: 1,
    });
    const rolledBinding = bindingReducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-2",
      expected: {
        logicalThreadId: "thread-1",
        providerConversationRef: "conversation-1",
        generation: 1,
        mutationAt: 1,
      },
      actor: "system",
      now: 2,
    });
    expect(rolledBinding.ok).toBe(true);
    const bindingRollback = bindingReducer.snapshot();
    bindingRollback.bindings["thread-1"].generation = 1;
    bindingRollback.bindings["thread-1"].providerConversationRef =
      "conversation-2";
    expect(() => bindingReducer.replace(bindingRollback)).toThrow(
      "binding thread-1 generation moved backwards",
    );
    const bindingDelete = bindingReducer.snapshot();
    delete bindingDelete.bindings["thread-1"];
    expect(() => bindingReducer.replace(bindingDelete)).toThrow(
      "binding thread-1 cannot be removed",
    );

    const leaseReducer = readyReducer();
    expect(
      leaseReducer.transferActuationLease({
        logicalThreadId: "thread-1",
        providerConversationRef: "conversation-1",
        expectedBindingGeneration: 1,
        expectedLeaseGeneration: 1,
        carrierRef: "tab-2",
        actor: "human",
        now: 20,
      }).ok,
    ).toBe(true);
    const leaseRollback = leaseReducer.snapshot();
    leaseRollback.leases["thread-1"].leaseGeneration = 1;
    expect(() => leaseReducer.replace(leaseRollback)).toThrow(
      "lease thread-1 generation moved backwards",
    );
    const leaseDelete = leaseReducer.snapshot();
    delete leaseDelete.leases["thread-1"];
    expect(() => leaseReducer.replace(leaseDelete)).toThrow(
      "lease thread-1 cannot be removed",
    );
  });

  it("rejects authority identity changes when the generation is unchanged", () => {
    const bindingReducer = new OperationalStateReducer();
    bindingReducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      expected: null,
      actor: "system",
      now: 1,
    });
    const bindingIdentityChange = bindingReducer.snapshot();
    bindingIdentityChange.bindings["thread-1"].providerConversationRef =
      "conversation-2";
    expect(() => bindingReducer.replace(bindingIdentityChange)).toThrow(
      "binding thread-1 identity changed without generation advance",
    );

    const leaseReducer = readyReducer();
    const carrierChange = leaseReducer.snapshot();
    carrierChange.leases["thread-1"].carrierRef = "tab-2";
    expect(() => leaseReducer.replace(carrierChange)).toThrow(
      "lease thread-1 identity changed without generation advance",
    );
    const actorChange = leaseReducer.snapshot();
    actorChange.leases["thread-1"].claimedBy = "human";
    expect(() => leaseReducer.replace(actorChange)).toThrow(
      "lease thread-1 identity changed without generation advance",
    );
  });

  it("allows authority identity changes only with a generation advance", () => {
    const bindingReducer = new OperationalStateReducer();
    bindingReducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      expected: null,
      actor: "system",
      now: 1,
    });
    const bindingAdvance = bindingReducer.snapshot();
    bindingAdvance.bindings["thread-1"] = {
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-2",
      generation: 2,
      mutationAt: 2,
    };
    bindingAdvance.lastMutationAt = 2;
    expect(() => bindingReducer.replace(bindingAdvance)).not.toThrow();

    const leaseReducer = readyReducer();
    const leaseAdvance = leaseReducer.snapshot();
    leaseAdvance.bindings["thread-1"] = {
      ...leaseAdvance.bindings["thread-1"],
      providerConversationRef: "conversation-2",
      generation: 2,
      mutationAt: 20,
    };
    leaseAdvance.leases["thread-1"] = {
      ...leaseAdvance.leases["thread-1"],
      providerConversationRef: "conversation-2",
      carrierRef: "tab-2",
      bindingGeneration: 2,
      leaseGeneration: 2,
      claimedAt: 20,
      claimedBy: "human",
    };
    leaseAdvance.lastMutationAt = 20;
    expect(() => leaseReducer.replace(leaseAdvance)).not.toThrow();
  });

  it("requires lease generation to advance with a binding generation change", () => {
    const reducer = readyReducer();
    const drift = reducer.snapshot();
    drift.bindings["thread-1"] = {
      ...drift.bindings["thread-1"],
      providerConversationRef: "conversation-2",
      generation: 2,
      mutationAt: 20,
    };
    drift.leases["thread-1"] = {
      ...drift.leases["thread-1"],
      providerConversationRef: "conversation-2",
      bindingGeneration: 2,
      claimedAt: 20,
    };
    drift.lastMutationAt = 20;
    expect(() => reducer.replace(drift)).toThrow(
      "lease thread-1 generation must advance with binding",
    );
  });

  it("allows one strictly fenced PREPARED to DISPATCHING restore", () => {
    const reducer = readyReducer();
    reducer.seedOperation(prepared("op-1"));
    const claimed = reducer.snapshot();
    claimed.operations["op-1"].state = "DISPATCHING";
    claimed.operations["op-1"].dispatchClaimedAt = 10;
    claimed.operations["op-1"].dispatchFence = {
      providerConversationRef: "conversation-1",
      carrierRef: "tab-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
    };
    expect(() => reducer.replace(claimed)).not.toThrow();
  });

  it("rejects restoring a fence into an existing operation", () => {
    const reducer = readyReducer();
    reducer.seedOperation(prepared("op-1"));
    const injected = reducer.snapshot();
    injected.operations["op-1"].state = "CANCELLED";
    injected.operations["op-1"].dispatchFence = {
      providerConversationRef: "conversation-1",
      carrierRef: "tab-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
    };
    expect(() => reducer.replace(injected)).toThrow(
      "dispatch fence presence changed",
    );
  });

  it("does not restore an observed operation back to uncertain", () => {
    const reducer = readyReducer();
    reducer.seedOperation(prepared("op-1"));
    expect(
      reducer.claimSubmissionDispatch({
        operationId: "op-1",
        logicalThreadId: "thread-1",
        providerConversationRef: "conversation-1",
        bindingGeneration: 1,
        leaseGeneration: 1,
        carrierRef: "tab-1",
        actor: "human",
        now: 10,
      }).ok,
    ).toBe(true);
    const observed = reducer.snapshot();
    observed.operations["op-1"].state = "OBSERVED_ACCEPTED";
    reducer.replace(observed);
    const uncertain = reducer.snapshot();
    uncertain.operations["op-1"].state = "UNCERTAIN";
    expect(() => reducer.replace(uncertain)).toThrow(
      "lifecycle cannot move from OBSERVED_ACCEPTED to UNCERTAIN",
    );
  });

  it("replays the same fence idempotently after observed or uncertain states", () => {
    for (const state of ["OBSERVED_ACCEPTED", "UNCERTAIN"] as const) {
      const reducer = readyReducer();
      reducer.seedOperation(prepared("op-1"));
      const claimed = reducer.claimSubmissionDispatch({
        operationId: "op-1",
        logicalThreadId: "thread-1",
        providerConversationRef: "conversation-1",
        bindingGeneration: 1,
        leaseGeneration: 1,
        carrierRef: "tab-1",
        actor: "human",
        now: 10,
      });
      expect(claimed.ok).toBe(true);
      const snapshot = reducer.snapshot();
      snapshot.operations["op-1"].state = state;
      reducer.replace(snapshot);
      const replay = reducer.claimSubmissionDispatch({
        operationId: "op-1",
        logicalThreadId: "thread-1",
        providerConversationRef: "conversation-1",
        bindingGeneration: 1,
        leaseGeneration: 1,
        carrierRef: "tab-1",
        actor: "human",
        now: 10,
      });
      expect(replay.ok).toBe(true);
      if (replay.ok) expect(replay.value.state).toBe(state);
    }
  });

  it("settles a claimed dispatch from evidence through the lifecycle", () => {
    const reducer = readyReducer();
    reducer.seedOperation(prepared("op-1"));
    const claim = reducer.claimSubmissionDispatch({
      operationId: "op-1",
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
      carrierRef: "tab-1",
      actor: "human",
      now: 30,
    });
    expect(claim.ok).toBe(true);
    const fence: DispatchFence = {
      providerConversationRef: "conversation-1",
      carrierRef: "tab-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
    };
    const settle = (overrides: Partial<SettleSubmissionDispatchInput> = {}) =>
      reducer.settleSubmissionDispatch({
        operationId: "op-1",
        expectedCurrentState: "DISPATCHING",
        expectedDispatchFence: fence,
        targetState: "OBSERVED_ACCEPTED",
        executionEvidenceRef: "journal-entry-1",
        reason: "provider acceptance observed",
        actor: "worker",
        now: 40,
        ...overrides,
      });
    const observed = settle();
    expect(observed.ok).toBe(true);
    if (observed.ok) expect(observed.value.state).toBe("OBSERVED_ACCEPTED");

    // Idempotent replay on the settled state returns success without moving;
    // the expectation must name the actual current state.
    const replay = settle({ expectedCurrentState: "OBSERVED_ACCEPTED", now: 41 });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.value.state).toBe("OBSERVED_ACCEPTED");

    // A replay that names the pre-settlement state fails closed.
    const staleReplay = settle({ now: 42 });
    expect(staleReplay.ok).toBe(false);
    if (!staleReplay.ok) expect(staleReplay.error.code).toBe("SETTLE_STATE_MISMATCH");

    // A settled execution owner still blocks binding rollover...
    const rollover = reducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-2",
      expected: {
        logicalThreadId: "thread-1",
        providerConversationRef: "conversation-1",
        generation: 1,
        mutationAt: 1,
      },
      actor: "system",
      now: 42,
    });
    expect(rollover.ok).toBe(false);
    if (!rollover.ok) expect(rollover.error.code).toBe("BINDING_BLOCKED_BY_EXECUTION");

    // ...until COMPLETED releases execution ownership.
    const completed = reducer.settleSubmissionDispatch({
      operationId: "op-1",
      expectedCurrentState: "OBSERVED_ACCEPTED",
      expectedDispatchFence: fence,
      targetState: "COMPLETED",
      executionEvidenceRef: "journal-entry-2",
      reason: "parent turn completed",
      actor: "worker",
      now: 50,
    });
    expect(completed.ok).toBe(true);
    const afterCompletion = reducer.commitCurrentConversationBinding({
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-2",
      expected: {
        logicalThreadId: "thread-1",
        providerConversationRef: "conversation-1",
        generation: 1,
        mutationAt: 1,
      },
      actor: "system",
      now: 60,
    });
    expect(afterCompletion.ok).toBe(true);
  });

  it("fails settlement closed on state, fence, transition, and evidence mismatches", () => {
    const reducer = readyReducer();
    reducer.seedOperation(prepared("op-1"));
    reducer.claimSubmissionDispatch({
      operationId: "op-1",
      logicalThreadId: "thread-1",
      providerConversationRef: "conversation-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
      carrierRef: "tab-1",
      actor: "human",
      now: 30,
    });
    const fence: DispatchFence = {
      providerConversationRef: "conversation-1",
      carrierRef: "tab-1",
      bindingGeneration: 1,
      leaseGeneration: 1,
    };

    const staleState = reducer.settleSubmissionDispatch({
      operationId: "op-1",
      expectedCurrentState: "PREPARED",
      expectedDispatchFence: fence,
      targetState: "OBSERVED_ACCEPTED",
      executionEvidenceRef: "journal-entry-1",
      reason: "settlement audit",
      actor: "worker",
      now: 40,
    });
    expect(staleState.ok).toBe(false);
    if (!staleState.ok) expect(staleState.error.code).toBe("SETTLE_STATE_MISMATCH");
    // Failed settlements must leave the authority fence untouched.
    expect(reducer.snapshot().lastMutationAt).toBe(30);
    expect(reducer.snapshot().lastMutationActor).toBe("human");
    const emptyReason = reducer.settleSubmissionDispatch({
      operationId: "op-1",
      expectedCurrentState: "DISPATCHING",
      expectedDispatchFence: fence,
      targetState: "OBSERVED_ACCEPTED",
      executionEvidenceRef: "journal-entry-1",
      reason: "   ",
      actor: "worker",
      now: 40,
    });
    expect(emptyReason.ok).toBe(false);
    if (!emptyReason.ok) expect(emptyReason.error.code).toBe("INVALID_MUTATION_INPUT");
    expect(reducer.snapshot().lastMutationAt).toBe(30);

    const staleFence = reducer.settleSubmissionDispatch({
      operationId: "op-1",
      expectedCurrentState: "DISPATCHING",
      expectedDispatchFence: { ...fence, leaseGeneration: 2 },
      targetState: "OBSERVED_ACCEPTED",
      executionEvidenceRef: "journal-entry-1",
      reason: "settlement audit",
      actor: "worker",
      now: 40,
    });
    expect(staleFence.ok).toBe(false);
    if (!staleFence.ok) expect(staleFence.error.code).toBe("SETTLE_FENCE_MISMATCH");

    const illegal = reducer.settleSubmissionDispatch({
      operationId: "op-1",
      expectedCurrentState: "DISPATCHING",
      expectedDispatchFence: fence,
      targetState: "COMPLETED",
      executionEvidenceRef: "journal-entry-1",
      reason: "settlement audit",
      actor: "worker",
      now: 40,
    });
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.error.code).toBe("SETTLE_TRANSITION_INVALID");

    const noEvidence = reducer.settleSubmissionDispatch({
      operationId: "op-1",
      expectedCurrentState: "DISPATCHING",
      expectedDispatchFence: fence,
      targetState: "OBSERVED_ACCEPTED",
      executionEvidenceRef: "  ",
      reason: "settlement audit",
      actor: "worker",
      now: 40,
    });
    expect(noEvidence.ok).toBe(false);
    if (!noEvidence.ok) expect(noEvidence.error.code).toBe("INVALID_MUTATION_INPUT");

    const beforeClaim = reducer.settleSubmissionDispatch({
      operationId: "op-1",
      expectedCurrentState: "DISPATCHING",
      expectedDispatchFence: fence,
      targetState: "OBSERVED_ACCEPTED",
      executionEvidenceRef: "journal-entry-1",
      reason: "settlement audit",
      actor: "worker",
      now: 29,
    });
    expect(beforeClaim.ok).toBe(false);
    if (!beforeClaim.ok) expect(beforeClaim.error.code).toBe("INVALID_MUTATION_INPUT");

    const unknown = reducer.settleSubmissionDispatch({
      operationId: "op-x",
      expectedCurrentState: "DISPATCHING",
      expectedDispatchFence: fence,
      targetState: "OBSERVED_ACCEPTED",
      executionEvidenceRef: "journal-entry-1",
      reason: "settlement audit",
      actor: "worker",
      now: 40,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("OPERATION_NOT_FOUND");

    // Terminal states are irreversible even with a matching expectation.
    reducer.settleSubmissionDispatch({
      operationId: "op-1",
      expectedCurrentState: "DISPATCHING",
      expectedDispatchFence: fence,
      targetState: "OBSERVED_ACCEPTED",
      executionEvidenceRef: "journal-entry-1",
      reason: "settlement audit",
      actor: "worker",
      now: 40,
    });
    reducer.settleSubmissionDispatch({
      operationId: "op-1",
      expectedCurrentState: "OBSERVED_ACCEPTED",
      expectedDispatchFence: fence,
      targetState: "COMPLETED",
      executionEvidenceRef: "journal-entry-2",
      reason: "parent turn completed",
      actor: "worker",
      now: 50,
    });
    const reopen = reducer.settleSubmissionDispatch({
      operationId: "op-1",
      expectedCurrentState: "COMPLETED",
      expectedDispatchFence: fence,
      targetState: "OBSERVED_ACCEPTED",
      executionEvidenceRef: "journal-entry-3",
      reason: "reopen attempt must fail",
      actor: "worker",
      now: 60,
    });
    expect(reopen.ok).toBe(false);
    if (!reopen.ok) expect(reopen.error.code).toBe("SETTLE_TRANSITION_INVALID");
  });
});
