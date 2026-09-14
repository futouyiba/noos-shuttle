import { describe, expect, it } from "vitest";
import { runGoalReanchorProbe } from "../src/background/goal-reanchor-runtime";
import { createChromeSubmissionStore, fingerprintSubmissionPayload, SubmissionOperationLedger, type SubmissionClaimContext } from "../src/core/submission-operation";

describe("production goal completion authority", () => {
  it("counts a completed primary GO, rejects an unfinished GO, and preserves uncertain anchor identity on recovery", async () => {
    const backing: Record<string, any> = {
      noosWorkItemInbox: { activeWorkItemId: "w", workItems: [{ workItemId: "w", primaryLogicalThreadId: "t", status: "ACTIVE", goal: "Goal", scope: "Scope", binding: { conversationId: "c", carrierRef: "browser-tab:1" } }] },
      noosGoalReanchors: { t: { goal: "Goal", scope: "Scope", state: { version: 1, logicalThreadId: "t", experimentalN: 1, anchorRevision: 0, designTurnsSinceAnchor: 0, completedGenerationIds: [], operations: {} } } }
    };
    const storage = { get: async (key: string) => ({ [key]: backing[key] }), set: async (data: Record<string, unknown>) => { Object.assign(backing, structuredClone(data)); } };
    const submissions = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { claimViaCoordinator: false, lock: async work => work() }));
    const context: SubmissionClaimContext = { logicalThreadId: "t", targetCarrierRef: "browser-tab:1", providerConversationRef: "c", bindingEpoch: 1, leaseGeneration: 1, leaseOwnerRef: "owner", explicitGo: true, carrierState: "READY", logicalControl: "CONTINUE", sourceEpoch: 1, sourceObservedAt: 10 };
    const baseline = { conversationRef: "c", routeRef: "/c/c", assistantMessageCount: 1, userMessageCount: 1, observedAt: 10, lastAssistantMessageFingerprint: "old" };
    await submissions.initializeAuthority(context);
    await submissions.prepare({ operationId: "design-1", operationKind: "GO", workItemId: "w", logicalThreadId: "t", targetCarrierRef: context.targetCarrierRef, providerConversationRef: "c", dispatchFence: context, payload: "continue", payloadFingerprint: fingerprintSubmissionPayload("continue"), preSubmitBaseline: baseline, now: 10 });
    await submissions.claim("design-1", context, 10);
    let dispatched = 0;
    const dispatch = async () => { dispatched++; throw new Error("provider acknowledgement lost"); };
    await runGoalReanchorProbe({ context, baseline }, storage as chrome.storage.StorageArea, submissions, dispatch);
    expect(backing.noosGoalReanchors.t.state.designTurnsSinceAnchor).toBe(0);
    await submissions.reconcile("design-1", { ...baseline, assistantMessageCount: 2, userMessageCount: 2, lastAssistantMessageFingerprint: "new", lastUserMessageFingerprint: fingerprintSubmissionPayload("continue"), observedAt: 5010, stableSince: 10, sourceEpoch: 1, generationActive: false, dispatchFence: context });
    expect((await submissions.record("design-1", "COMPLETED", { now: 5010 }))?.state).toBe("COMPLETED");
    const probe = { context: { ...context, sourceObservedAt: 6010 }, baseline: { ...baseline, observedAt: 6010 } };
    await runGoalReanchorProbe(probe, storage as chrome.storage.StorageArea, submissions, dispatch);
    expect(backing.noosGoalReanchors.t.state.designTurnsSinceAnchor).toBe(1);
    expect(dispatched).toBe(1);
    await runGoalReanchorProbe(probe, storage as chrome.storage.StorageArea, submissions, dispatch);
    expect(dispatched).toBe(1);
    expect((await submissions.list()).filter(operation => operation.operationKind === "REANCHOR_GOAL")).toHaveLength(1);
    expect(backing.noosGoalReanchors.t.state.completedGenerationIds).toEqual(["design-1"]);
  });
});
