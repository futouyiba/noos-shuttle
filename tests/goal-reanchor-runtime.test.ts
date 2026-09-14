import { describe, expect, it } from "vitest";
import { runGoalReanchorProbe } from "../src/background/goal-reanchor-runtime";
import { createChromeSubmissionStore, fingerprintSubmissionPayload, SubmissionOperationLedger, type SubmissionClaimContext, type SubmissionOperation } from "../src/core/submission-operation";

function memoryStorage(initial: Record<string, unknown> = {}) {
  const backing: Record<string, any> = structuredClone(initial);
  return {
    backing,
    storage: {
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (data: Record<string, unknown>) => { Object.assign(backing, structuredClone(data)); }
    } as unknown as chrome.storage.StorageArea
  };
}

function workItemInbox(conversationId: string, carrierRef: string) {
  return { activeWorkItemId: "w", workItems: [{ workItemId: "w", primaryLogicalThreadId: "t", status: "ACTIVE",
    goal: "Goal", scope: "Scope", binding: { conversationId, carrierRef } }] };
}

function anchorSeed(experimentalN: number) {
  return { goal: "Goal", scope: "Scope",
    state: { version: 1, logicalThreadId: "t", experimentalN, anchorRevision: 0, designTurnsSinceAnchor: 0,
      completedGenerationIds: [], operations: {} } };
}

function claimContext(overrides: Partial<SubmissionClaimContext> = {}): SubmissionClaimContext {
  return { logicalThreadId: "t", providerConversationRef: "c1", targetCarrierRef: "browser-tab:1",
    bindingEpoch: 1, leaseGeneration: 1, leaseOwnerRef: "owner", explicitGo: true,
    carrierState: "READY", logicalControl: "CONTINUE", sourceEpoch: 1, sourceObservedAt: 10, ...overrides };
}

function baseline(overrides: Record<string, unknown> = {}) {
  return { conversationRef: "c1", routeRef: "/c/c1", assistantMessageCount: 1, userMessageCount: 1,
    lastAssistantMessageFingerprint: "old", observedAt: 10, ...overrides };
}

async function completePrimaryGo(submissions: SubmissionOperationLedger, context: SubmissionClaimContext, base: ReturnType<typeof baseline>) {
  await submissions.initializeAuthority(context);
  await submissions.prepare({ operationId: "design-1", operationKind: "GO", workItemId: "w", logicalThreadId: "t",
    targetCarrierRef: context.targetCarrierRef, providerConversationRef: context.providerConversationRef,
    dispatchFence: context, payload: "continue", payloadFingerprint: fingerprintSubmissionPayload("continue"),
    preSubmitBaseline: base, now: 10 });
  await submissions.claim("design-1", context, 10);
  await submissions.reconcile("design-1", { ...base, assistantMessageCount: 2, userMessageCount: 2,
    lastAssistantMessageFingerprint: "new", lastUserMessageFingerprint: fingerprintSubmissionPayload("continue"),
    observedAt: 5010, stableSince: 10, sourceEpoch: 1, generationActive: false, dispatchFence: context });
  await submissions.record("design-1", "COMPLETED", { now: 5010 });
}

describe("production goal completion authority", () => {
  it("counts a completed primary GO, rejects an unfinished GO, and preserves uncertain anchor identity on recovery", async () => {
    const { backing, storage } = memoryStorage({
      noosWorkItemInbox: workItemInbox("c1", "browser-tab:1"),
      noosGoalReanchors: { t: anchorSeed(1) }
    });
    const submissions = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { claimViaCoordinator: false, lock: async work => work() }));
    const context: SubmissionClaimContext = claimContext();
    const base = baseline();
    await submissions.initializeAuthority(context);
    await submissions.prepare({ operationId: "design-1", operationKind: "GO", workItemId: "w", logicalThreadId: "t",
      targetCarrierRef: context.targetCarrierRef, providerConversationRef: context.providerConversationRef,
      dispatchFence: context, payload: "continue", payloadFingerprint: fingerprintSubmissionPayload("continue"),
      preSubmitBaseline: base, now: 10 });
    await submissions.claim("design-1", context, 10);
    let dispatched = 0;
    const dispatch = async () => { dispatched++; throw new Error("provider acknowledgement lost"); };
    // The claimed but unfinished GO cannot advance the counter.
    await runGoalReanchorProbe({ context, baseline: base }, storage, submissions, dispatch);
    expect(backing.noosGoalReanchors.t.state.designTurnsSinceAnchor).toBe(0);
    await submissions.reconcile("design-1", { ...base, assistantMessageCount: 2, userMessageCount: 2,
      lastAssistantMessageFingerprint: "new", lastUserMessageFingerprint: fingerprintSubmissionPayload("continue"),
      observedAt: 5010, stableSince: 10, sourceEpoch: 1, generationActive: false, dispatchFence: context });
    expect((await submissions.record("design-1", "COMPLETED", { now: 5010 }))?.state).toBe("COMPLETED");
    const probe = { context: { ...context, sourceObservedAt: 6010 }, baseline: { ...base, observedAt: 6010 } };
    await runGoalReanchorProbe(probe, storage, submissions, dispatch);
    expect(backing.noosGoalReanchors.t.state.designTurnsSinceAnchor).toBe(1);
    expect(dispatched).toBe(1);
    await runGoalReanchorProbe(probe, storage, submissions, dispatch);
    expect(dispatched).toBe(1);
    expect((await submissions.list()).filter(operation => operation.operationKind === "REANCHOR_GOAL")).toHaveLength(1);
    expect(backing.noosGoalReanchors.t.state.completedGenerationIds).toEqual(["design-1"]);
    // The uncertain transport is binding-scoped and recorded durably; a later
    // probe fails closed on it instead of silently retrying.
    const pending = backing.noosGoalReanchors.t.state.operations["reanchor:t:1"];
    expect(pending.submissionOperationId).toMatch(/^reanchor:t:1:c1:browser-tab:1:/);
    expect((await submissions.get(pending.submissionOperationId))?.state).toBe("UNCERTAIN");
    const blocked = await runGoalReanchorProbe(probe, storage, submissions, dispatch);
    expect(blocked).toMatchObject({ status: "RECONCILE_REQUIRED", submissionState: "UNCERTAIN" });
    expect(dispatched).toBe(1);
  });

  it("triggers a rollover anchor below N against the new binding and resets only after completion", async () => {
    const { backing, storage } = memoryStorage({ noosWorkItemInbox: workItemInbox("c1", "browser-tab:1") });
    const submissions = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { claimViaCoordinator: false, lock: async work => work() }));
    let dispatched = 0;
    const dispatch = async () => { dispatched += 1; throw new Error("no dispatch below N"); };
    // Stable binding below experimental N: no anchor is raised.
    await runGoalReanchorProbe({ context: claimContext(), baseline: baseline() }, storage, submissions, dispatch);
    expect(dispatched).toBe(0);
    expect(backing.noosGoalReanchors.t.state.operations).toEqual({});
    expect(backing.noosGoalReanchors.t.binding).toEqual({ conversationId: "c1", carrierRef: "browser-tab:1" });

    // Durable rollover: the Work Item binding commits to a new conversation.
    backing.noosWorkItemInbox.workItems[0].binding = { conversationId: "c2", carrierRef: "browser-tab:2" };
    const rolled = claimContext({ providerConversationRef: "c2", targetCarrierRef: "browser-tab:2", sourceObservedAt: 100 });
    const dispatchRolled = async (operation: SubmissionOperation) => {
      dispatched += 1;
      return { routeRef: "/c/c2", conversationRef: "c2", assistantMessageCount: 2, userMessageCount: 2,
        headFingerprint: "h2", observedAt: 2200, sourceEpoch: 1, stableSince: 100, generationActive: false,
        lastUserMessageFingerprint: fingerprintSubmissionPayload(operation.payload!),
        dispatchFence: operation.dispatchFence! };
    };
    await runGoalReanchorProbe({ context: rolled, baseline: baseline({ conversationRef: "c2", routeRef: "/c/c2", observedAt: 100 }) },
      storage, submissions, dispatchRolled);
    expect(dispatched).toBe(1);
    const record = backing.noosGoalReanchors.t;
    expect(record.state).toMatchObject({ anchorRevision: 1, designTurnsSinceAnchor: 0 });
    expect(record.state.operations["reanchor:t:1"]).toMatchObject({ trigger: "rollover", status: "COMPLETED" });
    const submissionOperationId = record.state.operations["reanchor:t:1"].submissionOperationId!;
    expect(submissionOperationId).toMatch(/^reanchor:t:1:c2:browser-tab:2:/);
    expect(await submissions.get(submissionOperationId)).toMatchObject({ state: "COMPLETED", providerConversationRef: "c2" });
    expect(record.binding).toEqual({ conversationId: "c2", carrierRef: "browser-tab:2" });

    // The rollover signal is one-shot: a stable follow-up probe stays idle.
    await runGoalReanchorProbe({ context: claimContext({ providerConversationRef: "c2", targetCarrierRef: "browser-tab:2", sourceObservedAt: 300 }),
      baseline: baseline({ conversationRef: "c2", routeRef: "/c/c2", observedAt: 300 }) }, storage, submissions, dispatchRolled);
    expect(dispatched).toBe(1);
  });

  it("blocks rollover supersession while the pending transport is uncertain, then supersedes after proven non-acceptance", async () => {
    const { backing, storage } = memoryStorage({
      noosWorkItemInbox: workItemInbox("c1", "browser-tab:1"),
      noosGoalReanchors: { t: anchorSeed(1) }
    });
    const submissions = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { claimViaCoordinator: false, lock: async work => work() }));
    const context = claimContext();
    const base = baseline();
    await completePrimaryGo(submissions, context, base);
    let dispatched = 0;
    const failing = async () => { dispatched += 1; throw new Error("provider acknowledgement lost"); };
    await runGoalReanchorProbe({ context, baseline: base }, storage, submissions, failing);
    expect(dispatched).toBe(1);
    const oldSubmissionId = backing.noosGoalReanchors.t.state.operations["reanchor:t:1"].submissionOperationId!;
    expect((await submissions.get(oldSubmissionId))?.state).toBe("UNCERTAIN");

    // Rollover while the old transport still owns execution: fail closed.
    backing.noosWorkItemInbox.workItems[0].binding = { conversationId: "c2", carrierRef: "browser-tab:2" };
    const rolled = claimContext({ providerConversationRef: "c2", targetCarrierRef: "browser-tab:2", sourceObservedAt: 200 });
    const blocked = await runGoalReanchorProbe({ context: rolled, baseline: baseline({ conversationRef: "c2", routeRef: "/c/c2", observedAt: 200 }) },
      storage, submissions, failing);
    expect(blocked).toMatchObject({ status: "RECONCILE_REQUIRED", submissionState: "UNCERTAIN" });
    expect(dispatched).toBe(1);

    // Explicit provider failure evidence proves the old transport never landed.
    const old = (await submissions.get(oldSubmissionId))!;
    const proven = await submissions.reconcile(oldSubmissionId, { routeRef: "/c/c1", conversationRef: "c1",
      assistantMessageCount: 1, userMessageCount: 1, lastAssistantMessageFingerprint: "old",
      observedAt: 300, sourceEpoch: 1, generationActive: false, providerFailure: true, dispatchFence: old.dispatchFence });
    expect(proven.outcome).toBe("PROVEN_NOT_ACCEPTED");
    expect((await submissions.get(oldSubmissionId))?.state).toBe("FAILED_SAFE");

    // The stale old-generation transport no longer blocks; one logical anchor
    // completes through a fresh binding-scoped transport.
    const dispatchNew = async (operation: SubmissionOperation) => {
      dispatched += 1;
      return { routeRef: "/c/c2", conversationRef: "c2", assistantMessageCount: 2, userMessageCount: 2,
        headFingerprint: "h2", observedAt: 2400, sourceEpoch: 1, stableSince: 400, generationActive: false,
        lastUserMessageFingerprint: fingerprintSubmissionPayload(operation.payload!),
        dispatchFence: operation.dispatchFence! };
    };
    await runGoalReanchorProbe({ context: claimContext({ providerConversationRef: "c2", targetCarrierRef: "browser-tab:2", sourceObservedAt: 400 }),
      baseline: baseline({ conversationRef: "c2", routeRef: "/c/c2", observedAt: 400 }) }, storage, submissions, dispatchNew);
    expect(dispatched).toBe(2);
    const anchorOperation = backing.noosGoalReanchors.t.state.operations["reanchor:t:1"];
    expect(anchorOperation).toMatchObject({ status: "COMPLETED", trigger: "experimental_n" });
    expect(anchorOperation.submissionOperationId).not.toBe(oldSubmissionId);
    expect(anchorOperation.submissionOperationId).toMatch(/^reanchor:t:1:c2:browser-tab:2:/);
    expect(anchorOperation.supersededSubmissionOperationIds).toContain(oldSubmissionId);
    expect(await submissions.get(oldSubmissionId)).toMatchObject({ state: "FAILED_SAFE" });
    expect(await submissions.get(anchorOperation.submissionOperationId!)).toMatchObject({ state: "COMPLETED", providerConversationRef: "c2" });
    const transports = (await submissions.list()).filter(operation => operation.operationKind === "REANCHOR_GOAL");
    expect(transports).toHaveLength(2);
  });

  it("re-arms a proven-never-inserted anchor transport on the same binding before rotating identity", async () => {
    const { backing, storage } = memoryStorage({
      noosWorkItemInbox: workItemInbox("c1", "browser-tab:1"),
      noosGoalReanchors: { t: anchorSeed(1) }
    });
    const submissions = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { claimViaCoordinator: false, lock: async work => work() }));
    const context = claimContext();
    const base = baseline();
    await completePrimaryGo(submissions, context, base);
    let dispatched = 0;
    const failing = async () => { dispatched += 1; throw new Error("provider acknowledgement lost"); };
    await runGoalReanchorProbe({ context, baseline: base }, storage, submissions, failing);
    expect(dispatched).toBe(1);
    const submissionId = backing.noosGoalReanchors.t.state.operations["reanchor:t:1"].submissionOperationId!;

    // Explicit provider failure proves non-acceptance on the same fence.
    const old = (await submissions.get(submissionId))!;
    const proven = await submissions.reconcile(submissionId, { routeRef: "/c/c1", conversationRef: "c1",
      assistantMessageCount: 1, userMessageCount: 1, lastAssistantMessageFingerprint: "old",
      observedAt: 300, sourceEpoch: 1, generationActive: false, providerFailure: true, dispatchFence: old.dispatchFence });
    expect(proven.outcome).toBe("PROVEN_NOT_ACCEPTED");

    // The next probe on the same binding re-arms the same transport identity
    // with the fresh baseline instead of creating a second transport.
    const retry = async (operation: SubmissionOperation) => {
      dispatched += 1;
      return { routeRef: "/c/c1", conversationRef: "c1", assistantMessageCount: 2, userMessageCount: 2,
        headFingerprint: "h2", observedAt: 2400, sourceEpoch: 1, stableSince: 400, generationActive: false,
        lastUserMessageFingerprint: fingerprintSubmissionPayload(operation.payload!),
        dispatchFence: operation.dispatchFence! };
    };
    await runGoalReanchorProbe({ context: claimContext({ sourceObservedAt: 400 }), baseline: baseline({ observedAt: 400 }) },
      storage, submissions, retry);
    expect(dispatched).toBe(2);
    const transports = (await submissions.list()).filter(operation => operation.operationKind === "REANCHOR_GOAL");
    expect(transports).toHaveLength(1);
    expect(transports[0].operationId).toBe(submissionId);
    expect(transports[0].state).toBe("COMPLETED");
    const anchorOperation = backing.noosGoalReanchors.t.state.operations["reanchor:t:1"];
    expect(anchorOperation).toMatchObject({ status: "COMPLETED", submissionOperationId: submissionId });
    expect(anchorOperation.supersededSubmissionOperationIds ?? []).toEqual([]);
    expect(backing.noosGoalReanchors.t.state.anchorRevision).toBe(1);
  });

  it("blocks the anchor while an execution-owning GO holds the carrier, then executes after it completes", async () => {
    const { backing, storage } = memoryStorage({ noosWorkItemInbox: workItemInbox("c1", "browser-tab:1") });
    const submissions = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { claimViaCoordinator: false, lock: async work => work() }));
    const context = claimContext();
    const base = baseline();
    // Establish the durable anchor record on the current binding first.
    await runGoalReanchorProbe({ context, baseline: base }, storage, submissions, async () => { throw new Error("unused"); });
    // An in-flight GO claims execution on the same carrier and conversation.
    await submissions.initializeAuthority(context);
    await submissions.prepare({ operationId: "design-1", operationKind: "GO", workItemId: "w", logicalThreadId: "t",
      targetCarrierRef: context.targetCarrierRef, providerConversationRef: context.providerConversationRef,
      dispatchFence: context, payload: "continue", payloadFingerprint: fingerprintSubmissionPayload("continue"),
      preSubmitBaseline: base, now: 10 });
    await submissions.claim("design-1", context, 10);
    // A scope correction makes the anchor eligible regardless of the counter.
    backing.noosWorkItemInbox.workItems[0].scope = "Scope v2";
    let dispatched = 0;
    const dispatch = async () => { dispatched += 1; throw new Error("must not dispatch while blocked"); };
    const blocked = await runGoalReanchorProbe({ context: claimContext({ sourceObservedAt: 3000 }),
      baseline: baseline({ observedAt: 3000 }) }, storage, submissions, dispatch);
    expect(blocked).toMatchObject({ status: "BLOCKED_BY_EXECUTION", blockingOperationId: "design-1" });
    expect(dispatched).toBe(0);
    expect(backing.noosGoalReanchors.t.state.operations["reanchor:t:1"]).toMatchObject({ status: "PENDING", trigger: "scope_correction" });

    // The GO completes and no longer holds execution; the pending anchor runs.
    await submissions.reconcile("design-1", { ...base, assistantMessageCount: 2, userMessageCount: 2,
      lastAssistantMessageFingerprint: "new", lastUserMessageFingerprint: fingerprintSubmissionPayload("continue"),
      observedAt: 6010, stableSince: 3000, sourceEpoch: 1, generationActive: false, dispatchFence: context });
    await submissions.record("design-1", "COMPLETED", { now: 6010 });
    const dispatchAnchor = async (operation: SubmissionOperation) => {
      dispatched += 1;
      return { routeRef: "/c/c1", conversationRef: "c1", assistantMessageCount: 2, userMessageCount: 2,
        headFingerprint: "h2", observedAt: 8500, sourceEpoch: 1, stableSince: 6500, generationActive: false,
        lastUserMessageFingerprint: fingerprintSubmissionPayload(operation.payload!),
        dispatchFence: operation.dispatchFence! };
    };
    await runGoalReanchorProbe({ context: claimContext({ sourceObservedAt: 6500 }),
      baseline: baseline({ observedAt: 6500 }) }, storage, submissions, dispatchAnchor);
    expect(dispatched).toBe(1);
    expect(backing.noosGoalReanchors.t.state.operations["reanchor:t:1"]).toMatchObject({ status: "COMPLETED", trigger: "scope_correction" });
    expect(backing.noosGoalReanchors.t.state.anchorRevision).toBe(1);
  });

  it("closes the anchor cycle when the pending transport is completed by external reconciliation", async () => {
    const { backing, storage } = memoryStorage({
      noosWorkItemInbox: workItemInbox("c1", "browser-tab:1"),
      noosGoalReanchors: { t: anchorSeed(1) }
    });
    const submissions = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { claimViaCoordinator: false, lock: async work => work() }));
    const context = claimContext();
    const base = baseline();
    await completePrimaryGo(submissions, context, base);
    let dispatched = 0;
    const failing = async () => { dispatched += 1; throw new Error("provider acknowledgement lost"); };
    await runGoalReanchorProbe({ context: { ...context, sourceObservedAt: 6010 }, baseline: { ...base, observedAt: 6010 } },
      storage, submissions, failing);
    expect(dispatched).toBe(1);
    const submissionId = backing.noosGoalReanchors.t.state.operations["reanchor:t:1"].submissionOperationId!;
    expect((await submissions.get(submissionId))?.state).toBe("UNCERTAIN");

    // The provider turn actually landed; a later observation (for example from
    // the content-side recovery path) completes the transport externally.
    const pending = (await submissions.get(submissionId))!;
    const externallyCompleted = await submissions.reconcile(submissionId, {
      routeRef: "/c/c1", conversationRef: "c1", assistantMessageCount: 2, userMessageCount: 2,
      lastAssistantMessageFingerprint: "new", lastUserMessageFingerprint: fingerprintSubmissionPayload(pending.payload!),
      headFingerprint: "h2", observedAt: 8010, stableSince: 6010, sourceEpoch: 1, generationActive: false,
      dispatchFence: pending.dispatchFence });
    expect(externallyCompleted.outcome).toBe("PROVEN_ACCEPTED");
    expect((await submissions.record(submissionId, "COMPLETED", { now: 8010 }))?.state).toBe("COMPLETED");

    // The next probe closes the anchor cycle from the durable transport state
    // without a second dispatch, and the reset counter keeps it idle.
    const idle = await runGoalReanchorProbe({ context: claimContext({ sourceObservedAt: 9000 }),
      baseline: baseline({ observedAt: 9000 }) }, storage, submissions, failing);
    expect(idle).toMatchObject({ status: "IDLE" });
    expect(dispatched).toBe(1);
    expect(backing.noosGoalReanchors.t.state).toMatchObject({ anchorRevision: 1, designTurnsSinceAnchor: 0 });
    expect(backing.noosGoalReanchors.t.state.operations["reanchor:t:1"]).toMatchObject({ status: "COMPLETED" });
  });
});
