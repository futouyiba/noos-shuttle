import { describe, expect, it } from "vitest";
import {
  OUTBOX_MAX_ATTEMPTS,
  canEditOutboxItem,
  expectedUserTurnAccounting,
  extractOutboxQueueState,
  hasOutstandingOutboxReservation,
  headOutboxItem,
  outboxQueueStatus,
  planUncertainCancel,
  reduceOutboxQueue,
  type OutboxQueueState
} from "../src/core/outbox-queue";
import type { SubmissionOperation, SubmissionOperationState } from "../src/core/submission-operation";
import { decideRunIntervention } from "../src/core/run-intervention";

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

function claim(state: OutboxQueueState, itemId: string, operationId: string, runId: string | undefined, now: number, observedUserMessageCount?: number): OutboxQueueState {
  const item = state.items.find(candidate => candidate.itemId === itemId);
  if (!item) throw new Error("item_not_found");
  const result = reduceOutboxQueue(state, {
    type: "claim_dispatch",
    itemId,
    input: { operationId, reservation: { itemId, revision: item.revision, submissionOperationId: operationId, runId, expectedOperationKind: "OUTBOX_MESSAGE", observedUserMessageCount }, now }
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

  it("cancels pre-claim items; an in-flight dispatch and a proven turn stay non-cancellable", () => {
    const queued = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "draft", 1);
    const cancelled = reduceOutboxQueue(queued, { type: "cancel", itemId: "a", now: 2 });
    expect(cancelled.item?.state).toBe("CANCELLED");
    expect(headOutboxItem(cancelled.state)).toBeUndefined();

    const dispatching = claim(queued, "a", "op-1", RUN, 3);
    expect(dispatching.items[0].state).toBe("DISPATCHING");
    const refused = reduceOutboxQueue(dispatching, { type: "cancel", itemId: "a", now: 4 });
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe("cancel_requires_resolution");

    const delivered = markDelivered(dispatching, "op-1", 4, 5);
    const refusedToo = reduceOutboxQueue(delivered, { type: "cancel", itemId: "a", now: 6 });
    expect(refusedToo.ok).toBe(false);
    expect(refusedToo.error).toBe("cancel_requires_resolution");
  });
});

describe("cancelling an unresolved item is the Human's escape (#63 delta 7)", () => {
  function uncertainQueue(): OutboxQueueState {
    let state = enqueue(enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued one", 1), "b", "queued two", 2);
    state = claim(state, "a", "op-a", RUN, 3, 4);
    state = reduceOutboxQueue(state, {
      type: "record_submission",
      outcome: { operationId: "op-a", state: "UNCERTAIN", now: 4 }
    }).state;
    expect(state.items[0].state).toBe("UNCERTAIN");
    return state;
  }

  /**
   * The hole PR #92's review found (finding F2): an ambiguous delivery froze
   * the queue forever, blocked every later dispatch to the target, and held
   * the Run at AMBIGUOUS_HOLD — with the surface offering no way out. Delta 7
   * names the exit: "resolved/cancelled by authorized policy", and the Human
   * is the authorized actor in this tree.
   */
  it("cancels an UNCERTAIN item and releases everything it was holding", () => {
    const state = uncertainQueue();
    expect(outboxQueueStatus(state)).toEqual({ kind: "BLOCKED_UNCERTAIN", itemId: "a" });
    expect(hasOutstandingOutboxReservation(state, RUN)).toBe(true);

    const cancelled = reduceOutboxQueue(state, { type: "cancel", itemId: "a", now: 5 });
    expect(cancelled.ok).toBe(true);
    expect(cancelled.item?.state).toBe("CANCELLED");
    // The queue advances: the next item is the head again, not blocked.
    expect(headOutboxItem(cancelled.state)?.itemId).toBe("b");
    expect(outboxQueueStatus(cancelled.state)).toEqual({ kind: "WAIT", itemId: "b", reason: "conversation_absent" });
    // The Run's tolerance is withdrawn and the priority gate lets go.
    expect(expectedUserTurnAccounting(cancelled.state, RUN, "conv-1")).toBeUndefined();
    expect(hasOutstandingOutboxReservation(cancelled.state, RUN)).toBe(false);
    expect(decideRunIntervention({ governedExpectedUserCount: 4, observedUserCount: 5, outbox: undefined }).verdict)
      .toBe("HUMAN_INTERVENTION");
  });

  it("keeps the reservation id on the cancelled item as its audit trail", () => {
    const state = uncertainQueue();
    const cancelled = reduceOutboxQueue(state, { type: "cancel", itemId: "a", now: 5 });
    expect(cancelled.item?.submissionOperationId).toBe("op-a");
    expect(cancelled.item?.reservationRunId).toBe(RUN);
  });

  it("is idempotent: cancelling twice stays cancelled", () => {
    const state = uncertainQueue();
    const once = reduceOutboxQueue(state, { type: "cancel", itemId: "a", now: 5 });
    const twice = reduceOutboxQueue(once.state, { type: "cancel", itemId: "a", now: 6 });
    expect(twice.ok).toBe(true);
    expect(twice.item?.state).toBe("CANCELLED");
  });
});

describe("planUncertainCancel decides against the ledger, not the queue alone", () => {
  /**
   * The reducer cannot see the ledger, so the background consults this plan
   * first. The two refusal/retire rules are the honesty edges: never claim a
   * delivery didn't happen when the ledger proved it did, and never leave an
   * execution-owning operation behind to wedge every later dispatch.
   */
  function uncertainItem() {
    let state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued", 1);
    state = claim(state, "a", "op-a", RUN, 2, 4);
    return reduceOutboxQueue(state, {
      type: "record_submission",
      outcome: { operationId: "op-a", state: "UNCERTAIN", now: 3 }
    }).state.items[0];
  }

  const operation = (state: SubmissionOperationState) =>
    ({ operationId: "op-a", operationKind: "OUTBOX_MESSAGE", state }) as SubmissionOperation;

  it("retires an UNCERTAIN operation first", () => {
    expect(planUncertainCancel(uncertainItem(), operation("UNCERTAIN")))
      .toEqual({ allowed: true, retireOperationId: "op-a" });
  });

  it("refuses when the ledger has already proven the delivery", () => {
    for (const proven of ["OBSERVED_ACCEPTED", "COMPLETED"] as const) {
      expect(planUncertainCancel(uncertainItem(), operation(proven)))
        .toEqual({ allowed: false, reason: "delivery_accepted" });
    }
  });

  it("needs no retire for a terminal operation or a missing one", () => {
    for (const terminal of ["FAILED_SAFE", "CANCELLED"] as const) {
      expect(planUncertainCancel(uncertainItem(), operation(terminal))).toEqual({ allowed: true });
    }
    expect(planUncertainCancel(uncertainItem(), undefined)).toEqual({ allowed: true });
  });

  it("passes non-UNCERTAIN items through to the reducer's own rules", () => {
    const queued = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued", 1).items[0];
    expect(planUncertainCancel(queued, operation("UNCERTAIN"))).toEqual({ allowed: true });
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

  /**
   * The surface offers "edit" on a parked item and the copy promises that
   * editing lets it continue. Both would be lies if a rewrite left the item
   * parked with its attempt budget spent — it could only ever be cancelled.
   */
  it("revives a parked item when it is rewritten", () => {
    let state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "first", 1);
    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      state = claim(state, "a", `op-${attempt}`, RUN, attempt * 10);
      state = reduceOutboxQueue(state, {
        type: "record_submission",
        outcome: { operationId: `op-${attempt}`, state: "FAILED_SAFE", baselineUserMessageCount: 0, now: attempt * 10 + 1 }
      }).state;
      state = reduceOutboxQueue(state, { type: "release_attempt", itemId: "a", reason: "PROVEN_NOT_ACCEPTED", now: attempt * 10 + 2 }).state;
    }
    expect(state.items[0].state).toBe("BLOCKED");

    const parked = state.items[0];
    const rewritten = reduceOutboxQueue(state, { type: "edit", itemId: "a", expectedRevision: parked.revision, payload: "a better message", now: 100 });
    expect(rewritten.ok).toBe(true);
    expect(rewritten.item?.state).toBe("QUEUED");
    expect(rewritten.item?.attempts).toBe(0);
    // The retired operations keep their own identities: a fresh attempt mints a
    // fresh id (the revision is part of it), so nothing is reused under a
    // fingerprint the ledger already retired.
    expect(rewritten.item?.submissionOperationId).toBeUndefined();
    expect(outboxQueueStatus(rewritten.state)).toEqual({ kind: "WAIT", itemId: "a", reason: "conversation_absent" });
  });

  it("keeps a parked item parked when the rewrite changes nothing", () => {
    let state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "first", 1);
    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      state = claim(state, "a", `op-${attempt}`, RUN, attempt * 10);
      state = reduceOutboxQueue(state, {
        type: "record_submission",
        outcome: { operationId: `op-${attempt}`, state: "FAILED_SAFE", baselineUserMessageCount: 0, now: attempt * 10 + 1 }
      }).state;
      state = reduceOutboxQueue(state, { type: "release_attempt", itemId: "a", reason: "PROVEN_NOT_ACCEPTED", now: attempt * 10 + 2 }).state;
    }
    const parked = state.items[0];
    const unchanged = reduceOutboxQueue(state, { type: "edit", itemId: "a", expectedRevision: parked.revision, payload: "  first  ", now: 100 });
    expect(unchanged.ok).toBe(true);
    // Whitespace-normalized to the same bytes: same fingerprint, so the spent
    // attempts still stand and the item stays parked.
    expect(unchanged.item?.state).toBe("BLOCKED");
    expect(unchanged.item?.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
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
    state = claim(state, "a", "op-a", RUN, 3, 4);
    state = markDelivered(state, "op-a", 4, 4);
    return state;
  }

  it("carries no expectation at all until a reservation or a delivery exists", () => {
    const state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued", 1);
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)).toBeUndefined();
  });

  /**
   * A reservation *is* an expected Human turn (delta 3), so it tolerates exactly
   * one before the ledger has proved anything. Without this the Run is cancelled
   * in the gap between the turn appearing and the fold landing: the carrier's
   * reconcile and the background's fold take a probe cycle each, while the Run's
   * watcher ticks faster than either.
   */
  it("tolerates exactly one turn while a reservation is claimed, and marks it provisional", () => {
    let state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued", 1);
    state = claim(state, "a", "op-a", RUN, 2, 4);
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)).toEqual({
      baseline: 4,
      expectedUserMessageCount: 5,
      provisional: true,
      ambiguous: false
    });
    // One turn, not two: the provisional tolerance never grows.
    expect(expectedUserTurnAccounting({ ...state, items: [...state.items, { ...state.items[0], itemId: "b", sequence: 9 }] }, RUN, CONVERSATION)?.expectedUserMessageCount).toBe(5);
  });

  it("promotes the tolerance to an earned delivery once acceptance is proven", () => {
    let state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued", 1);
    state = claim(state, "a", "op-a", RUN, 2, 4);
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)?.provisional).toBe(true);

    state = markDelivered(state, "op-a", 4, 3);
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)).toEqual({
      baseline: 4,
      expectedUserMessageCount: 5,
      provisional: false,
      ambiguous: false
    });
  });

  it("marks an ambiguous reservation as unattributable rather than proven", () => {
    let state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued", 1);
    state = claim(state, "a", "op-a", RUN, 2, 4);
    state = reduceOutboxQueue(state, { type: "record_submission", outcome: { operationId: "op-a", state: "UNCERTAIN", now: 3 } }).state;
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)).toEqual({
      baseline: 4,
      expectedUserMessageCount: 5,
      provisional: true,
      ambiguous: true
    });
  });

  it("counts only the delivered prefix, and tolerates one beyond it", () => {
    let state = deliveredQueue();
    // Item b is dispatching: item a's delivery is earned, b's turn is expected.
    state = claim(state, "b", "op-b", RUN, 5, 5);
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)).toEqual({
      baseline: 4,
      expectedUserMessageCount: 6,
      provisional: true,
      ambiguous: false
    });
  });

  it("says nothing about a Run epoch that owns no reservation", () => {
    const state = deliveredQueue();
    expect(expectedUserTurnAccounting(state, "some-other-run", CONVERSATION)).toBeUndefined();
    expect(expectedUserTurnAccounting(state, RUN, "other-conversation")).toBeUndefined();
    expect(hasOutstandingOutboxReservation(state, "some-other-run")).toBe(false);
  });

  it("reserves nothing for a delivery made while no Run was active", () => {
    // The reservation carries the epoch it answers to; without one there is no
    // expectation to grant, however the delivery later turns out.
    let state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued", 1);
    state = claim(state, "a", "op-a", undefined, 2);
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)).toBeUndefined();
  });

  /**
   * The counter-example the disposition asks for, in its stricter form: a failed
   * dispatch must not *leave* a loose `+1` behind. The tolerance it held while
   * unresolved is withdrawn the moment the item stops being a live reservation,
   * so a later genuine Human message has nothing to hide under.
   */
  it("leaves no loose +1 behind after a failed dispatch", () => {
    let state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued", 1);
    state = claim(state, "a", "op-a", RUN, 2, 4);
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)?.expectedUserMessageCount).toBe(5);

    // Proven not accepted: the item is released (or parked) and the tolerance goes
    // with the reservation.
    state = reduceOutboxQueue(state, { type: "record_submission", outcome: { operationId: "op-a", state: "FAILED_SAFE", baselineUserMessageCount: 4, now: 3 } }).state;
    state = reduceOutboxQueue(state, { type: "release_attempt", itemId: "a", reason: "PROVEN_NOT_ACCEPTED", now: 4 }).state;
    expect(state.items[0].state).toBe("QUEUED");
    expect(state.items[0].submissionOperationId).toBeUndefined();
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)).toBeUndefined();

    // And a Human message that arrived in the meantime now reads as one.
    expect(decideRunIntervention({ governedExpectedUserCount: 4, observedUserCount: 5, outbox: expectedUserTurnAccounting(state, RUN, CONVERSATION) }).verdict).toBe("HUMAN_INTERVENTION");
  });

  it("withdraws the tolerance when the reservation itself is retired", () => {
    let state = enqueue({ revision: 0, sequence: 0, paused: false, items: [] }, "a", "queued", 1);
    state = claim(state, "a", "op-a", RUN, 2, 4);
    // A reservation retired by authorized policy can never be satisfied, so it
    // must not go on holding an expectation for a turn that will never arrive.
    state = reduceOutboxQueue(state, { type: "record_submission", outcome: { operationId: "op-a", state: "CANCELLED", now: 3 } }).state;
    expect(state.items[0].state).toBe("BLOCKED");
    expect(expectedUserTurnAccounting(state, RUN, CONVERSATION)).toBeUndefined();
    expect(outboxQueueStatus(state)).toEqual({ kind: "WAIT", itemId: "a", reason: "attempt_failed" });
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
    state = claim(state, "a", "op-a", RUN, 2, 4);
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
