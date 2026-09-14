import { describe, expect, it } from "vitest";
import { ChildWorkerLedger, createChromeChildWorkerStore } from "../src/core/child-worker";
import { ResultDeliveryLedger, createChromeResultDeliveryStore, resultDeliveryKey } from "../src/core/result-delivery";
import { SubmissionOperationLedger, createChromeSubmissionStore, fingerprintSubmissionPayload, type SubmissionClaimContext, type SubmissionObservation } from "../src/core/submission-operation";
import { prepareChildDeliveryTransport } from "../src/core/deliver-child-result";
import { runChildDeliveryProbe } from "../src/background/delivery-runtime";

function harness() {
  const backing: Record<string, unknown> = {};
  const chromeStorage = {
    get: async (key: string) => ({ [key]: backing[key] }),
    set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
  };
  const deps = {
    children: new ChildWorkerLedger(createChromeChildWorkerStore(chromeStorage)),
    deliveries: new ResultDeliveryLedger(createChromeResultDeliveryStore(chromeStorage)),
    submissions: new SubmissionOperationLedger(createChromeSubmissionStore(chromeStorage, { claimViaCoordinator: false }))
  };
  const storage = {
    get: async (key: string) => ({ [key]: backing[key] }),
    set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
  } as unknown as Pick<chrome.storage.StorageArea, "get" | "set">;
  return { deps, storage, backing };
}

const WORK_ITEM = {
  activeWorkItemId: "work-1",
  workItems: [{
    workItemId: "work-1", primaryLogicalThreadId: "pdlt-l1", status: "ACTIVE",
    binding: { conversationId: "conv-l1", carrierRef: "browser-tab:5" }
  }]
};

function context(overrides: Partial<SubmissionClaimContext> = {}): SubmissionClaimContext {
  return {
    logicalThreadId: "pdlt-l1",
    providerConversationRef: "conv-l1",
    bindingEpoch: 3,
    leaseGeneration: 2,
    leaseOwnerRef: "obs-1",
    targetCarrierRef: "browser-tab:5",
    carrierState: "READY",
    logicalControl: "CONTINUE",
    explicitGo: true,
    sourceEpoch: 3,
    sourceObservedAt: 100,
    ...overrides
  };
}

const baseline = { routeRef: "/c/conv-l1", assistantMessageCount: 2, userMessageCount: 2, observedAt: 100 };
const payloadFingerprint = fingerprintSubmissionPayload("docs/memory.md");

async function seedResultReadyChild(deps: ReturnType<typeof harness>["deps"], parentThreadId = "pdlt-l1") {
  await deps.children.createIntent({
    childThreadId: "child-l2", parentThreadId, workItemId: "work-1",
    role: "Sedimentation / Memory Curator", creationMode: "FORKED",
    operationGoal: "preserve missing durable reasoning", operationScope: "do not continue the main design trajectory",
    returnRoute: `thread:${parentThreadId}`, now: 50
  });
  await deps.children.beginSpawn("child-l2", 60);
  await deps.children.bindConversation("child-l2", { providerConversationRef: "conv-child", carrierRef: "browser-tab:9" }, 70);
  await deps.children.activate("child-l2", 80);
  await deps.children.recordResult("child-l2", { resultRef: "docs/memory.md", completionReceipt: "rcpt-1" }, 90);
}

function observation(overrides: Partial<SubmissionObservation> = {}): SubmissionObservation {
  // Epoch-scale times: the runtime stamps claims with Date.now(), so evidence
  // must land after them for records and reconciliation to apply.
  const observedAt = Date.now() + 5_000;
  return {
    conversationRef: "conv-l1",
    routeRef: "/c/conv-l1",
    assistantMessageCount: 2,
    userMessageCount: 3,
    lastUserMessageFingerprint: payloadFingerprint,
    observedAt,
    stableSince: observedAt - 2_600,
    sourceEpoch: 3,
    generationActive: false,
    dispatchFence: {
      providerConversationRef: "conv-l1",
      bindingEpoch: 3,
      leaseGeneration: 2,
      leaseOwnerRef: "obs-1",
      targetCarrierRef: "browser-tab:5"
    },
    ...overrides
  };
}

describe("runChildDeliveryProbe", () => {
  it("resolves the parent via the work item binding and dispatches exactly once", async () => {
    const { deps, storage, backing } = harness();
    backing.noosWorkItemInbox = WORK_ITEM;
    await seedResultReadyChild(deps);
    await deps.deliveries.setWait("pdlt-l1", { kind: "WAIT_WORKER", childThreadId: "child-l2" }, 5);
    let dispatches = 0;
    const dispatch = async () => { dispatches += 1; return observation(); };

    const first = await runChildDeliveryProbe({ context: context(), baseline }, storage, deps, dispatch);
    expect(first).toMatchObject({ status: "OK", dispatched: 1 });
    expect(dispatches).toBe(1);
    const operation = (await deps.submissions.list())[0];
    expect(operation).toMatchObject({ operationKind: "DELIVER_CHILD_RESULT", state: "DISPATCHING", logicalThreadId: "pdlt-l1", payload: "docs/memory.md" });
    expect(operation.dispatchReceipt?.outcome).toBe("dispatched");

    const again = await runChildDeliveryProbe({ context: context(), baseline }, storage, deps, dispatch);
    expect(again.dispatched).toBe(0);
    expect(dispatches).toBe(1);
  });

  it("parks a lost acknowledgement as UNCERTAIN and refuses to re-dispatch", async () => {
    const { deps, storage, backing } = harness();
    backing.noosWorkItemInbox = WORK_ITEM;
    await seedResultReadyChild(deps);
    const dispatch = async () => { throw new Error("ack lost"); };
    const result = await runChildDeliveryProbe({ context: context(), baseline }, storage, deps, dispatch);
    expect(result.dispatched).toBe(0);
    const operation = (await deps.submissions.list())[0];
    expect(operation.state).toBe("UNCERTAIN");
    expect(operation.error).toBe("delivery_dispatch_uncertain");
    // Still execution-owning: a later probe must not claim or dispatch again.
    let redispatch = 0;
    const second = await runChildDeliveryProbe({ context: context(), baseline }, storage, deps, async () => { redispatch += 1; return observation(); });
    expect(second.dispatched).toBe(0);
    expect(redispatch).toBe(0);
  });

  it("recovers an UNCERTAIN transport into a closed delivery with the wait cleared", async () => {
    const { deps, storage, backing } = harness();
    backing.noosWorkItemInbox = WORK_ITEM;
    await seedResultReadyChild(deps);
    await deps.deliveries.setWait("pdlt-l1", { kind: "WAIT_WORKER", childThreadId: "child-l2" }, 5);
    await runChildDeliveryProbe({ context: context(), baseline }, storage, deps, async () => { throw new Error("ack lost"); });

    // A later probe with post-dispatch observations reconciles, mints, completes,
    // and closes the delivery — clearing the parent mechanical wait.
    const recovered = await runChildDeliveryProbe({
      context: context(),
      baseline: { ...baseline, observedAt: Date.now() + 6_000, userMessageCount: 3, lastUserMessageFingerprint: payloadFingerprint }
    }, storage, deps, async () => { throw new Error("must not redispatch"); });
    expect(recovered.closed).toBe(1);
    const operation = (await deps.submissions.list())[0];
    expect(operation.state).toBe("COMPLETED");
    const delivery = await deps.deliveries.getDelivery(resultDeliveryKey({ parentThreadId: "pdlt-l1", childThreadId: "child-l2", resultRef: "docs/memory.md" }));
    expect(delivery).toMatchObject({ receiptState: "COMPLETED", deliveredTo: "conv-l1" });
    expect(await deps.deliveries.getWait("pdlt-l1")).toBeUndefined();
  });

  it("re-fences a PREPARED transport whose execution instance went stale on the same conversation", async () => {
    const { deps, storage, backing } = harness();
    backing.noosWorkItemInbox = WORK_ITEM;
    await seedResultReadyChild(deps);
    // First probe dispatch throws before any receipt: transport is UNCERTAIN...
    // Instead simulate a crash between prepare and claim by dispatching nothing:
    // prepare the transport manually with the OLD instance's fence.
    const old = context({ leaseOwnerRef: "obs-old", leaseGeneration: 1, bindingEpoch: 2, sourceEpoch: 2 });
    await deps.submissions.initializeAuthority(old);
await prepareChildDeliveryTransport(deps, { childThreadId: "child-l2", destination: old, baseline, now: 100 });

    // The page reloaded: same conversation, fresh execution instance + generations.
    const fresh = context();
    let dispatches = 0;
    const result = await runChildDeliveryProbe({ context: fresh, baseline }, storage, deps, async () => { dispatches += 1; return observation(); });
    expect(result.dispatched).toBe(1);
    expect(dispatches).toBe(1);
    const operation = (await deps.submissions.list())[0];
    expect(operation.dispatchFence?.leaseOwnerRef).toBe("obs-1");
    expect(operation.state).toBe("DISPATCHING");
  });

  it("refuses to mint when the acceptance evidence carries a foreign user message", async () => {
    const { deps, storage, backing } = harness();
    backing.noosWorkItemInbox = WORK_ITEM;
    await seedResultReadyChild(deps);
    await runChildDeliveryProbe({ context: context(), baseline }, storage, deps, async () => { throw new Error("ack lost"); });
    // The operator typed an unrelated manual message: counts advanced but the
    // fingerprint is not the payload's — acceptance must not mint.
    const foreign = fingerprintSubmissionPayload("operator typed something else");
    const probe = await runChildDeliveryProbe({
      context: context(),
      baseline: { ...baseline, observedAt: Date.now() + 6_000, userMessageCount: 3, lastUserMessageFingerprint: foreign }
    }, storage, deps, async () => { throw new Error("must not redispatch"); });
    expect(probe.closed).toBe(0);
    const delivery = await deps.deliveries.getDelivery(resultDeliveryKey({ parentThreadId: "pdlt-l1", childThreadId: "child-l2", resultRef: "docs/memory.md" }));
    expect(delivery?.receiptState).toBeUndefined();
  });

  it("returns NO_ACTIVE_PARENT when no work item binding matches the carrier", async () => {
    const { deps, storage, backing } = harness();
    backing.noosWorkItemInbox = WORK_ITEM;
    await seedResultReadyChild(deps);
    const result = await runChildDeliveryProbe({ context: context({ targetCarrierRef: "browser-tab:99" }), baseline }, storage, deps, async () => observation());
    expect(result.status).toBe("NO_ACTIVE_PARENT");
    expect(await deps.submissions.list()).toEqual([]);
  });
});
