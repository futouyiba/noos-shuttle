import { describe, expect, it } from "vitest";
import { createOutboxClient, observationForGate } from "../src/content/outbox-client";
import { reduceOutboxQueue, type OutboxQueueState } from "../src/core/outbox-queue";
import type { CarrierObservation } from "../src/content/runtime-observer";
import type { HumanGoLedger } from "../src/core/human-go-runtime";
import type { SubmissionOperation, SubmissionReconcileResult } from "../src/core/submission-operation";

/**
 * The carrier-side probe loop, at the seam that issue #63 delta 3 runs through.
 *
 * The gate decides; the carrier acts on the decision. A decision the carrier
 * silently drops is indistinguishable from a decision the gate never made, and
 * that is exactly how the delivery loop was found closed nowhere: the gate
 * reported `RECONCILE`, the client only handled `DISPATCH`, and nothing ever
 * drove a reserved operation to a terminal state. These tests pin the carrier's
 * half of every status the gate can return.
 */

const CONVERSATION = "conversation:a";
const CARRIER_REF = "browser-tab:7";
const OBSERVER = "observer-abc";
const OP_ID = "outbox:item-1:r1:a1:deadbeef";

function observation(overrides: Partial<CarrierObservation> = {}): CarrierObservation {
  return {
    provider: "chatgpt",
    routeRef: "/c/conv-1",
    providerConversationRef: CONVERSATION,
    composerPresent: true,
    composerInteractive: true,
    stopGenerationControlPresent: false,
    assistantOutputMutating: false,
    assistantMessageCount: 1,
    userMessageCount: 5,
    providerErrorSurfacePresent: false,
    routeStable: true,
    carrierRef: CARRIER_REF,
    executionInstanceRef: OBSERVER,
    conversationIdentityState: "resolved",
    conversationIdentitySource: "provider-route",
    carrierIdentityState: "browser-tab",
    state: "READY",
    observedAt: 20_000,
    sourceEpoch: 3,
    quietSince: 15_000,
    errorSince: null,
    ...overrides
  };
}

function carrierOf(observation: CarrierObservation) {
  return {
    logicalThreadId: "t1",
    providerConversationRef: observation.providerConversationRef ?? "",
    bindingEpoch: observation.sourceEpoch,
    leaseGeneration: observation.sourceEpoch,
    leaseOwnerRef: observation.executionInstanceRef,
    targetCarrierRef: observation.carrierRef,
    carrierState: "READY" as const,
    logicalControl: "CONTINUE" as const,
    explicitGo: true,
    sourceEpoch: observation.sourceEpoch,
    sourceObservedAt: observation.observedAt
  };
}

function dispatchingQueue(): OutboxQueueState {
  const queued = reduceOutboxQueue(
    { revision: 0, sequence: 0, paused: false, items: [] },
    {
      type: "enqueue",
      input: { itemId: "item-1", logicalThreadId: "t1", providerConversationRef: CONVERSATION, payload: "queued message", now: 1 }
    }
  ).state;
  const item = queued.items[0];
  return reduceOutboxQueue(queued, {
    type: "claim_dispatch",
    itemId: "item-1",
    input: { operationId: OP_ID, reservation: { itemId: "item-1", revision: item.revision, submissionOperationId: OP_ID, runId: "bcr-run-1", expectedOperationKind: "OUTBOX_MESSAGE", observedUserMessageCount: 4 }, now: 1_000 }
  }).state;
}

function reservedOperation(state: SubmissionOperation["state"]): SubmissionOperation {
  return {
    operationId: OP_ID,
    operationKind: "OUTBOX_MESSAGE",
    workItemId: "shuttle-outbox",
    logicalThreadId: "t1",
    targetCarrierRef: CARRIER_REF,
    providerConversationRef: CONVERSATION,
    dispatchFence: {
      providerConversationRef: CONVERSATION,
      bindingEpoch: 3,
      leaseGeneration: 3,
      leaseOwnerRef: OBSERVER,
      targetCarrierRef: CARRIER_REF
    },
    payloadFingerprint: "deadbeef",
    payload: "queued message",
    preSubmitBaseline: {
      conversationRef: CONVERSATION, routeRef: "/c/conv-1", assistantMessageCount: 1, userMessageCount: 4, observedAt: 500
    },
    state,
    createdAt: 500,
    lastObservedAt: 1_000,
    ...(state === "PREPARED" ? {} : { dispatchClaimedAt: 1_000 })
  };
}

interface Harness {
  client: ReturnType<typeof createOutboxClient>;
  calls: string[];
  blocked: string[];
}

function harness(status: { kind: string; itemId?: string; operationId?: string }, queue: OutboxQueueState, operation?: SubmissionOperation): Harness {
  const calls: string[] = [];
  const blocked: string[] = [];
  const ledger: HumanGoLedger = {
    initializeAuthority: async () => { calls.push("initializeAuthority"); },
    prepare: async () => { calls.push("prepare"); throw new Error("prepare must not run on a reserved head"); },
    claim: async () => { calls.push("claim"); return undefined; },
    get: async () => { calls.push("get"); return operation; },
    record: async () => { calls.push("record"); return operation; },
    refuse: async () => { calls.push("refuse"); return operation; },
    reconcile: async (): Promise<SubmissionReconcileResult> => { calls.push("reconcile"); return { outcome: "STILL_AMBIGUOUS", operation }; }
  };
  const client = createOutboxClient({
    ledger,
    // The probe never actuates in these cases (every status here is a wait, a
    // reconcile, or a block), so the live read is only here to satisfy the seam.
    readLiveCarrier: () => ({ observation: observation(), carrier: carrierOf(observation()) }),
    sendMessage: async <TResponse,>() => ({ ok: true, status, queue }) as TResponse,
    readContext: observation => ({
      carrier: {
        logicalThreadId: "t1",
        providerConversationRef: observation.providerConversationRef ?? "",
        bindingEpoch: observation.sourceEpoch,
        leaseGeneration: observation.sourceEpoch,
        leaseOwnerRef: observation.executionInstanceRef,
        targetCarrierRef: observation.carrierRef,
        carrierState: "READY",
        logicalControl: "CONTINUE",
        explicitGo: true,
        sourceEpoch: observation.sourceEpoch,
        sourceObservedAt: observation.observedAt
      },
      composerEmpty: true,
      evidence: { lastUserMessageFingerprint: "deadbeef" }
    }),
    activeRunId: () => "bcr-run-1",
    onQueueChanged: () => undefined,
    onBlockedUncertain: item => { blocked.push(item.itemId); }
  });
  return { client, calls, blocked };
}

describe("the carrier consumes every decision the delivery gate can return", () => {
  it("RECONCILE drives the reserved operation to a terminal state", async () => {
    const queue = dispatchingQueue();
    const { client, calls } = harness({ kind: "RECONCILE", itemId: "item-1", operationId: OP_ID }, queue, reservedOperation("DISPATCHING"));
    await client.probe(observation());
    // The whole point: the reserved operation is looked up and reconciled, and
    // nothing is prepared or claimed again.
    expect(calls).toContain("reconcile");
    expect(calls).not.toContain("prepare");
    expect(calls).not.toContain("claim");
    expect(calls).not.toContain("initializeAuthority");
  });

  it("RECONCILE still settles a reservation that already proved acceptance", async () => {
    const queue = dispatchingQueue();
    const { client, calls } = harness(
      { kind: "RECONCILE", itemId: "item-1", operationId: OP_ID },
      queue,
      { ...reservedOperation("OBSERVED_ACCEPTED"), acceptedPayloadFingerprint: "deadbeef" }
    );
    await client.probe(observation());
    // Acceptance is already proven, so this pass also settles the operation —
    // the transition that stops it owning execution and unblocks later sends.
    expect(calls).toEqual(["get", "reconcile", "record"]);
  });

  it("a reservation that is not the outbox's is left alone", async () => {
    const queue = dispatchingQueue();
    const { client, calls } = harness(
      { kind: "RECONCILE", itemId: "item-1", operationId: OP_ID },
      queue,
      { ...reservedOperation("DISPATCHING"), operationKind: "GO" }
    );
    await client.probe(observation());
    expect(calls).toEqual(["get"]);
  });

  it("DISPATCHING is a wait: an in-flight reservation is not disturbed", async () => {
    const { client, calls } = harness({ kind: "DISPATCHING", itemId: "item-1", operationId: OP_ID }, dispatchingQueue(), reservedOperation("DISPATCHING"));
    await client.probe(observation());
    expect(calls).toEqual([]);
  });

  it("BLOCKED_UNCERTAIN surfaces the head and touches nothing", async () => {
    const { client, calls, blocked } = harness({ kind: "BLOCKED_UNCERTAIN", itemId: "item-1" }, dispatchingQueue(), reservedOperation("UNCERTAIN"));
    await client.probe(observation());
    expect(calls).toEqual([]);
    expect(blocked).toEqual(["item-1"]);
  });

  it("WAIT touches nothing and keeps the queue visible", async () => {
    const { client, calls } = harness({ kind: "WAIT", itemId: "item-1" }, dispatchingQueue());
    await client.probe(observation());
    expect(calls).toEqual([]);
    expect(client.status()).toEqual({ kind: "DISPATCHING", itemId: "item-1" });
  });

  it("adopts the queue the gate reports, so the surface reflects the durable store", async () => {
    const queue = dispatchingQueue();
    const { client } = harness({ kind: "WAIT", itemId: "item-1" }, queue);
    await client.probe(observation());
    expect(client.queue().items[0].submissionOperationId).toBe(OP_ID);
    expect(client.queue().items[0].reservationRunId).toBe("bcr-run-1");
  });
});

describe("the gate observation the carrier sends", () => {
  it("carries the conservative reading of every field the gate reads", () => {
    const gate = observationForGate(observation(), false);
    expect(gate.composerEmpty).toBe(false);
    expect(gate.quietSince).toBe(15_000);
    expect(gate.assistantOutputMutating).toBe(false);
    expect(gate.stopGenerationControlPresent).toBe(false);
    expect(gate.state).toBe("READY");
  });

  it("reports a missing observation stamp as absent rather than as zero", () => {
    const gate = observationForGate(observation({ quietSince: null }), true);
    expect(gate.quietSince).toBeUndefined();
    expect(gate.composerEmpty).toBe(true);
  });
});

describe("outbox storage integration", () => {
  it("adopts a raw stored queue through the same normalization the store uses", () => {
    const queue = dispatchingQueue();
    let adopted: OutboxQueueState | undefined;
    const client = createOutboxClient({
      readLiveCarrier: () => ({ observation: observation(), carrier: carrierOf(observation()) }),
      ledger: {
        initializeAuthority: async () => undefined,
        prepare: async () => { throw new Error("unused"); },
        claim: async () => undefined,
        get: async () => undefined,
        record: async () => undefined,
        refuse: async () => undefined,
        reconcile: async () => ({ outcome: "STILL_AMBIGUOUS" })
      },
      sendMessage: async () => undefined,
      readContext: () => ({
        carrier: {
          logicalThreadId: "t1", providerConversationRef: CONVERSATION, bindingEpoch: 3, leaseGeneration: 3,
          leaseOwnerRef: OBSERVER, targetCarrierRef: CARRIER_REF, carrierState: "READY", logicalControl: "CONTINUE",
          explicitGo: true, sourceEpoch: 3, sourceObservedAt: 1_000
        },
        composerEmpty: true,
        evidence: {}
      }),
      activeRunId: () => undefined,
      onQueueChanged: next => { adopted = next; }
    });
    client.adopt(queue);
    expect(adopted?.items).toHaveLength(1);
    expect(adopted?.items[0].itemId).toBe("item-1");
  });
});
