import { describe, expect, it } from "vitest";
import { decideRunIntervention } from "../src/core/run-intervention";
import { expectedUserTurnAccounting, reduceOutboxQueue, type OutboxQueueState } from "../src/core/outbox-queue";

/**
 * The Run-level counterexamples issue #63 delta 3 asks for.
 *
 * The reducer-level guarantee ("a failed dispatch leaves no loose +1") is only
 * half the story. What the Run actually does is compare the observed user-turn
 * count against an expectation composed from two sources — its own pre-dispatch
 * bump for the governed round it is waiting on, and what queued deliveries
 * answer for. That composition has two failure modes pulling in opposite
 * directions:
 *
 *  - lose the expectation and a queued message the Human didn't type mid-Run
 *    reads as one they did, cancelling the Run the feature exists to keep alive;
 *  - keep an unearned expectation and a later genuine Human message hides
 *    underneath it, weakening the intervention rule this design promised not to
 *    touch.
 *
 * These drive the whole chain: queue state → `expectedUserTurnAccounting` →
 * `decideRunIntervention`.
 */

const CONVERSATION = "conv-1";
const RUN = "bcr-run-1";

function enqueue(state: OutboxQueueState, itemId: string, now: number): OutboxQueueState {
  return reduceOutboxQueue(state, {
    type: "enqueue",
    input: { itemId, logicalThreadId: `thread:${CONVERSATION}`, providerConversationRef: CONVERSATION, payload: `queued ${itemId}`, now }
  }).state;
}

function claim(state: OutboxQueueState, itemId: string, operationId: string, now: number, observedUserMessageCount: number): OutboxQueueState {
  const item = state.items.find(candidate => candidate.itemId === itemId)!;
  return reduceOutboxQueue(state, {
    type: "claim_dispatch",
    itemId,
    input: {
      operationId,
      reservation: { itemId, revision: item.revision, submissionOperationId: operationId, runId: RUN, expectedOperationKind: "OUTBOX_MESSAGE", observedUserMessageCount },
      now
    }
  }).state;
}

function record(state: OutboxQueueState, operationId: string, outcome: "OBSERVED_ACCEPTED" | "COMPLETED" | "FAILED_SAFE" | "UNCERTAIN" | "CANCELLED", baseline: number, now: number): OutboxQueueState {
  return reduceOutboxQueue(state, {
    type: "record_submission",
    outcome: { operationId, state: outcome, baselineUserMessageCount: baseline, now }
  }).state;
}

/** The queue's answer for this Run epoch, in the shape the watcher consumes. */
function accountingOf(state: OutboxQueueState) {
  return expectedUserTurnAccounting(state, RUN, CONVERSATION);
}

function decide(governedExpectedUserCount: number, observedUserCount: number, state: OutboxQueueState) {
  return decideRunIntervention({ governedExpectedUserCount, observedUserCount, outbox: accountingOf(state) });
}

describe("a queued turn is expected from the moment it is reserved", () => {
  /**
   * The window this closes: the carrier actuates, the provider shows the new
   * user turn immediately, but the ledger proof arrives a probe cycle later at
   * best. The Run's watcher ticks faster than either, so without a reservation
   * the Run is cancelled for a message the Human never typed mid-Run.
   */
  it("does not cancel the Run in the gap between the turn landing and the proof", () => {
    let queue = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", 1);
    queue = claim(queue, "a", "op-a", 2, 4);
    // Turn 5 has appeared; nothing is proven yet.
    const decision = decide(4, 5, queue);
    expect(decision.verdict).toBe("NONE");
    expect(decision.expectedUserCount).toBe(5);
  });

  it("keeps tolerating exactly one turn after the delivery is proven", () => {
    let queue = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", 1);
    queue = claim(queue, "a", "op-a", 2, 4);
    queue = record(queue, "op-a", "OBSERVED_ACCEPTED", 4, 3);

    expect(decide(4, 5, queue).verdict).toBe("NONE");
    // A second turn above the expectation is somebody else's.
    expect(decide(4, 6, queue).verdict).toBe("HUMAN_INTERVENTION");
  });

  it("lets the Run's own next round raise the expectation without undoing the delivery", () => {
    let queue = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", 1);
    queue = claim(queue, "a", "op-a", 2, 4);
    queue = record(queue, "op-a", "OBSERVED_ACCEPTED", 4, 3);
    // The Run dispatches its next governed GO from the new conversation state:
    // its bump takes the expectation to 6, and the queued turn is behind it.
    const decision = decide(6, 6, queue);
    expect(decision.expectedUserCount).toBe(6);
    expect(decision.verdict).toBe("NONE");
  });

  it("does not count a queued turn twice when the Run's bump has moved past it", () => {
    let queue = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", 1);
    queue = claim(queue, "a", "op-a", 2, 4);
    queue = record(queue, "op-a", "COMPLETED", 4, 3);
    // Governing count already at 6 while the floor is 5: the higher wins, and the
    // floor never adds to it.
    const decision = decide(6, 6, queue);
    expect(decision.expectedUserCount).toBe(6);
  });
});

describe("a failed or retired reservation leaves nothing behind", () => {
  for (const failure of ["FAILED_SAFE", "CANCELLED"] as const) {
    it(`a real Human message after a ${failure} dispatch is still an intervention`, () => {
      let queue = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", 1);
      queue = claim(queue, "a", "op-a", 2, 4);
      queue = record(queue, "op-a", failure, 4, 3);
      if (failure === "FAILED_SAFE") {
        queue = reduceOutboxQueue(queue, { type: "release_attempt", itemId: "a", reason: "PROVEN_NOT_ACCEPTED", now: 4 }).state;
      }

      // Nothing was delivered and no reservation stands, so the Run's own rule
      // applies unchanged.
      expect(accountingOf(queue)).toBeUndefined();
      const decision = decide(4, 5, queue);
      expect(decision.verdict).toBe("HUMAN_INTERVENTION");
      expect(decision.expectedUserCount).toBe(4);
    });
  }

  it("an unclaimed dispatch reserves nothing either", () => {
    const queue = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", 1);
    expect(accountingOf(queue)).toBeUndefined();
    expect(decide(4, 5, queue).verdict).toBe("HUMAN_INTERVENTION");
  });

  it("a released retry that later succeeds counts once", () => {
    let queue = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", 1);
    queue = claim(queue, "a", "op-a", 2, 4);
    queue = record(queue, "op-a", "FAILED_SAFE", 4, 3);
    queue = reduceOutboxQueue(queue, { type: "release_attempt", itemId: "a", reason: "PROVEN_NOT_ACCEPTED", now: 4 }).state;
    expect(accountingOf(queue)).toBeUndefined();

    queue = claim(queue, "a", "op-a2", 5, 4);
    queue = record(queue, "op-a2", "OBSERVED_ACCEPTED", 4, 6);
    expect(accountingOf(queue)?.expectedUserMessageCount).toBe(5);
    expect(decide(4, 5, queue).verdict).toBe("NONE");
  });
});

describe("ambiguous attribution holds rather than terminating", () => {
  /**
   * #57 Q3: unknown attribution fails closed — do not advance, do not actuate,
   * and surface the ambiguity instead of terminally inventing Human
   * intervention.
   */
  it("holds when an unresolved reservation could account for the change", () => {
    let queue = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", 1);
    queue = claim(queue, "a", "op-a", 2, 4);
    queue = record(queue, "op-a", "UNCERTAIN", 4, 3);

    // Within the single tolerated turn: nothing to answer for either way.
    expect(decide(4, 5, queue).verdict).toBe("NONE");
    // Above it, with the reservation still ambiguous: hold, do not cancel.
    const held = decide(4, 6, queue);
    expect(held.verdict).toBe("AMBIGUOUS_HOLD");
    expect(held.expectedUserCount).toBe(5);
  });

  it("holds even when the account is already proven for an earlier delivery", () => {
    let queue = enqueue(enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", 1), "b", 2);
    queue = claim(queue, "a", "op-a", 3, 4);
    queue = record(queue, "op-a", "OBSERVED_ACCEPTED", 4, 4);
    queue = claim(queue, "b", "op-b", 5, 5);
    queue = record(queue, "op-b", "UNCERTAIN", 4, 6);

    // Baseline 4 + one proven + one tolerated = 6.
    expect(accountingOf(queue)?.expectedUserMessageCount).toBe(6);
    expect(decide(4, 6, queue).verdict).toBe("NONE");
    expect(decide(4, 7, queue).verdict).toBe("AMBIGUOUS_HOLD");
  });

  it("stops holding once the reservation is retired", () => {
    let queue = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", 1);
    queue = claim(queue, "a", "op-a", 2, 4);
    queue = record(queue, "op-a", "UNCERTAIN", 4, 3);
    expect(decide(4, 6, queue).verdict).toBe("AMBIGUOUS_HOLD");

    queue = record(queue, "op-a", "CANCELLED", 4, 4);
    expect(accountingOf(queue)).toBeUndefined();
    expect(decide(4, 6, queue).verdict).toBe("HUMAN_INTERVENTION");
  });
});

describe("the Run's own expectation is never lowered", () => {
  it("keeps the higher of the governed bump and the queued floor", () => {
    let queue = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", 1);
    queue = claim(queue, "a", "op-a", 2, 2);
    queue = record(queue, "op-a", "COMPLETED", 2, 3);
    // A delivery whose baseline is behind the Run's own count: the governed bump wins.
    const decision = decide(4, 4, queue);
    expect(decision.expectedUserCount).toBe(4);
    expect(decision.verdict).toBe("NONE");
  });

  it("carries an unbaselined count forward untouched", () => {
    // `-1` is the watcher's "no observation yet" marker; the decision must not
    // turn it into a comparison against the floor.
    const decision = decideRunIntervention({ governedExpectedUserCount: -1, observedUserCount: 3 });
    expect(decision.expectedUserCount).toBe(-1);
  });
});
