import { describe, expect, it } from "vitest";
import {
  applyRunEvent,
  BCR_ALLOWED_BUDGETS,
  BCR_EXPERIMENTAL_MAX_BUDGET,
  canDispatch,
  createFixtureCandidate,
  emptyContinuationRunStore,
  isTerminal,
  reduceContinuationRunStore,
  startContinuationRun,
  type ContinuationRun,
  type ContinuationRunEvent
} from "../src/core/continuation-run";

function run(overrides: Partial<ContinuationRun> = {}): ContinuationRun {
  return {
    runId: "bcr-test",
    workItemId: "shuttle-bcr-run",
    logicalThreadId: "thread:conv-a",
    providerConversationRef: "conv-a",
    bindingEpoch: 3,
    mode: "ASSISTED",
    maxContinuations: 5,
    consumedContinuations: 0,
    status: "ACTIVE",
    phase: "READY_TO_GO",
    createdAt: 100,
    updatedAt: 100,
    ...overrides
  };
}

function dispatchRound(current: ContinuationRun, round: number): ContinuationRun {
  const operationId = `${current.runId}:go:${round}`;
  let next = applyRunEvent(current, { type: "DISPATCH_ISSUED", operationId }, 100 + round).run;
  next = applyRunEvent(next, { type: "CARRIER_PHASE", carrierState: "GENERATING" }, 100 + round).run;
  next = applyRunEvent(next, { type: "OPERATION_ACCEPTED", operationId, turnRef: `turn:t${round}` }, 100 + round).run;
  next = applyRunEvent(next, { type: "OPERATION_COMPLETED", operationId, turnRef: `turn:t${round}` }, 100 + round).run;
  return next;
}

describe("startContinuationRun", () => {
  it("creates an ACTIVE assisted run pinned to the conversation binding", () => {
    const started = startContinuationRun({ runId: "bcr-1", workItemId: "w", logicalThreadId: "t", providerConversationRef: "conv-a", bindingEpoch: 7, maxContinuations: 5, now: 100 });
    expect(started.status).toBe("ACTIVE");
    expect(started.phase).toBe("READY_TO_GO");
    expect(started.mode).toBe("ASSISTED");
    expect(started.bindingEpoch).toBe(7);
    expect(started.consumedContinuations).toBe(0);
  });

  it("rejects invalid budgets and identity", () => {
    const base = { runId: "bcr-1", workItemId: "w", logicalThreadId: "t", providerConversationRef: "conv-a", bindingEpoch: 1, now: 1 };
    expect(() => startContinuationRun({ ...base, maxContinuations: 3 })).toThrow(/maxContinuations/);
    expect(() => startContinuationRun({ ...base, maxContinuations: 0 })).toThrow(/maxContinuations/);
    expect(() => startContinuationRun({ ...base, maxContinuations: 50 })).toThrow(/expected one of 1 \| 5 \| 10 \| 20/);
    expect(() => startContinuationRun({ ...base, maxContinuations: 5, runId: " " })).toThrow(/runId/);
    expect(() => startContinuationRun({ ...base, maxContinuations: 5, providerConversationRef: "" })).toThrow(/providerConversationRef/);
    expect(BCR_EXPERIMENTAL_MAX_BUDGET).toBe(20);
    expect(BCR_ALLOWED_BUDGETS).toEqual([1, 5, 10, 20]);
    expect(startContinuationRun({ ...base, maxContinuations: 20 }).maxContinuations).toBe(20);
  });
});

describe("canDispatch", () => {
  it("requires ACTIVE, READY_TO_GO, no pending op, remaining budget, unchanged conversation and binding", () => {
    expect(canDispatch(run(), { providerConversationRef: "conv-a", bindingEpoch: 3 })).toEqual({ ok: true });
    expect(canDispatch(run({ status: "CANCELLED" }), { providerConversationRef: "conv-a", bindingEpoch: 3 }).ok).toBe(false);
    expect(canDispatch(run({ phase: "ASSISTANT_GENERATING" }), { providerConversationRef: "conv-a", bindingEpoch: 3 }).ok).toBe(false);
    expect(canDispatch(run({ pendingSubmissionOperationId: "op-1" }), { providerConversationRef: "conv-a", bindingEpoch: 3 }).ok).toBe(false);
    expect(canDispatch(run({ consumedContinuations: 5 }), { providerConversationRef: "conv-a", bindingEpoch: 3 }).ok).toBe(false);
    expect(canDispatch(run(), { providerConversationRef: "conv-b", bindingEpoch: 3 }).ok).toBe(false);
    expect(canDispatch(run(), { providerConversationRef: "conv-a", bindingEpoch: 4 }).ok).toBe(false);
  });
});

describe("applyRunEvent — full assisted budget lifecycle", () => {
  it("runs five governed rounds then ends BUDGET_EXHAUSTED with the final turn consumed", () => {
    let current = run({ maxContinuations: 5 });
    for (let roundIndex = 1; roundIndex <= 5; roundIndex += 1) {
      expect(current.phase).toBe("READY_TO_GO");
      current = dispatchRound(current, roundIndex);
      if (roundIndex < 5) {
        expect(current.phase).toBe("AWAITING_HUMAN_DECISION");
        expect(current.consumedContinuations).toBe(roundIndex);
        const continued = applyRunEvent(current, { type: "HUMAN_CONTINUE" }, 200 + roundIndex);
        expect(continued.changed).toBe(true);
        current = continued.run;
        expect(current.phase).toBe("READY_TO_GO");
      }
    }
    expect(current.status).toBe("ENDED");
    expect(current.phase).toBe("ENDED");
    expect(current.stopReason).toBe("BUDGET_EXHAUSTED");
    expect(current.consumedContinuations).toBe(5);
    expect(current.lastConsumedTurnRef).toBe("turn:t5");
    expect(current.pendingSubmissionOperationId).toBeUndefined();
  });

  it("tracks phases through generating and stabilizing", () => {
    const dispatched = applyRunEvent(run(), { type: "DISPATCH_ISSUED", operationId: "op-1" }, 101);
    expect(dispatched.run.phase).toBe("ASSISTANT_GENERATING");
    expect(dispatched.run.pendingSubmissionOperationId).toBe("op-1");
    const stabilizing = applyRunEvent(dispatched.run, { type: "CARRIER_PHASE", carrierState: "STABILIZING" }, 102);
    expect(stabilizing.run.phase).toBe("STABILIZING");
  });

  it("consumes budget exactly once per accepted operation and stamps the turn ref", () => {
    const dispatched = applyRunEvent(run(), { type: "DISPATCH_ISSUED", operationId: "op-1" }, 101).run;
    const accepted = applyRunEvent(dispatched, { type: "OPERATION_ACCEPTED", operationId: "op-1", turnRef: "turn:a" }, 102);
    expect(accepted.run.consumedContinuations).toBe(1);
    expect(accepted.run.acceptedOperationId).toBe("op-1");
    const replayed = applyRunEvent(accepted.run, { type: "OPERATION_ACCEPTED", operationId: "op-1", turnRef: "turn:a" }, 103);
    expect(replayed.changed).toBe(false);
    expect(replayed.run.consumedContinuations).toBe(1);
  });

  it("backfills acceptance on COMPLETED so budget stays exactly-once if ACCEPT was lost", () => {
    const dispatched = applyRunEvent(run({ maxContinuations: 1 }), { type: "DISPATCH_ISSUED", operationId: "op-1" }, 101).run;
    // ACCEPT event lost (e.g. worker restart between the two reconciles):
    const completed = applyRunEvent(dispatched, { type: "OPERATION_COMPLETED", operationId: "op-1", turnRef: "turn:a" }, 102);
    expect(completed.run.consumedContinuations).toBe(1);
    expect(completed.run.acceptedOperationId).toBe("op-1");
    expect(completed.run.status).toBe("ENDED");
    expect(completed.run.stopReason).toBe("BUDGET_EXHAUSTED");
  });

  it("converges a completion exactly once when the same event is offered again", () => {
    // M2 crash window: the durable operation already completed, so every later
    // recovery tick can offer the same OPERATION_COMPLETED until the Run applies
    // it. The second offer must be a no-op, not a second consumed round.
    const dispatched = applyRunEvent(run({ mode: "AUTO_X5" }), { type: "DISPATCH_ISSUED", operationId: "op-1" }, 101).run;
    const completed = applyRunEvent(dispatched, { type: "OPERATION_COMPLETED", operationId: "op-1", turnRef: "turn:a" }, 102);
    expect(completed.run.pendingSubmissionOperationId).toBeUndefined();
    expect(completed.run.phase).toBe("EVALUATING");
    expect(completed.run.consumedContinuations).toBe(1);
    const replayed = applyRunEvent(completed.run, { type: "OPERATION_COMPLETED", operationId: "op-1", turnRef: "turn:a" }, 103);
    expect(replayed.changed).toBe(false);
    expect(replayed.error).toMatch(/non-pending operation/);
    expect(replayed.run.consumedContinuations).toBe(1);
    expect(replayed.run.acceptedOperationId).toBe("op-1");
    expect(replayed.run.phase).toBe("EVALUATING");
  });

  it("keeps the round consumed once across ACCEPT, COMPLETED, and a replayed COMPLETED", () => {
    const dispatched = applyRunEvent(run({ mode: "AUTO_X5" }), { type: "DISPATCH_ISSUED", operationId: "op-1" }, 101).run;
    const accepted = applyRunEvent(dispatched, { type: "OPERATION_ACCEPTED", operationId: "op-1", turnRef: "turn:a" }, 102).run;
    const completed = applyRunEvent(accepted, { type: "OPERATION_COMPLETED", operationId: "op-1", turnRef: "turn:a" }, 103).run;
    const replayed = applyRunEvent(completed, { type: "OPERATION_COMPLETED", operationId: "op-1", turnRef: "turn:b" }, 104);
    expect(replayed.changed).toBe(false);
    expect(replayed.run.consumedContinuations).toBe(1);
    // The refused replay must not restamp the turn the round actually consumed.
    expect(replayed.run.lastConsumedTurnRef).toBe("turn:a");
  });
});

describe("applyRunEvent — fail-closed paths", () => {
  it("never allows a second in-flight submission (MAX_IN_FLIGHT = 1)", () => {
    const dispatched = applyRunEvent(run(), { type: "DISPATCH_ISSUED", operationId: "op-1" }, 101).run;
    const second = applyRunEvent(dispatched, { type: "DISPATCH_ISSUED", operationId: "op-2" }, 102);
    expect(second.changed).toBe(false);
    // The phase gate fires first; the pending gate guards the same invariant.
    expect(second.error).toMatch(/ASSISTANT_GENERATING|pending submission/);
    expect(second.run.pendingSubmissionOperationId).toBe("op-1");
  });

  it("ends FAILED_SAFE on submission uncertainty and never re-arms", () => {
    const dispatched = applyRunEvent(run(), { type: "DISPATCH_ISSUED", operationId: "op-1" }, 101).run;
    const uncertain = applyRunEvent(dispatched, { type: "OPERATION_UNCERTAIN", operationId: "op-1" }, 102);
    expect(uncertain.run.status).toBe("FAILED_SAFE");
    expect(uncertain.run.stopReason).toBe("SUBMISSION_UNCERTAIN");
    const retry = applyRunEvent(uncertain.run, { type: "HUMAN_CONTINUE" }, 103);
    expect(retry.changed).toBe(false);
    expect(retry.error).toMatch(/already FAILED_SAFE/);
  });

  it("cancels on human stop and on a foreign user message (USER_INTERVENTION)", () => {
    const stopped = applyRunEvent(run(), { type: "HUMAN_STOP" }, 101);
    expect(stopped.run.status).toBe("CANCELLED");
    expect(stopped.run.stopReason).toBe("USER_CANCELLED");
    const intervened = applyRunEvent(run(), { type: "USER_INTERVENTION" }, 101);
    expect(intervened.run.status).toBe("CANCELLED");
    expect(intervened.run.stopReason).toBe("USER_INTERVENTION");
  });

  it("fails safe on carrier failure, authority change, and rebase requirement", () => {
    const carrier = applyRunEvent(run(), { type: "CARRIER_FAILURE" }, 101);
    expect(carrier.run.stopReason).toBe("CARRIER_FAILURE");
    const authority = applyRunEvent(run(), { type: "AUTHORITY_CHANGED" }, 101);
    expect(authority.run.stopReason).toBe("AUTHORITY_CHANGED");
    const rebase = applyRunEvent(run(), { type: "CONVERSATION_REBASE_REQUIRED" }, 101);
    expect(rebase.run.stopReason).toBe("CONVERSATION_REBASE_REQUIRED");
    for (const ended of [carrier.run, authority.run, rebase.run]) expect(isTerminal(ended.status)).toBe(true);
  });

  it("maps a BROKEN carrier during an in-flight round to CARRIER_FAILURE", () => {
    const dispatched = applyRunEvent(run(), { type: "DISPATCH_ISSUED", operationId: "op-1" }, 101).run;
    const broken = applyRunEvent(dispatched, { type: "CARRIER_PHASE", carrierState: "BROKEN" }, 102);
    expect(broken.run.status).toBe("FAILED_SAFE");
    expect(broken.run.stopReason).toBe("CARRIER_FAILURE");
  });

  it("rejects mismatched operation events and requires the exact decision phase", () => {
    const dispatched = applyRunEvent(run(), { type: "DISPATCH_ISSUED", operationId: "op-1" }, 101).run;
    expect(applyRunEvent(dispatched, { type: "OPERATION_COMPLETED", operationId: "op-other" }, 102).changed).toBe(false);
    expect(applyRunEvent(dispatched, { type: "HUMAN_CONTINUE" }, 102).changed).toBe(false);
    expect(applyRunEvent(dispatched, { type: "REBIND", bindingEpoch: 9 }, 102).changed).toBe(false);
    const awaiting = dispatchRound(run(), 1);
    expect(awaiting.phase).toBe("AWAITING_HUMAN_DECISION");
    expect(applyRunEvent(awaiting, { type: "DISPATCH_ISSUED", operationId: "op-2" }, 110).changed).toBe(false);
  });

  it("rebinds the binding generation only while idle between rounds", () => {
    const rebind = applyRunEvent(run(), { type: "REBIND", bindingEpoch: 9 }, 101);
    expect(rebind.changed).toBe(true);
    expect(rebind.run.bindingEpoch).toBe(9);
    const bad = applyRunEvent(run(), { type: "REBIND", bindingEpoch: -1 }, 101);
    expect(bad.changed).toBe(false);
  });

  it("ignores every event on a terminal run", () => {
    const ended = run({ status: "ENDED", phase: "ENDED", stopReason: "BUDGET_EXHAUSTED" });
    const events: ContinuationRunEvent[] = [
      { type: "DISPATCH_ISSUED", operationId: "op-x" },
      { type: "HUMAN_CONTINUE" },
      { type: "USER_INTERVENTION" },
      { type: "CARRIER_PHASE", carrierState: "GENERATING" }
    ];
    for (const event of events) expect(applyRunEvent(ended, event, 200).changed).toBe(false);
  });

  it("ignores unknown event types", () => {
    const stale = applyRunEvent(run(), { type: "TIME_TRAVEL" } as unknown as ContinuationRunEvent, 101);
    expect(stale.changed).toBe(false);
    expect(stale.error).toMatch(/unknown event/);
  });
});

describe("reduceContinuationRunStore", () => {
  it("starts, returns, applies, and archives runs per conversation", () => {
    let store = emptyContinuationRunStore();
    const started = reduceContinuationRunStore(store, { type: "start", input: { runId: "bcr-1", workItemId: "w", logicalThreadId: "t", providerConversationRef: "conv-a", bindingEpoch: 1, maxContinuations: 5, now: 1 } });
    expect(started.ok).toBe(true);
    store = started.ok ? started.store : store;
    const fetched = reduceContinuationRunStore(store, { type: "get_active", providerConversationRef: "conv-a" });
    expect(fetched.ok && fetched.run?.runId).toBe("bcr-1");
    const applied = reduceContinuationRunStore(store, { type: "apply", runId: "bcr-1", event: { type: "DISPATCH_ISSUED", operationId: "op-1" }, now: 2 });
    expect(applied.ok).toBe(true);
    store = applied.ok ? applied.store : store;
    expect(store.activeByConversation["conv-a"].phase).toBe("ASSISTANT_GENERATING");
  });

  it("rejects a second active run for the same conversation", () => {
    let store = emptyContinuationRunStore();
    const first = reduceContinuationRunStore(store, { type: "start", input: { runId: "bcr-1", workItemId: "w", logicalThreadId: "t", providerConversationRef: "conv-a", bindingEpoch: 1, maxContinuations: 5, now: 1 } });
    store = first.ok ? first.store : store;
    const second = reduceContinuationRunStore(store, { type: "start", input: { runId: "bcr-2", workItemId: "w", logicalThreadId: "t", providerConversationRef: "conv-a", bindingEpoch: 1, maxContinuations: 1, now: 2 } });
    expect(second.ok).toBe(false);
    expect(second.ok ? "" : second.error).toMatch(/already exists/);
  });

  it("moves terminal runs out of the active map into the bounded ended tail", () => {
    let store = emptyContinuationRunStore();
    const started = reduceContinuationRunStore(store, { type: "start", input: { runId: "bcr-1", workItemId: "w", logicalThreadId: "t", providerConversationRef: "conv-a", bindingEpoch: 1, maxContinuations: 1, now: 1 } });
    store = started.ok ? started.store : store;
    const stopped = reduceContinuationRunStore(store, { type: "apply", runId: "bcr-1", event: { type: "HUMAN_STOP" }, now: 2 });
    store = stopped.ok ? stopped.store : store;
    expect(store.activeByConversation["conv-a"]).toBeUndefined();
    expect(store.ended[0].stopReason).toBe("USER_CANCELLED");
    expect(store.ended).toHaveLength(1);
    const noRun = reduceContinuationRunStore(store, { type: "get_active", providerConversationRef: "conv-a" });
    expect(noRun.ok && noRun.run).toBeUndefined();
  });

  it("caps the ended tail at 20 entries", () => {
    let store = emptyContinuationRunStore();
    for (let index = 0; index < 25; index += 1) {
      const started = reduceContinuationRunStore(store, { type: "start", input: { runId: `bcr-${index}`, workItemId: "w", logicalThreadId: "t", providerConversationRef: `conv-${index}`, bindingEpoch: 1, maxContinuations: 1, now: index } });
      store = started.ok ? started.store : store;
      const stopped = reduceContinuationRunStore(store, { type: "apply", runId: `bcr-${index}`, event: { type: "HUMAN_STOP" }, now: index });
      store = stopped.ok ? stopped.store : store;
    }
    expect(store.ended).toHaveLength(20);
    expect(store.ended[0].runId).toBe("bcr-24");
  });

  it("attaches candidates idempotently and caps the pool at 100", () => {
    let store = emptyContinuationRunStore();
    const base = { runId: "bcr-1", continuationIndex: 1, providerConversationRef: "conv-a", decision: "HUMAN_CONTINUE", humanAction: "continued", capturedAt: 1 } as const;
    const first = reduceContinuationRunStore(store, { type: "attach_candidate", candidate: { ...base, candidateId: "bcr-1:1" } });
    store = first.ok ? first.store : store;
    const duplicate = reduceContinuationRunStore(store, { type: "attach_candidate", candidate: { ...base, candidateId: "bcr-1:1", capturedAt: 2 } });
    expect(duplicate.ok).toBe(true);
    expect(duplicate.ok ? duplicate.store.candidates.length : 0).toBe(1);
    for (let index = 0; index < 120; index += 1) {
      const attached = reduceContinuationRunStore(store, { type: "attach_candidate", candidate: { ...base, candidateId: `c-${index}` } });
      store = attached.ok ? attached.store : store;
    }
    expect(store.candidates).toHaveLength(100);
    expect(store.candidates[0].candidateId).toBe("c-119");
  });

  it("rejects malformed mutations without touching the store", () => {
    const store = emptyContinuationRunStore();
    expect(reduceContinuationRunStore(store, { type: "get_active", providerConversationRef: "" }).ok).toBe(false);
    expect(reduceContinuationRunStore(store, { type: "apply", runId: "ghost", event: { type: "HUMAN_STOP" }, now: 1 }).ok).toBe(false);
    expect(reduceContinuationRunStore(store, { type: "apply", runId: "ghost", event: { type: "HUMAN_STOP" }, now: Number.NaN }).ok).toBe(false);
    expect(reduceContinuationRunStore(store, { type: "attach_candidate", candidate: { candidateId: " ", runId: "bcr-1", continuationIndex: 1, providerConversationRef: "c", decision: "HUMAN_STOP", humanAction: "stopped", capturedAt: 1 } }).ok).toBe(false);
  });
});

describe("AUTO_X5 mode", () => {
  function autoRun(overrides: Partial<ContinuationRun> = {}): ContinuationRun {
    return run({ mode: "AUTO_X5", goal: "Settle the gate question", scope: "Gate policy only", ...overrides });
  }

  function dispatchAutoRound(current: ContinuationRun, round: number, assessmentPasses = true): ContinuationRun {
    const operationId = `${current.runId}:go:${round}`;
    let next = applyRunEvent(current, { type: "DISPATCH_ISSUED", operationId }, 100 + round).run;
    next = applyRunEvent(next, { type: "OPERATION_ACCEPTED", operationId, turnRef: `turn:t${round}` }, 100 + round).run;
    next = applyRunEvent(next, { type: "OPERATION_COMPLETED", operationId, turnRef: `turn:t${round}` }, 100 + round).run;
    if (next.phase === "EVALUATING") {
      next = applyRunEvent(next, assessmentPasses ? { type: "EVALUATION_PASSED" } : { type: "EVALUATION_STOPPED", reason: "GOAL_SATISFIED" }, 100 + round).run;
    }
    return next;
  }

  it("starts AUTO_X5 without a user goal (built-in continuation contract) and rejects invalid goal/scope", () => {
    const base = { runId: "bcr-a", workItemId: "w", logicalThreadId: "t", providerConversationRef: "conv-a", bindingEpoch: 1, maxContinuations: 5, mode: "AUTO_X5" as const, now: 1 };
    const started = startContinuationRun(base);
    expect(started.goal).toBeUndefined();
    expect(started.phase).toBe("READY_TO_GO");
    expect(() => startContinuationRun({ ...base, goal: "  " })).toThrow(/goal/);
    expect(() => startContinuationRun({ ...base, goal: "g", scope: " " })).toThrow(/scope/);
    const withGoal = startContinuationRun({ ...base, goal: "g" });
    expect(withGoal.goal).toBe("g");
    expect(withGoal.scope).toBeUndefined();
  });

  it("routes COMPLETED into EVALUATING for AUTO runs and AWAITING_HUMAN_DECISION for ASSISTED", () => {
    const dispatchedAuto = applyRunEvent(autoRun(), { type: "DISPATCH_ISSUED", operationId: "op-1" }, 101).run;
    const completedAuto = applyRunEvent(dispatchedAuto, { type: "OPERATION_ACCEPTED", operationId: "op-1" }, 102).run;
    const completed = applyRunEvent(completedAuto, { type: "OPERATION_COMPLETED", operationId: "op-1" }, 103).run;
    expect(completed.phase).toBe("EVALUATING");
    const dispatchedAssisted = applyRunEvent(run(), { type: "DISPATCH_ISSUED", operationId: "op-1" }, 101).run;
    const completedAssisted = applyRunEvent(dispatchedAssisted, { type: "OPERATION_ACCEPTED", operationId: "op-1" }, 102).run;
    const assisted = applyRunEvent(completedAssisted, { type: "OPERATION_COMPLETED", operationId: "op-1" }, 103).run;
    expect(assisted.phase).toBe("AWAITING_HUMAN_DECISION");
  });

  it("runs AUTO rounds: evaluate-pass advances, evaluate-stop ends with the mapped reason", () => {
    let current = autoRun({ maxContinuations: 3 });
    current = dispatchAutoRound(current, 1, true);
    expect(current.phase).toBe("READY_TO_GO");
    expect(current.consumedContinuations).toBe(1);
    current = dispatchAutoRound(current, 2, false);
    expect(current.status).toBe("ENDED");
    expect(current.stopReason).toBe("GOAL_SATISFIED");
    expect(current.consumedContinuations).toBe(2);
  });

  it("ends BUDGET_EXHAUSTED when the last AUTO round completes even if evaluation would pass", () => {
    let current = autoRun({ maxContinuations: 1 });
    const dispatched = applyRunEvent(current, { type: "DISPATCH_ISSUED", operationId: "op-1" }, 101).run;
    const accepted = applyRunEvent(dispatched, { type: "OPERATION_ACCEPTED", operationId: "op-1" }, 102).run;
    const completed = applyRunEvent(accepted, { type: "OPERATION_COMPLETED", operationId: "op-1" }, 103).run;
    expect(completed.status).toBe("ENDED");
    expect(completed.stopReason).toBe("BUDGET_EXHAUSTED");
    expect(applyRunEvent(completed, { type: "EVALUATION_PASSED" }, 104).changed).toBe(false);
  });

  it("refuses HUMAN_CONTINUE and dispatch during EVALUATING, but a queued Stop always applies", () => {
    const dispatched = applyRunEvent(autoRun(), { type: "DISPATCH_ISSUED", operationId: "op-1" }, 101).run;
    const evaluating = applyRunEvent(dispatched, { type: "OPERATION_ACCEPTED", operationId: "op-1" }, 102).run;
    const completed = applyRunEvent(evaluating, { type: "OPERATION_COMPLETED", operationId: "op-1" }, 103).run;
    expect(applyRunEvent(completed, { type: "HUMAN_CONTINUE" }, 104).changed).toBe(false);
    expect(applyRunEvent(completed, { type: "DISPATCH_ISSUED", operationId: "op-2" }, 104).changed).toBe(false);
    const stopped = applyRunEvent(completed, { type: "HUMAN_STOP" }, 104).run;
    expect(stopped.status).toBe("CANCELLED");
    expect(stopped.stopReason).toBe("USER_CANCELLED");
    const passed = applyRunEvent(completed, { type: "EVALUATION_PASSED" }, 104).run;
    expect(passed.phase).toBe("READY_TO_GO");
    const passedAgain = applyRunEvent(passed, { type: "EVALUATION_PASSED" }, 105);
    expect(passedAgain.changed).toBe(false);
  });

  it("records continuation mode and assessment on round evidence", () => {
    let store = emptyContinuationRunStore();
    const started = reduceContinuationRunStore(store, { type: "start", input: { runId: "bcr-a", workItemId: "w", logicalThreadId: "t", providerConversationRef: "conv-a", bindingEpoch: 1, maxContinuations: 5, mode: "AUTO_X5", goal: "g", now: 1 } });
    store = started.ok ? started.store : store;
    const evidence = reduceContinuationRunStore(store, {
      type: "record_round_evidence",
      runId: "bcr-a",
      continuationIndex: 1,
      decision: "AUTO_CONTINUE",
      humanAction: "pending",
      continuationMode: "REANCHOR_GO",
      assessment: { goal_status: "IN_PROGRESS", confidence: "HIGH" },
      capturedAt: 2
    });
    expect(evidence.ok).toBe(true);
    store = evidence.ok ? evidence.store : store;
    expect(store.candidates[0].continuationMode).toBe("REANCHOR_GO");
    expect(store.candidates[0].assessment).toEqual({ goal_status: "IN_PROGRESS", confidence: "HIGH" });
    const bad = reduceContinuationRunStore(store, {
      type: "record_round_evidence",
      runId: "bcr-a",
      continuationIndex: 2,
      decision: "AUTO_CONTINUE",
      humanAction: "pending",
      assessment: "not-an-object" as unknown as Record<string, unknown>,
      capturedAt: 3
    });
    expect(bad.ok).toBe(false);
  });
});

describe("createFixtureCandidate", () => {
  it("builds a stable candidate id and keeps evidence fields", () => {
    const active = run({ consumedContinuations: 2, lastConsumedTurnRef: "turn:t2" });
    const candidate = createFixtureCandidate(active, { continuationIndex: 2, turnRef: "turn:t2", assistantTurnExcerpt: "excerpt", decision: "HUMAN_CONTINUE", humanAction: "continued", capturedAt: 500 });
    expect(candidate.candidateId).toBe("bcr-test:2");
    expect(candidate.turnRef).toBe("turn:t2");
    expect(candidate.assistantTurnExcerpt).toBe("excerpt");
    expect(candidate.stopReason).toBeUndefined();
  });
});
