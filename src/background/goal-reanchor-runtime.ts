import { GoalReanchorLedger, type GoalReanchorState } from "../core/goal-reanchor";
import { type SubmissionClaimContext, type SubmissionBaseline, type SubmissionObservation, type SubmissionOperation, SubmissionOperationLedger, fingerprintSubmissionPayload } from "../core/submission-operation";

const STORAGE_KEY = "noosGoalReanchors";
interface AnchorRecord { state: GoalReanchorState; goal: string; scope: string; }
interface WorkItemProjection {
  workItemId: string; primaryLogicalThreadId: string; goal: string; scope: string;
  status: string; binding?: { conversationId?: string; carrierRef?: string };
}
export interface GoalReanchorProbe { context: SubmissionClaimContext; baseline: SubmissionBaseline; }
let pending: Promise<unknown> = Promise.resolve();

/** Only extension-owned storage and completed transport evidence advance the counter. */
export function runGoalReanchorProbe(
  probe: GoalReanchorProbe,
  storage: Pick<chrome.storage.StorageArea, "get" | "set">,
  submissions: SubmissionOperationLedger,
  dispatch: (operation: SubmissionOperation) => Promise<SubmissionObservation>
): Promise<unknown> {
  const run = pending.then(async () => {
    const workItems = (await storage.get("noosWorkItemInbox")).noosWorkItemInbox;
    const item = workItems?.workItems?.find((value: WorkItemProjection) =>
      value.workItemId === workItems.activeWorkItemId && value.status === "ACTIVE" &&
      value.binding?.conversationId === probe.context.providerConversationRef &&
      value.binding?.carrierRef === probe.context.targetCarrierRef) as WorkItemProjection | undefined;
    if (!item || !item.goal?.trim() || !item.scope?.trim()) return { status: "NO_ACTIVE_GOAL" };
    probe = { ...probe, context: { ...probe.context, logicalThreadId: item.primaryLogicalThreadId } };
    const all = (await storage.get(STORAGE_KEY))[STORAGE_KEY] as Record<string, AnchorRecord> | undefined;
    const records = { ...all };
    const previous = Object.hasOwn(records, item.primaryLogicalThreadId) ? records[item.primaryLogicalThreadId] : undefined;
    const completed = (await submissions.list()).filter(operation =>
      operation.workItemId === item.workItemId && operation.logicalThreadId === item.primaryLogicalThreadId &&
      operation.state === "COMPLETED" && operation.operationKind === "GO" &&
      operation.lastReconciliationEvidence?.generationActive === false &&
      Boolean(operation.lastReconciliationEvidence?.lastAssistantMessageFingerprint) &&
      operation.lastReconciliationEvidence?.lastAssistantMessageFingerprint !== operation.preSubmitBaseline.lastAssistantMessageFingerprint);
    const byId = new Map(completed.map(operation => [operation.operationId, operation]));
    const ledger = new GoalReanchorLedger({
      logicalThreadId: item.primaryLogicalThreadId, experimentalN: previous?.state.experimentalN ?? 5,
      initialState: previous?.state,
      verifySubstantive: evidence => {
        const operation = byId.get(evidence.generationId);
        return Boolean(operation && evidence.completionEvidence?.source === "SUBMISSION_OPERATION" &&
          evidence.completionEvidence.id === operation.operationId && evidence.completedAt === operation.lastObservedAt &&
          evidence.evidenceFingerprint === operation.lastReconciliationEvidence?.lastAssistantMessageFingerprint);
      }
    });
    for (const operation of completed) {
      // Generations already covered by an anchor cannot be counted on a later recovery.
      ledger.recordDesignGeneration({ generationId: operation.operationId, role: "design", status: "COMPLETED",
        substantive: true, evidenceFingerprint: operation.lastReconciliationEvidence!.lastAssistantMessageFingerprint!,
        completedAt: operation.lastObservedAt,
        completionEvidence: { source: "SUBMISSION_OPERATION", id: operation.operationId, verified: true } });
    }
    if (ledger.pendingOperation) {
      const submission = await submissions.get(ledger.pendingOperation.operationId);
      if (submission?.state === "COMPLETED") ledger.completeReanchor(submission.operationId, submission.lastObservedAt);
    }
    // A scope update in WorkItem storage has already crossed the Human authority boundary.
    const trigger = ledger.pendingOperation?.trigger ?? (previous && (previous.goal !== item.goal || previous.scope !== item.scope)
      ? "scope_correction" : "experimental_n");
    const id = `reanchor:${item.primaryLogicalThreadId}:${ledger.state.anchorRevision + 1}`;
    const requested = ledger.requestReanchor(trigger, id, probe.baseline.observedAt);
    const persist = async () => {
      records[item.primaryLogicalThreadId] = { state: ledger.state, goal: item.goal, scope: item.scope };
      await storage.set({ [STORAGE_KEY]: records });
    };
    await persist(); // Durable identity before any provider action, including on restart.
    if (!requested.operation || requested.operation.status === "COMPLETED") return { status: "IDLE" };
    await submissions.initializeAuthority(probe.context);
    const payload = `Goal Re-anchor\n\nWork Item: ${item.workItemId}\nGoal: ${item.goal}\nScope: ${item.scope}\n\nContinue within this existing Goal and Scope.`;
    const result = await ledger.executeReanchor(requested.operation.trigger, requested.operation.operationId, {
      carrierState: "READY", logicalControl: "CONTINUE", targetCarrierRef: probe.context.targetCarrierRef,
      providerConversationRef: probe.context.providerConversationRef, baseline: probe.baseline,
      claimContext: probe.context, dispatch
    }, submissions, { workItemId: item.workItemId, payload, payloadFingerprint: fingerprintSubmissionPayload(payload), now: probe.baseline.observedAt });
    await persist();
    return result;
  });
  pending = run.catch(() => undefined);
  return run;
}
