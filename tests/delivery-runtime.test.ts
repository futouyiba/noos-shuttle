import { describe, expect, it } from "vitest";
import { ChildWorkerLedger, createChromeChildWorkerStore } from "../src/core/child-worker";
import { ResultDeliveryLedger, createChromeResultDeliveryStore, resultDeliveryKey } from "../src/core/result-delivery";
import { SubmissionOperationLedger, createChromeSubmissionStore, fingerprintSubmissionPayload, type SubmissionClaimContext, type SubmissionObservation } from "../src/core/submission-operation";
import { prepareChildDeliveryTransport } from "../src/core/deliver-child-result";
import { ProviderExecutionJournal, createChromeExecutionJournalStore } from "../src/core/execution-journal";
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
  const journal = new ProviderExecutionJournal(createChromeExecutionJournalStore({
    get: async (key: string) => ({ [key]: backing[key] }),
    set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
  }));
  const storage = {
    get: async (key: string) => ({ [key]: backing[key] }),
    set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
  } as unknown as Pick<chrome.storage.StorageArea, "get" | "set">;
  return { deps: { ...deps, journal }, storage, backing, journal };
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
    const { deps, storage, backing, journal } = harness();
    backing.noosWorkItemInbox = WORK_ITEM;
    await seedResultReadyChild(deps);
    const dispatch = async () => { throw new Error("ack lost"); };
    const result = await runChildDeliveryProbe({ context: context(), baseline }, storage, deps, dispatch);
    expect(result.dispatched).toBe(0);
    // A lost acknowledgement records the attempt but never an ack.
    expect((await journal.list()).map(entry => entry.eventKind)).toEqual(["BLIND_DISPATCH_ATTEMPT"]);
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
    // Lifecycle §7: the closed delivery completes the child's return journey.
    expect((await deps.children.get("child-l2"))?.state).toBe("COMPLETED");
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

  it("records dispatch and settlement facts in the execution journal", async () => {
    const { deps, storage, backing, journal } = harness();
    backing.noosWorkItemInbox = WORK_ITEM;
    await seedResultReadyChild(deps);
    const first = await runChildDeliveryProbe({ context: context(), baseline }, storage, deps, async () => observation());
    expect(first.dispatched).toBe(1);
    expect((await journal.list()).map(entry => entry.eventKind)).toEqual(["BLIND_DISPATCH_ATTEMPT", "PROVIDER_ACK"]);
    const recovered = await runChildDeliveryProbe({
      context: context(),
      baseline: { ...baseline, observedAt: Date.now() + 6_000, userMessageCount: 3, lastUserMessageFingerprint: payloadFingerprint }
    }, storage, deps, async () => { throw new Error("must not redispatch"); });
    expect(recovered.closed).toBe(1);
    const kinds = (await journal.list()).map(entry => entry.eventKind);
    expect(kinds).toEqual(["BLIND_DISPATCH_ATTEMPT", "PROVIDER_ACK", "ACCEPTANCE_OBSERVED", "TURN_COMPLETION_OBSERVED"]);
    // Every entry is bound to the same operation and fence fingerprint.
    const entries = await journal.list();
    expect(new Set(entries.map(entry => entry.operationId)).size).toBe(1);
    expect(new Set(entries.map(entry => entry.dispatchFenceFingerprint)).size).toBe(1);
  });

  it("still mints when a later legitimate message overwrote the acceptance evidence", async () => {
    const { deps, storage, backing } = harness();
    backing.noosWorkItemInbox = WORK_ITEM;
    await seedResultReadyChild(deps);
    await deps.deliveries.setWait("pdlt-l1", { kind: "WAIT_WORKER", childThreadId: "child-l2" }, 5);
    // Ack lost: transport parks UNCERTAIN.
    await runChildDeliveryProbe({ context: context(), baseline }, storage, deps, async () => { throw new Error("ack lost"); });
    const operationId = (await deps.submissions.list())[0].operationId;
    // Acceptance is proven by the payload's own message (stamped)...
    await deps.submissions.reconcile(operationId, {
      ...baseline, conversationRef: "conv-l1",
      userMessageCount: 3, lastUserMessageFingerprint: payloadFingerprint,
      observedAt: Date.now() + 6_000, stableSince: Date.now() + 3_500, sourceEpoch: 3, generationActive: false,
      dispatchFence: (await deps.submissions.get(operationId))!.dispatchFence
    });
    // ...then the operator's follow-up message overwrites the evidence.
    await deps.submissions.reconcile(operationId, {
      ...baseline, conversationRef: "conv-l1",
      userMessageCount: 4, lastUserMessageFingerprint: fingerprintSubmissionPayload("follow-up message"),
      observedAt: Date.now() + 7_000, stableSince: Date.now() + 4_500, sourceEpoch: 3, generationActive: false,
      dispatchFence: (await deps.submissions.get(operationId))!.dispatchFence
    });
    // The minting probe still closes the delivery via the stamped proof.
    const probe = await runChildDeliveryProbe({
      context: context(),
      baseline: { ...baseline, observedAt: Date.now() + 8_000, userMessageCount: 4, lastUserMessageFingerprint: fingerprintSubmissionPayload("follow-up message") }
    }, storage, deps, async () => { throw new Error("must not redispatch"); });
    expect(probe.closed).toBe(1);
    const delivery = await deps.deliveries.getDelivery(resultDeliveryKey({ parentThreadId: "pdlt-l1", childThreadId: "child-l2", resultRef: "docs/memory.md" }));
    expect(delivery?.receiptState).toBe("COMPLETED");
    expect((await deps.children.get("child-l2"))?.state).toBe("COMPLETED");
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

  it("re-arms a FAILED_SAFE transport so the next probe can dispatch again", async () => {
    const { deps, storage, backing, journal } = harness();
    backing.noosWorkItemInbox = WORK_ITEM;
    await seedResultReadyChild(deps);
    // First attempt: ack lost -> UNCERTAIN.
    await runChildDeliveryProbe({ context: context(), baseline }, storage, deps, async () => { throw new Error("ack lost"); });
    const operationId = (await deps.submissions.list())[0].operationId;
    const fence = (await deps.submissions.get(operationId))!.dispatchFence!;
    // Quiet, unchanged, provider-failing observation proves not accepted.
    await deps.submissions.reconcile(operationId, {
      ...baseline, conversationRef: "conv-l1",
      observedAt: Date.now() + 4_000, sourceEpoch: 3, generationActive: false,
      providerFailure: true, dispatchFence: fence
    });
    expect((await deps.submissions.get(operationId))?.state).toBe("FAILED_SAFE");
    // The recovery probe re-arms with the fresh baseline (observedAt must be newer).
    const rearmed = await runChildDeliveryProbe({
      context: context(),
      baseline: { ...baseline, observedAt: Date.now() + 5_000 }
    }, storage, deps, async () => { throw new Error("not yet"); });
    expect(rearmed.dispatched).toBe(0);
    expect((await deps.submissions.get(operationId))?.state).toBe("PREPARED");
    // The next probe claims and dispatches again under the same identity.
    let dispatches = 0;
    const second = await runChildDeliveryProbe({
      context: context(),
      baseline: { ...baseline, observedAt: Date.now() + 6_000 }
    }, storage, deps, async () => { dispatches += 1; return observation(); });
    expect(second.dispatched).toBe(1);
    expect(dispatches).toBe(1);
    expect((await deps.submissions.list())).toHaveLength(1);
    // Intentional contract: a same-fence re-dispatch folds into the journal's
    // first entry (the idempotency key does not count attempts) — the fact
    // "an attempt happened under this fence" stays true and single.
    const kinds = (await journal.list()).map(entry => entry.eventKind).sort();
    expect(kinds).toEqual(["BLIND_DISPATCH_ATTEMPT", "PROVIDER_ACK"]);
  });

  it("escapes a FAILED_SAFE delivery whose destination rolled over before re-arm", async () => {
    const { deps, storage, backing } = harness();
    backing.noosWorkItemInbox = WORK_ITEM;
    await seedResultReadyChild(deps);
    // Attempt fails safe under the original destination.
    await runChildDeliveryProbe({ context: context(), baseline }, storage, deps, async () => { throw new Error("ack lost"); });
    const operationId = (await deps.submissions.list())[0].operationId;
    const fence = (await deps.submissions.get(operationId))!.dispatchFence!;
    await deps.submissions.reconcile(operationId, {
      ...baseline, conversationRef: "conv-l1",
      observedAt: Date.now() + 4_000, sourceEpoch: 3, generationActive: false,
      providerFailure: true, dispatchFence: fence
    });
    expect((await deps.submissions.get(operationId))?.state).toBe("FAILED_SAFE");
    // The parent rolled over before the re-arm probe arrived — the work item
    // binding moved with it (that binding is how the probe resolves the parent).
    const rolledOver = context({ providerConversationRef: "conv-l9", bindingEpoch: 4, leaseGeneration: 5, leaseOwnerRef: "obs-9", targetCarrierRef: "browser-tab:9", sourceEpoch: 4 });
    backing.noosWorkItemInbox = {
      activeWorkItemId: "work-1",
      workItems: [{ ...WORK_ITEM.workItems[0], binding: { conversationId: "conv-l9", carrierRef: "browser-tab:9" } }]
    };
    const escaped = await runChildDeliveryProbe({
      context: rolledOver,
      baseline: { ...baseline, routeRef: "/c/conv-l9", observedAt: Date.now() + 5_000 }
    }, storage, deps, async () => { throw new Error("not yet"); });
    expect(escaped.dispatched).toBe(0);
    const rearmed = await deps.submissions.get(operationId);
    expect(rearmed?.state).toBe("PREPARED");
    expect(rearmed?.providerConversationRef).toBe("conv-l9");
    expect(rearmed?.dispatchClaimedAt).toBeUndefined();
    expect(rearmed?.dispatchReceipt).toBeUndefined();
    // The next probe dispatches once under the rolled-over destination.
    let dispatches = 0;
    const second = await runChildDeliveryProbe({
      context: rolledOver,
      baseline: { ...baseline, routeRef: "/c/conv-l9", observedAt: Date.now() + 6_000 }
    }, storage, deps, async () => {
      dispatches += 1;
      return observation({
        conversationRef: "conv-l9", routeRef: "/c/conv-l9",
        dispatchFence: { providerConversationRef: "conv-l9", bindingEpoch: 4, leaseGeneration: 5, leaseOwnerRef: "obs-9", targetCarrierRef: "browser-tab:9" }
      });
    });
    expect(second.dispatched).toBe(1);
    expect(dispatches).toBe(1);
    expect((await deps.submissions.list())).toHaveLength(1);
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
