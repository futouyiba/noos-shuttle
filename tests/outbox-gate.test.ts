import { describe, expect, it } from "vitest";
import {
  OUTBOX_EXTRA_QUIET_MS,
  OUTBOX_RECONCILE_GRACE_MS,
  classifyOutboxHead,
  hasExecutionInFlight,
  type OutboxGateCarrier,
  type OutboxGateObservation,
  type OutboxProbeInput
} from "../src/background/outbox-gate";
import {
  OUTBOX_MAX_ATTEMPTS,
  reduceOutboxQueue,
  type OutboxQueueState
} from "../src/core/outbox-queue";
import type { SubmissionAuthority, SubmissionOperation, SubmissionOperationKind } from "../src/core/submission-operation";

const NOW = 1_000_000;
const CONVERSATION = "conv-1";
const THREAD = `thread:${CONVERSATION}`;
const CARRIER_REF = "browser-tab:7";
const OBSERVER = "observer-abc";

function carrier(overrides: Partial<OutboxGateCarrier> = {}): OutboxGateCarrier {
  return {
    logicalThreadId: THREAD,
    providerConversationRef: CONVERSATION,
    bindingEpoch: 3,
    leaseGeneration: 3,
    leaseOwnerRef: OBSERVER,
    targetCarrierRef: CARRIER_REF,
    carrierState: "READY",
    logicalControl: "CONTINUE",
    explicitGo: true,
    sourceEpoch: 3,
    sourceObservedAt: NOW - 10_000,
    ...overrides
  };
}

function observation(overrides: Partial<OutboxGateObservation> = {}): OutboxGateObservation {
  return {
    state: "READY",
    carrierIdentityState: "browser-tab",
    providerConversationRef: CONVERSATION,
    routeRef: "/c/conv-1",
    observedAt: NOW,
    sourceEpoch: 3,
    quietSince: NOW - OUTBOX_EXTRA_QUIET_MS - 1,
    assistantOutputMutating: false,
    stopGenerationControlPresent: false,
    providerErrorSurfacePresent: false,
    composerPresent: true,
    composerInteractive: true,
    composerEmpty: true,
    ...overrides
  };
}

function authority(overrides: Partial<SubmissionAuthority> = {}): SubmissionAuthority {
  return { ...carrier(), authorityGeneration: 1, authorityEstablishedAt: NOW - 10_000, ...overrides };
}

function operation(kind: SubmissionOperationKind, state: SubmissionOperation["state"], id: string): SubmissionOperation {
  return {
    operationId: id,
    operationKind: kind,
    workItemId: "shuttle-outbox",
    logicalThreadId: THREAD,
    targetCarrierRef: CARRIER_REF,
    providerConversationRef: CONVERSATION,
    payloadFingerprint: "abcdef",
    payload: "queued message",
    preSubmitBaseline: { conversationRef: CONVERSATION, routeRef: "/c/conv-1", assistantMessageCount: 1, userMessageCount: 4, observedAt: NOW - 5_000 },
    state,
    createdAt: NOW - 5_000,
    lastObservedAt: NOW - 5_000,
    ...(state === "DISPATCHING" ? { dispatchClaimedAt: NOW - 5_000 } : {})
  };
}

function queued(payload = "queued message"): OutboxQueueState {
  return reduceOutboxQueue(
    { revision: 0, sequence: 0, paused: false, items: [] },
    {
      type: "enqueue",
      input: { itemId: "item-1", logicalThreadId: THREAD, providerConversationRef: CONVERSATION, payload, now: NOW - 1_000 }
    }
  ).state;
}

function claimed(operationId = "op-1", since = NOW - 1_000): OutboxQueueState {
  const state = queued();
  const item = state.items[0];
  return reduceOutboxQueue(state, {
    type: "claim_dispatch",
    itemId: "item-1",
    input: { operationId, reservation: { itemId: "item-1", revision: item.revision, submissionOperationId: operationId, expectedOperationKind: "OUTBOX_MESSAGE" }, now: since }
  }).state;
}

function input(overrides: Partial<OutboxProbeInput> = {}): OutboxProbeInput {
  return {
    queue: queued(),
    carrier: carrier(),
    observation: observation(),
    ledgers: { authority: authority(), executionInFlight: false, operations: [] },
    runId: "bcr-run-1",
    ...overrides
  };
}

const deps = { maxAttempts: OUTBOX_MAX_ATTEMPTS, mintOperationId: () => "op-minted", now: NOW };

describe("outbox delivery gate (#63 delta 6)", () => {
  it("authorizes the head only when every conservative condition holds at once", () => {
    const decision = classifyOutboxHead(input().queue.items[0], input(), NOW, deps);
    expect(decision).toEqual({ kind: "DISPATCH", itemId: "item-1", operationId: "op-minted", head: expect.anything() });
  });

  it("waits rather than delivering into another conversation", () => {
    // The carrier is showing a different conversation entirely.
    expect(classifyOutboxHead(queued().items[0], input({ observation: observation({ providerConversationRef: "conv-2" }) }), NOW, deps))
      .toEqual({ kind: "WAIT", itemId: "item-1", reason: "conversation_absent" });
    // The conversation is not resolved at all (route still settling).
    expect(classifyOutboxHead(queued().items[0], input({ observation: observation({ providerConversationRef: undefined }) }), NOW, deps))
      .toEqual({ kind: "WAIT", itemId: "item-1", reason: "conversation_absent" });
    // A different carrier's context: same conversation, but this tab is not it.
    expect(classifyOutboxHead(queued().items[0], input({ carrier: carrier({ providerConversationRef: "conv-2" }) }), NOW, deps))
      .toEqual({ kind: "WAIT", itemId: "item-1", reason: "conversation_absent" });
  });

  it("requires the same-thread actuation lease, not merely a ready carrier", () => {
    const foreign = input({ ledgers: { authority: authority({ leaseOwnerRef: "observer-other" }), executionInFlight: false, operations: [] } });
    expect(classifyOutboxHead(queued().items[0], foreign, NOW, deps)).toEqual({ kind: "WAIT", itemId: "item-1", reason: "lease_not_held" });

    const absent = input({ ledgers: { authority: undefined, executionInFlight: false, operations: [] } });
    expect(classifyOutboxHead(queued().items[0], absent, NOW, deps)).toEqual({ kind: "WAIT", itemId: "item-1", reason: "lease_not_held" });

    // A lease that names another carrier in the same thread is also not ours.
    const otherCarrier = input({ ledgers: { authority: authority({ targetCarrierRef: "browser-tab:9" }), executionInFlight: false, operations: [] } });
    expect(classifyOutboxHead(queued().items[0], otherCarrier, NOW, deps)).toEqual({ kind: "WAIT", itemId: "item-1", reason: "lease_not_held" });
  });

  it("never overwrites a composer that holds a draft", () => {
    const busy = input({ observation: observation({ composerEmpty: false }) });
    expect(classifyOutboxHead(queued().items[0], busy, NOW, deps)).toEqual({ kind: "WAIT", itemId: "item-1", reason: "composer_not_empty" });
  });

  it("treats instantaneous READY as insufficient", () => {
    // READY right now, but the quiet window only just started.
    const fresh = input({ observation: observation({ quietSince: NOW - 10 }) });
    expect(classifyOutboxHead(queued().items[0], fresh, NOW, deps)).toEqual({ kind: "WAIT", itemId: "item-1", reason: "carrier_not_ready" });
    // No quiet anchor at all: the observation layer has not certified stability.
    const unanchored = input({ observation: observation({ quietSince: undefined }) });
    expect(classifyOutboxHead(queued().items[0], unanchored, NOW, deps)).toEqual({ kind: "WAIT", itemId: "item-1", reason: "carrier_not_ready" });
    // Quiet long enough by the clock, but the assistant output moved inside it.
    const mutating = input({ observation: observation({ quietSince: NOW - OUTBOX_EXTRA_QUIET_MS - 1, assistantOutputMutating: true }) });
    expect(classifyOutboxHead(queued().items[0], mutating, NOW, deps)).toEqual({ kind: "WAIT", itemId: "item-1", reason: "carrier_not_ready" });
    // A live stop control means the provider is still working.
    const generating = input({ observation: observation({ quietSince: NOW - OUTBOX_EXTRA_QUIET_MS - 1, stopGenerationControlPresent: true }) });
    expect(classifyOutboxHead(queued().items[0], generating, NOW, deps)).toEqual({ kind: "WAIT", itemId: "item-1", reason: "carrier_not_ready" });
    // And the coarse state still has to say READY.
    const notReady = input({ observation: observation({ state: "GENERATING" }) });
    expect(classifyOutboxHead(queued().items[0], notReady, NOW, deps)).toEqual({ kind: "WAIT", itemId: "item-1", reason: "carrier_not_ready" });
  });

  it("waits while an execution-owning operation already holds the target", () => {
    const inFlight = input({ ledgers: { authority: authority(), executionInFlight: true, operations: [] } });
    expect(classifyOutboxHead(queued().items[0], inFlight, NOW, deps)).toEqual({ kind: "WAIT", itemId: "item-1", reason: "submission_in_flight" });
  });

  it("lets the Human's pause stop the queue without touching any item", () => {
    const paused = { ...queued(), paused: true };
    expect(classifyOutboxHead(paused.items[0], input({ queue: paused }), NOW, deps)).toEqual({ kind: "WAIT", itemId: "item-1", reason: "paused" });
    expect(paused.items[0].state).toBe("QUEUED");
  });
});

describe("outbox reserved head (#63 delta 7)", () => {
  it("blocks head of line when the reserved dispatch is ambiguous", () => {
    const state = claimed("op-1");
    const ledgers = { authority: authority(), executionInFlight: true, operations: [operation("OUTBOX_MESSAGE", "UNCERTAIN", "op-1")] };
    expect(classifyOutboxHead(state.items[0], input({ queue: state, ledgers }), NOW, deps))
      .toEqual({ kind: "BLOCKED_UNCERTAIN", itemId: "item-1" });
  });

  it("blocks when the reservation's operation cannot be found at all", () => {
    const state = claimed("op-missing");
    expect(classifyOutboxHead(state.items[0], input({ queue: state }), NOW, deps))
      .toEqual({ kind: "BLOCKED_UNCERTAIN", itemId: "item-1" });
  });

  it("asks for reconciliation once a claimed operation leaves execution", () => {
    const state = claimed("op-1", NOW - OUTBOX_RECONCILE_GRACE_MS - 1);
    for (const state_ of ["FAILED_SAFE", "CANCELLED"] as const) {
      const ledgers = { authority: authority(), executionInFlight: false, operations: [operation("OUTBOX_MESSAGE", state_, "op-1")] };
      expect(classifyOutboxHead(state.items[0], input({ queue: state, ledgers }), NOW, deps))
        .toEqual({ kind: "RECONCILE", itemId: "item-1", operationId: "op-1" });
    }
  });

  it("lets the carrier re-claim a reservation whose claim never actuated", () => {
    const state = claimed("op-1");
    const ledgers = { authority: authority(), executionInFlight: false, operations: [operation("OUTBOX_MESSAGE", "PREPARED", "op-1")] };
    expect(classifyOutboxHead(state.items[0], input({ queue: state, ledgers }), NOW, deps))
      .toEqual({ kind: "RECONCILE", itemId: "item-1", operationId: "op-1" });
  });

  it("gives a fresh claim its grace period before asking for reconciliation", () => {
    const state = claimed("op-1", NOW - 100);
    const ledgers = { authority: authority(), executionInFlight: true, operations: [operation("OUTBOX_MESSAGE", "DISPATCHING", "op-1")] };
    expect(classifyOutboxHead(state.items[0], input({ queue: state, ledgers }), NOW, deps))
      .toEqual({ kind: "DISPATCHING", itemId: "item-1", operationId: "op-1" });
  });

  it("reconciles a delivered-but-unfolded head rather than dispatching again", () => {
    const state = claimed("op-1", NOW - OUTBOX_RECONCILE_GRACE_MS - 1);
    const ledgers = { authority: authority(), executionInFlight: true, operations: [operation("OUTBOX_MESSAGE", "OBSERVED_ACCEPTED", "op-1")] };
    expect(classifyOutboxHead(state.items[0], input({ queue: state, ledgers }), NOW, deps))
      .toEqual({ kind: "RECONCILE", itemId: "item-1", operationId: "op-1" });
  });

  it("does not let a GO operation satisfy an outbox reservation", () => {
    const state = claimed("op-1");
    const ledgers = { authority: authority(), executionInFlight: true, operations: [operation("GO", "DISPATCHING", "op-1")] };
    expect(classifyOutboxHead(state.items[0], input({ queue: state, ledgers }), NOW, deps))
      .toEqual({ kind: "BLOCKED_UNCERTAIN", itemId: "item-1" });
  });
});

describe("retiring an ambiguous reservation unblocks later dispatches (#92 review F2)", () => {
  /**
   * `hasExecutionInFlight` is why the retire step exists at all: while the
   * operation behind an UNCERTAIN item stays execution-owning, no later item
   * can be dispatched to that target. Cancelling the queue item alone —
   * without retiring the operation — would leave exactly that wedge behind.
   */
  const op = (state: SubmissionOperation["state"]): SubmissionOperation =>
    operation("OUTBOX_MESSAGE", state, "op-a");

  it("counts an UNCERTAIN operation as holding the target", () => {
    expect(hasExecutionInFlight([op("UNCERTAIN")], carrier())).toBe(true);
  });

  it("stops counting it once retired to CANCELLED", () => {
    expect(hasExecutionInFlight([op("CANCELLED")], carrier())).toBe(false);
  });

  it("still counts operations that genuinely own execution", () => {
    expect(hasExecutionInFlight([op("DISPATCHING")], carrier())).toBe(true);
    expect(hasExecutionInFlight([op("OBSERVED_ACCEPTED")], carrier())).toBe(true);
  });

  it("ignores operations on another target", () => {
    const foreign = { ...op("UNCERTAIN"), targetCarrierRef: "browser-tab:9" };
    expect(hasExecutionInFlight([foreign], carrier())).toBe(false);
  });
});
