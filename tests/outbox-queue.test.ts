import { describe, expect, it } from "vitest";
import {
  OUTBOX_MAX_ATTEMPTS,
  canEditOutboxItem,
  expectedUserTurnAccounting,
  extractOutboxQueueState,
  hasOutstandingOutboxReservation,
  headOutboxItem,
  outboxQueueStatus,
  reduceOutboxQueue,
  type OutboxQueueState
} from "../src/core/outbox-queue";

const CONVERSATION = "conv-1";
const RUN = "bcr-run-1";

function enqueue(state: OutboxQueueState, itemId: string, payload: string, now: number): OutboxQueueState {
  const result = reduceOutboxQueue(state, {
    type: "enqueue",
    input: {
      itemId,
      logicalThreadId: `thread:${CONVERSATION}`,
      providerConversationRef: CONVERSATION,
      payload,
      now
    }
  });
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function claim(state: OutboxQueueState, itemId: string, operationId: string, runId: string | undefined, now: number): OutboxQueueState {
  const item = state.items.find(candidate => candidate.itemId === itemId);
  if (!item) throw new Error("item_not_found");
  const result = reduceOutboxQueue(state, {
    type: "claim_dispatch",
    itemId,
    input: { operationId, reservation: { itemId, revision: item.revision, submissionOperationId: operationId, runId, expectedOperationKind: "OUTBOX_MESSAGE" }, now }
  });
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

/** `baselineUserMessageCount` arrives with the delivery, from the operation's own pre-submit evidence. */
function markDelivered(state: OutboxQueueState, operationId: string, baselineUserMessageCount: number, now: number): OutboxQueueState {
  const result = reduceOutboxQueue(state, {
    type: "record_submission",
    outcome: { operationId, state: "OBSERVED_ACCEPTED", baselineUserMessageCount, now }
  });
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("outbox queue identity, ordering and revisions", () => {
  it("orders by arrival regardless of insertion shape and rejects a duplicate item id", () => {
    const state = enqueue(enqueue(enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "first", 1), "b", "second", 2), "c", "third", 3);
    expect(state.items.map(item => item.itemId).sort()).toEqual(["a", "b", "c"]);

    const duplicate = reduceOutboxQueue(state, {
      type: "enqueue",
      input: { itemId: "a", logicalThreadId: `thread:${CONVERSATION}`, providerConversationRef: CONVERSATION, payload: "again", now: 4 }
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error).toBe("item_id_reuse_conflict");
    expect(duplicate.state).toBe(state);
  });

  it("advances the revision on an edit and re-fingerprints the payload with it", () => {
    const state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "first draft", 1);
    const before = state.items[0];
    const edited = reduceOutboxQueue(state, { type: "edit", itemId: "a", expectedRevision: 1, payload: "second draft", now: 5 });
    expect(edited.ok).toBe(true);
    expect(edited.item?.revision).toBe(2);
    expect(edited.item?.payload).toBe("second draft");
    expect(edited.item?.payloadFingerprint).not.toBe(before.payloadFingerprint);
    // A dispatch compiles one exact revision, so the item's own timestamps move
    // with it — a stale revision can never be dressed as the current one.
    expect(edited.item!.createdAt).toBe(5);
  });

  it("refuses an edit once the item is claimed, and refuses a stale expectedRevision", () => {
    const queued = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "first draft", 1);
    const stale = reduceOutboxQueue(queued, { type: "edit", itemId: "a", expectedRevision: 99, payload: "x", now: 2 });
    expect(stale.ok).toBe(false);
    expect(stale.error).toBe("revision_conflict");

    const claimed = claim(queued, "a", "outbox:a:r1:a1:deadbeef", RUN, 3);
    expect(canEditOutboxItem(claimed.items[0])).toBe(false);
    const afterClaim = reduceOutboxQueue(claimed, { type: "edit", itemId: "a", expectedRevision: 1, payload: "x", now: 4 });
    expect(afterClaim.ok).toBe(false);
    expect(afterClaim.error).toBe("edit_after_claim_forbidden");
  });

  it("cancels only pre-claim items; a claimed payload has no cancel path either", () => {
    const queued = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "draft", 1);
    const cancelled = reduceOutboxQueue(queued, { type: "cancel", itemId: "a", now: 2 });
    expect(cancelled.item?.state).toBe("CANCELLED");
    expect(headOutboxItem(cancelled.state)).toBeUndefined();

    const claimed = claim(queued, "a", "op-1", RUN, 3);
    const refused = reduceOutboxQueue(claimed, { type: "cancel", itemId: "a", now: 4 });
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe("cancel_requires_resolution");
  });
});

describe("outbox head-of-line blocking", () => {
  it("suspends the whole queue on an ambiguous head and never skips it", () => {
    let state = enqueue(enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "first", 1), "b", "second", 2);
    state = claim(state, "a", "op-a", RUN, 3);
    state = reduceOutboxQueue(state, { type: "record_submission", outcome: { operationId: "op-a", state: "UNCERTAIN", now: 4 } }).state;

    expect(outboxQueueStatus(state)).toEqual({ kind: "BLOCKED_UNCERTAIN", itemId: "a" });
    expect(headOutboxItem(state)?.itemId).toBe("a");
    // The later item exists and is untouched: blocking is a head property, not a
    // mutation of the items behind it.
    expect(state.items.find(item => item.itemId === "b")?.state).toBe("QUEUED");
  });

  it("parks a proven-not-accepted item once its attempts are spent instead of retrying forever", () => {
    let state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "first", 1);
    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      state = claim(state, "a", `op-${attempt}`, RUN, attempt * 10);
      state = reduceOutboxQueue(state, {
        type: "record_submission",
        outcome: { operationId: `op-${attempt}`, state: "FAILED_SAFE", baselineUserMessageCount: 0, now: attempt * 10 + 1 }
      }).state;
      state = reduceOutboxQueue(state, { type: "release_attempt", itemId: "a", reason: "PROVEN_NOT_ACCEPTED", now: attempt * 10 + 2 }).state;
    }
    const head = headOutboxItem(state);
    expect(head?.state).toBe("BLOCKED");
    expect(head?.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    // A parked head keeps its reservation identity: nothing may quietly mint a
    // replacement operation behind a proven failure.
    expect(head?.submissionOperationId).toBe(`op-${OUTBOX_MAX_ATTEMPTS}`);
    expect(outboxQueueStatus(state)).toEqual({ kind: "WAIT", itemId: "a", reason: "attempt_failed" });
  });

  it("drops cancelled items out of the head without disturbing the queue behind them", () => {
    let state = enqueue(enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "first", 1), "b", "second", 2);
    state = reduceOutboxQueue(state, { type: "cancel", itemId: "a", now: 3 }).state;
    expect(headOutboxItem(state)?.itemId).toBe("b");
  });
});

describe("provenance-bound expected-user-turn accounting (#63 delta 3)", () => {
  function deliveredQueue(): OutboxQueueState {
    let state = enqueue(enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued one", 1), "b", "queued two", 2);
    state = claim(state, "a", "op-a", RUN, 3);
    state = markDelivered(state, "op-a", 4, 4);
    return state;
  }

  it("raises the floor only for an operation that proved acceptance", () => {
    let state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued", 1);
    state = claim(state, "a", "op-a", RUN, 2);
    // Claimed but unproven: the queue says nothing about this Run's expected turns.
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)).toBeUndefined();

    state = markDelivered(state, "op-a", 4, 3);
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)).toEqual({ baseline: 4, expectedUserMessageCount: 5 });
  });

  it("counts only the delivered prefix, so nothing behind an unresolved item can be counted", () => {
    let state = deliveredQueue();
    state = claim(state, "b", "op-b", RUN, 5);
    // Item b is dispatching, not proven: the floor must stay at one delivery.
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)).toEqual({ baseline: 4, expectedUserMessageCount: 5 });
    state = reduceOutboxQueue(state, { type: "record_submission", outcome: { operationId: "op-b", state: "FAILED_SAFE", now: 6 } }).state;
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)).toEqual({ baseline: 4, expectedUserMessageCount: 5 });
  });

  it("says nothing about a Run epoch that owns no reservation", () => {
    const state = deliveredQueue();
    expect(expectedUserTurnAccounting(state, "some-other-run", CONVERSATION)).toBeUndefined();
    expect(expectedUserTurnAccounting(state, RUN, "other-conversation")).toBeUndefined();
    expect(hasOutstandingOutboxReservation(state, "some-other-run")).toBe(false);
  });

  it("reports an outstanding reservation while a delivery is unaccounted for, and clears it once proven", () => {
    let state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued", 1);
    state = claim(state, "a", "op-a", RUN, 2);
    expect(hasOutstandingOutboxReservation(state, RUN)).toBe(true);
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)).toBeUndefined();
    state = markDelivered(state, "op-a", 4, 3);
    expect(hasOutstandingOutboxReservation(state, RUN)).toBe(false);
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)).toEqual({ baseline: 4, expectedUserMessageCount: 5 });
  });

  /**
   * The counter-example the disposition asks for: a failed or ambiguous dispatch
   * must leave the Run's expectation exactly where it was, or a later genuine
   * Human message would hide underneath a floor Shuttle invented.
   */
  it("leaves no loose +1 behind after a failed dispatch", () => {
    let state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued", 1);
    state = claim(state, "a", "op-a", RUN, 2);
    const floorBeforeFailure = expectedUserTurnAccounting(state, RUN, CONVERSATION);

    for (const failedState of ["FAILED_SAFE", "UNCERTAIN", "CANCELLED", "DISPATCHING"] as const) {
      const failed = reduceOutboxQueue(state, {
        type: "record_submission",
        outcome: { operationId: "op-a", state: failedState, baselineUserMessageCount: 4, now: 3 }
      });
      expect(failed.ok).toBe(true);
      expect(expectedUserTurnAccounting(failed.state, RUN, CONVERSATION)).toEqual(floorBeforeFailure);
    }
  });

  it("is idempotent: re-recording one delivery never counts it twice", () => {
    let state = deliveredQueue();
    const once = expectedUserTurnAccounting(state, RUN, CONVERSATION);
    state = markDelivered(state, "op-a", 4, 9);
    state = markDelivered(state, "op-a", 4, 10);
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)).toEqual(once);
  });

  it("attributes a queued turn to the Run epoch that reserved it, not to whoever observes it", () => {
    let state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued", 1);
    state = claim(state, "a", "op-a", RUN, 2);
    state = markDelivered(state, "op-a", 4, 3);
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)?.expectedUserMessageCount).toBe(5);
    expect(expectedUserTurnAccounting(state, "bcr-run-2", CONVERSATION)).toBeUndefined();
  });
});

describe("outbox durable shape", () => {
  it("round-trips through storage extraction and drops unrecognizable records", () => {
    let state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued", 1);
    state = claim(state, "a", "op-a", RUN, 2);
    state = { ...state, paused: true };

    const restored = extractOutboxQueueState({ noosOutboxQueue: state });
    expect(restored.paused).toBe(true);
    expect(restored.items).toHaveLength(1);
    expect(restored.items[0].submissionOperationId).toBe("op-a");
    expect(restored.items[0].reservationRunId).toBe(RUN);

    expect(extractOutboxQueueState({ noosOutboxQueue: { items: [{ itemId: "broken" }] } }).items).toHaveLength(0);
    expect(extractOutboxQueueState(undefined)).toEqual({ revision: 0, sequence: 0, paused: false, items: [] });
  });
});
