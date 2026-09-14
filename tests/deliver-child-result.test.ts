import { describe, expect, it } from "vitest";
import { ChildWorkerLedger, createChromeChildWorkerStore } from "../src/core/child-worker";
import { ResultDeliveryLedger, createChromeResultDeliveryStore } from "../src/core/result-delivery";
import { SubmissionOperationLedger, createChromeSubmissionStore, type SubmissionObservation } from "../src/core/submission-operation";
import {
  childDeliveryOperationId,
  mintInsertedOnAcceptance,
  openChildDelivery,
  prepareChildDeliveryTransport,
  type DeliveryTransportDependencies,
} from "../src/core/deliver-child-result";

function deps(): DeliveryTransportDependencies {
  const backing: Record<string, unknown> = {};
  const chromeStorage = {
    get: async (key: string) => ({ [key]: backing[key] }),
    set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
  };
  return {
    children: new ChildWorkerLedger(createChromeChildWorkerStore(chromeStorage)),
    deliveries: new ResultDeliveryLedger(createChromeResultDeliveryStore(chromeStorage)),
    submissions: new SubmissionOperationLedger(createChromeSubmissionStore(chromeStorage, { claimViaCoordinator: false }))
  };
}

const intent = {
  childThreadId: "child-l2",
  parentThreadId: "pdlt-l1",
  workItemId: "wi-1",
  role: "Sedimentation / Memory Curator",
  creationMode: "FORKED" as const,
  operationGoal: "preserve missing durable reasoning",
  operationScope: "do not continue the main design trajectory",
  returnRoute: "thread:pdlt-l1"
};

async function readyChild(d: DeliveryTransportDependencies) {
  await d.children.createIntent(intent);
  await d.children.beginSpawn("child-l2");
  await d.children.bindConversation("child-l2", { providerConversationRef: "conv-l2", carrierRef: "browser-tab:7" });
  await d.children.activate("child-l2");
  await d.children.recordResult("child-l2", { resultRef: "docs/memory.md", completionReceipt: "rcpt-1" });
}

const destination = {
  providerConversationRef: "conv-l1c",
  bindingEpoch: 3,
  leaseGeneration: 2,
  leaseOwnerRef: "obs-1",
  targetCarrierRef: "browser-tab:5",
  logicalThreadId: "pdlt-l1",
  carrierState: "READY" as const,
  logicalControl: "CONTINUE" as const,
  explicitGo: true,
  sourceEpoch: 3,
  sourceObservedAt: 100
};

const baseline = { routeRef: "/c/conv-l1c", assistantMessageCount: 4, userMessageCount: 4, observedAt: 100 };

describe("delivery operation identity", () => {
  it("derives a deterministic, separator-safe transport id", () => {
    const identity = { parentThreadId: "a:b", childThreadId: "c", resultRef: "r" };
    expect(childDeliveryOperationId(identity)).toBe(childDeliveryOperationId(identity));
    expect(childDeliveryOperationId(identity)).toMatch(/^deliver:c:[0-9a-f]+$/);
    // Field-boundary ambiguity hashes apart ("a:b>c>r" vs "a>b:c>r").
    expect(childDeliveryOperationId(identity))
      .not.toBe(childDeliveryOperationId({ parentThreadId: "a", childThreadId: "b:c", resultRef: "r" }));
  });
});

describe("open child delivery", () => {
  it("creates a receiptless index row while no safe carrier exists", async () => {
    const d = deps();
    await readyChild(d);
    const { child, delivery } = await openChildDelivery(d, { childThreadId: "child-l2" });
    expect(child.state).toBe("RESULT_READY");
    expect(delivery.receiptState).toBeUndefined();
    expect(delivery.submissionOperationId).toBe(childDeliveryOperationId({ parentThreadId: "pdlt-l1", childThreadId: "child-l2", resultRef: "docs/memory.md" }));
    // No transport was prepared: the ledger stays empty (PREPARED != INSERTED).
    expect(await d.submissions.list()).toEqual([]);
    const again = await openChildDelivery(d, { childThreadId: "child-l2" });
    expect(again.delivery).toEqual(delivery);
  });

  it("refuses a child without a result", async () => {
    const d = deps();
    await d.children.createIntent(intent);
    await expect(openChildDelivery(d, { childThreadId: "child-l2" })).rejects.toThrow("child_not_returnable:PLANNED");
  });
});

describe("prepare delivery transport", () => {
  it("prepares a fenced DELIVER_CHILD_RESULT on the submission ledger", async () => {
    const d = deps();
    await readyChild(d);
    const { delivery, operation } = await prepareChildDeliveryTransport(d, {
      childThreadId: "child-l2", destination, baseline
    });
    expect(operation).toMatchObject({
      operationId: delivery.submissionOperationId,
      operationKind: "DELIVER_CHILD_RESULT",
      state: "PREPARED",
      logicalThreadId: "pdlt-l1",
      providerConversationRef: "conv-l1c",
      targetCarrierRef: "browser-tab:5"
    });
    expect(operation.dispatchFence).toMatchObject({ bindingEpoch: 3, leaseGeneration: 2 });
    // Idempotent: re-preparing returns the same operation.
    const retry = await prepareChildDeliveryTransport(d, { childThreadId: "child-l2", destination, baseline });
    expect(retry.operation).toEqual(operation);
    expect(await d.submissions.list()).toHaveLength(1);
  });

  it("routes strictly to the parent logical thread", async () => {
    const d = deps();
    await readyChild(d);
    await expect(prepareChildDeliveryTransport(d, {
      childThreadId: "child-l2",
      destination: { ...destination, logicalThreadId: "other-thread" },
      baseline
    })).rejects.toThrow("delivery_route_mismatch:other-thread!=pdlt-l1");
  });
});

describe("mint INSERTED on acceptance", () => {
  it("refuses while the transport is only PREPARED or DISPATCHING", async () => {
    const d = deps();
    await readyChild(d);
    await expect(mintInsertedOnAcceptance(d, { childThreadId: "child-l2", deliveredTo: "conv-l1c" }))
      .rejects.toThrow("delivery_transport_not_prepared");
    await prepareChildDeliveryTransport(d, { childThreadId: "child-l2", destination, baseline });
    await expect(mintInsertedOnAcceptance(d, { childThreadId: "child-l2", deliveredTo: "conv-l1c" }))
      .rejects.toThrow("delivery_not_accepted:PREPARED");
    await d.submissions.initializeAuthority(destination);
    await d.submissions.claim(deliveryId(), destination, 200);
    await expect(mintInsertedOnAcceptance(d, { childThreadId: "child-l2", deliveredTo: "conv-l1c" }))
      .rejects.toThrow("delivery_not_accepted:DISPATCHING");
  });

  it("mints exactly once when reconciliation proves acceptance", async () => {
    const d = deps();
    await readyChild(d);
    await d.submissions.initializeAuthority(destination);
    await prepareChildDeliveryTransport(d, { childThreadId: "child-l2", destination, baseline });
    await d.submissions.claim(deliveryId(), destination, 200);
    const reconciled = await d.submissions.reconcile(deliveryId(), acceptanceObservation());
    expect(reconciled.outcome).toBe("PROVEN_ACCEPTED");
    const { delivery } = await mintInsertedOnAcceptance(d, { childThreadId: "child-l2", deliveredTo: "conv-l1c", now: 300 });
    expect(delivery).toMatchObject({ receiptState: "INSERTED", deliveredTo: "conv-l1c", submissionOperationId: deliveryId() });
    // Replay: idempotent, evidence preserved.
    const replay = await mintInsertedOnAcceptance(d, { childThreadId: "child-l2", deliveredTo: "ignored-on-replay", now: 400 });
    expect(replay.delivery).toEqual(delivery);
  });

  it("does not confuse COMPLETED transport with not-yet-inserted", async () => {
    const d = deps();
    await readyChild(d);
    await d.submissions.initializeAuthority(destination);
    await prepareChildDeliveryTransport(d, { childThreadId: "child-l2", destination, baseline });
    await d.submissions.claim(deliveryId(), destination, 200);
    await d.submissions.reconcile(deliveryId(), acceptanceObservation());
    await d.submissions.record(deliveryId(), "COMPLETED", { now: 2600 });
    // The transport moved past acceptance without minting: refuse rather than
    // back-fill a receipt from a stale window.
    await expect(mintInsertedOnAcceptance(d, { childThreadId: "child-l2", deliveredTo: "conv-l1c" }))
      .rejects.toThrow("delivery_not_accepted:COMPLETED");
  });
});

function deliveryId(): string {
  return childDeliveryOperationId({ parentThreadId: "pdlt-l1", childThreadId: "child-l2", resultRef: "docs/memory.md" });
}

function acceptanceObservation(): SubmissionObservation {
  return {
    conversationRef: "conv-l1c",
    routeRef: baseline.routeRef,
    assistantMessageCount: 4,
    userMessageCount: 5,
    observedAt: 2500,
    stableSince: 400,
    sourceEpoch: 3,
    generationActive: false,
    dispatchFence: {
      providerConversationRef: "conv-l1c",
      bindingEpoch: 3,
      leaseGeneration: 2,
      leaseOwnerRef: "obs-1",
      targetCarrierRef: "browser-tab:5"
    }
  };
}
