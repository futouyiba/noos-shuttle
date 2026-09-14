import { GoalReanchorLedger, type GoalReanchorState } from "../core/goal-reanchor";
import { type SubmissionClaimContext, type SubmissionBaseline, type SubmissionObservation, type SubmissionOperation, SubmissionOperationLedger, fingerprintSubmissionPayload } from "../core/submission-operation";

const STORAGE_KEY = "noosGoalReanchors";
interface AnchorRecord {
  state: GoalReanchorState;
  goal: string;
  scope: string;
  /** Durable Work Item binding observed by the last probe; conversation change is a rollover signal. */
  binding?: { conversationId?: string; carrierRef?: string };
}
interface WorkItemProjection {
  workItemId: string; primaryLogicalThreadId: string; goal: string; scope: string;
  status: string; binding?: { conversationId?: string; carrierRef?: string };
}
export interface GoalReanchorProbe { context: SubmissionClaimContext; baseline: SubmissionBaseline; }
let pending: Promise<unknown> = Promise.resolve();

const executionOwningStates = new Set(["DISPATCHING", "UNCERTAIN", "OBSERVED_ACCEPTED"]);

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
    const operations = await submissions.list();
    const completed = operations.filter(operation =>
      operation.workItemId === item.workItemId && operation.logicalThreadId === item.primaryLogicalThreadId &&
      operation.state === "COMPLETED" && operation.operationKind === "GO" &&
      operation.lastReconciliationEvidence?.generationActive === false &&
      Boolean(operation.lastReconciliationEvidence?.lastAssistantMessageFingerprint) &&
      operation.lastReconciliationEvidence?.lastAssistantMessageFingerprint !== operation.preSubmitBaseline.lastAssistantMessageFingerprint);
    const completedById = new Map(completed.map(operation => [operation.operationId, operation]));
    const ledger = new GoalReanchorLedger({
      logicalThreadId: item.primaryLogicalThreadId, experimentalN: previous?.state.experimentalN ?? 5,
      initialState: previous?.state,
      verifySubstantive: evidence => {
        const operation = completedById.get(evidence.generationId);
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
    const persist = async () => {
      records[item.primaryLogicalThreadId] = {
        state: ledger.state, goal: item.goal, scope: item.scope,
        binding: { conversationId: item.binding?.conversationId, carrierRef: item.binding?.carrierRef }
      };
      await storage.set({ [STORAGE_KEY]: records });
    };
    const pendingBefore = ledger.pendingOperation;
    if (pendingBefore) {
      const recordedId = pendingBefore.submissionOperationId ?? pendingBefore.operationId;
      const backing = await submissions.get(recordedId);
      if (backing?.state === "COMPLETED") {
        // A completed transport closes the anchor cycle even if the completion
        // was reconciled by another runtime instance after a worker reload.
        ledger.completeReanchor(pendingBefore.operationId, backing.lastObservedAt);
      } else if (backing && executionOwningStates.has(backing.state)) {
        // The anchor's own transport still owns execution — possibly on a
        // superseded binding — and must reconcile before anything else runs.
        await persist();
        return { status: "RECONCILE_REQUIRED", operationId: pendingBefore.operationId, submissionState: backing.state };
      }
    }
    // A scope update in WorkItem storage has already crossed the Human authority
    // boundary; a durable binding conversation change is a rollover signal that
    // runs the next anchor against the new current binding.
    const rolledOver = Boolean(previous?.binding?.conversationId && item.binding?.conversationId &&
      previous.binding.conversationId !== item.binding.conversationId);
    const trigger = ledger.pendingOperation?.trigger ?? (previous && (previous.goal !== item.goal || previous.scope !== item.scope)
      ? "scope_correction" : rolledOver ? "rollover" : "experimental_n");
    const id = `reanchor:${item.primaryLogicalThreadId}:${ledger.state.anchorRevision + 1}`;
    const requested = ledger.requestReanchor(trigger, id, probe.baseline.observedAt);
    await persist(); // Durable identity before any provider action, including on restart.
    if (!requested.operation || requested.operation.status === "COMPLETED") return { status: "IDLE" };
    const anchor = requested.operation;
    await submissions.initializeAuthority(probe.context);
    // One active submission per carrier: an execution-owning operation on the
    // current target must reconcile before this anchor may act.
    const blocking = operations.find(operation =>
      executionOwningStates.has(operation.state) &&
      operation.targetCarrierRef === probe.context.targetCarrierRef &&
      operation.providerConversationRef === probe.context.providerConversationRef);
    if (blocking) return { status: "BLOCKED_BY_EXECUTION", blockingOperationId: blocking.operationId };
    const payload = `Goal Re-anchor\n\nWork Item: ${item.workItemId}\nGoal: ${item.goal}\nScope: ${item.scope}\n\nContinue within this existing Goal and Scope.`;
    const payloadFingerprint = fingerprintSubmissionPayload(payload);
    // Transport identity is scoped to binding and payload, so a stale
    // old-generation submission can never collide with the current anchor cycle.
    const baseId = `reanchor:${item.primaryLogicalThreadId}:${anchor.targetAnchorRevision}:${probe.context.providerConversationRef}:${probe.context.targetCarrierRef}:${payloadFingerprint.slice(0, 8)}`;
    const recorded = anchor.submissionOperationId;
    const retired = new Set([...(anchor.supersededSubmissionOperationIds ?? []), ...(recorded ? [recorded] : [])]);
    const freshSubmissionId = () => {
      let candidate = baseId;
      for (let attempt = 1; retired.has(candidate); attempt += 1) candidate = `${baseId}:a${attempt + 1}`;
      return candidate;
    };
    let submissionOperationId: string;
    if (recorded === baseId) {
      const backing = await submissions.get(recorded);
      if (backing?.state === "FAILED_SAFE") {
        // Proven-never-inserted on the current fence: re-arm the same transport
        // operation with the fresh baseline instead of rotating identity.
        const rearmed = await submissions.rearm(recorded, probe.baseline, probe.context, probe.baseline.observedAt);
        submissionOperationId = rearmed?.state === "PREPARED" ? recorded : freshSubmissionId();
      } else {
        // PREPARED/CANCELLED/missing backing cannot adopt the fresh baseline or
        // fence of this probe; a stale identity has no dispatch authority.
        submissionOperationId = freshSubmissionId();
      }
    } else {
      // Binding or payload moved: the recorded transport is stale against the
      // new generation unless it already reconciled earlier in this probe.
      submissionOperationId = freshSubmissionId();
    }
    if (submissionOperationId !== recorded) {
      ledger.noteSubmissionOperation(anchor.operationId, submissionOperationId);
      await persist();
    }
    const result = await ledger.executeReanchor(anchor.trigger, anchor.operationId, {
      carrierState: "READY", logicalControl: "CONTINUE", targetCarrierRef: probe.context.targetCarrierRef,
      providerConversationRef: probe.context.providerConversationRef, baseline: probe.baseline,
      claimContext: probe.context, dispatch
    }, submissions, { workItemId: item.workItemId, payload, payloadFingerprint, submissionOperationId, now: probe.baseline.observedAt });
    await persist();
    return result;
  });
  pending = run.catch(() => undefined);
  return run;
}
