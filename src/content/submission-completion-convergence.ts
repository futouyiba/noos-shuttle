/**
 * M2 completion-reconciliation policy, and the terminal-state convergence
 * added for issue #137.
 *
 * A crash between the durable `record COMPLETED` and the Run's
 * `OPERATION_COMPLETED` leaves an operation that is finished while its Run still
 * counts it as pending. The same shape arises without a crash when the GO is
 * proven not accepted (`reconcile` records `FAILED_SAFE`): the live reconciler
 * drops its in-memory `activeSubmission` and the Run keeps the pending id.
 * Nothing else can clear that pending id: live recovery only lists
 * execution-owning states (DISPATCHING / UNCERTAIN / OBSERVED_ACCEPTED), and
 * `reconcile` short-circuits a terminal operation as STILL_AMBIGUOUS, so the Run
 * stays behind its own MAX_IN_FLIGHT=1 guard and neither advances nor fails
 * safe.
 *
 * Only the operation the Run itself names as pending may be converged. That
 * durable id is the Run's own statement of what it is waiting for, so it is
 * stronger evidence of ownership than any recency or thread comparison — and it
 * is what makes this exactly-once: once the event is applied the pending id is
 * gone and this returns null. Selecting by recency would let an unrelated
 * conversation's completion decide this Run's projection.
 *
 * `COMPLETED` is itself the persisted acceptance evidence: the ledger records
 * that state only after `isCompletionEvidence` holds against a stable turn, so
 * acceptance is not re-derived from the page here.
 *
 * `FAILED_SAFE` is the opposite evidence, and it is never read as acceptance:
 * the ledger reaches it only through reconciliation that proved the turn never
 * appeared (unchanged conversation, stable carrier) or that the provider
 * failed. The caller ends the Run fail-safe; nothing is consumed or recorded as
 * accepted.
 *
 * Carrier and conversation scoping is deliberately the same as live recovery's.
 * This decides a Run from durable facts on a page that is watching the
 * conversation, and it may not widen the set of pages allowed to act on a Run's
 * operation: a page that reopens the conversation in a new tab carries a
 * different carrierRef and stays out of scope.
 *
 * There is no carrierState/READY requirement. Unlike live recovery this consumes
 * no page interaction and re-fences nothing, so the composer's state is
 * irrelevant. It must never dispatch, resend, re-record, or consume the round
 * twice — the caller applies one Run event and stops.
 */

import type { SubmissionDispatchFence } from "../core/submission-operation";

export interface SubmissionCompletionRecord {
  operationId: string;
  state: string;
  targetCarrierRef: string;
  providerConversationRef?: string;
  dispatchFence?: unknown;
}

export interface SubmissionCompletionRun {
  status: string;
  providerConversationRef: string;
  pendingSubmissionOperationId?: string;
}

export interface SubmissionCompletionObservation {
  carrierRef: string;
  providerConversationRef?: string;
}

export function selectCompletedSubmissionToConverge(input: {
  operations: readonly SubmissionCompletionRecord[];
  observation: SubmissionCompletionObservation;
  run: SubmissionCompletionRun | null;
}): { operationId: string } | null {
  return selectPendingSubmissionInState(input, "COMPLETED");
}

/**
 * The `FAILED_SAFE` counterpart (issue #137). Returns the Run's own pending
 * operation when the ledger has durably proven the GO was not accepted, so the
 * caller can end the Run fail-safe instead of leaving it ACTIVE on a pending id
 * that no recovery lane will ever clear.
 */
export function selectNotAcceptedSubmissionToConverge(input: {
  operations: readonly SubmissionCompletionRecord[];
  observation: SubmissionCompletionObservation;
  run: SubmissionCompletionRun | null;
}): { operationId: string } | null {
  return selectPendingSubmissionInState(input, "FAILED_SAFE");
}

function selectPendingSubmissionInState(input: {
  operations: readonly SubmissionCompletionRecord[];
  observation: SubmissionCompletionObservation;
  run: SubmissionCompletionRun | null;
}, state: "COMPLETED" | "FAILED_SAFE"): { operationId: string } | null {
  const run = input.run;
  const conversationRef = input.observation.providerConversationRef;
  if (!run || !conversationRef) return null;
  if (run.status !== "ACTIVE") return null;
  if (run.providerConversationRef !== conversationRef) return null;
  const pendingSubmissionOperationId = run.pendingSubmissionOperationId;
  if (pendingSubmissionOperationId === undefined) return null;
  const operation = input.operations.find(candidate => candidate.operationId === pendingSubmissionOperationId);
  if (!operation) return null;
  if (operation.state !== state) return null;
  if (operation.providerConversationRef !== conversationRef) return null;
  if (operation.targetCarrierRef !== input.observation.carrierRef) return null;
  if (!isSubmissionFence(operation.dispatchFence)) return null;
  return { operationId: operation.operationId };
}

export function isSubmissionFence(value: unknown): value is SubmissionDispatchFence {
  if (!value || typeof value !== "object") return false;
  const fence = value as Partial<SubmissionDispatchFence>;
  return typeof fence.providerConversationRef === "string" &&
    typeof fence.bindingEpoch === "number" &&
    typeof fence.leaseGeneration === "number" &&
    typeof fence.leaseOwnerRef === "string" &&
    typeof fence.targetCarrierRef === "string";
}

/**
 * Mapping a pending GO when its dispatching execution is gone (issue #133).
 *
 * A carrier replacement — a new tab, or a reload into a new document — adopts the
 * run and finds a pending operation whose dispatch fence belongs to the previous
 * execution (`leaseOwnerRef` or `targetCarrierRef` differs from the current
 * observation). The existing completion and recovery lanes are deliberately
 * scoped to the dispatching execution, so they can never settle it from here;
 * leaving the run pending is the wedge #133 is about. The durable operation state
 * is the only evidence this carrier has, and it maps exhaustively:
 *
 *   - `COMPLETED`     proven acceptance: continue the run, no resend.
 *   - `FAILED_SAFE`   proven not accepted (#137): end the run visibly.
 *   - everything else — `DISPATCHING`, `UNCERTAIN`, `OBSERVED_ACCEPTED`,
 *     `PREPARED`, a missing record, an unreadable fence — is acceptance the
 *     current execution cannot prove. It settles as visible UNCERTAIN; it is
 *     never read as non-acceptance and never resent. `PREPARED` in particular
 *     carries no proven-refusal receipt, so it is not proof the round did not
 *     happen.
 *
 * Only the run's own pending id may be decided, and only for the run's own
 * conversation. The caller applies exactly one Run event and stops.
 */
export type PendingSubmissionRebindState = "COMPLETED" | "NOT_ACCEPTED" | "UNCERTAIN";

export interface SubmissionRebindObservation {
  carrierRef: string;
  executionInstanceRef: string;
  providerConversationRef?: string;
}

export function selectPendingSubmissionOnCarrierReplacement(input: {
  operations: readonly SubmissionCompletionRecord[];
  observation: SubmissionRebindObservation;
  run: SubmissionCompletionRun | null;
}): { operationId: string; state: PendingSubmissionRebindState } | null {
  const run = input.run;
  const conversationRef = input.observation.providerConversationRef;
  if (!run || !conversationRef) return null;
  if (run.status !== "ACTIVE") return null;
  if (run.providerConversationRef !== conversationRef) return null;
  const operationId = run.pendingSubmissionOperationId;
  if (operationId === undefined) return null;
  const operation = input.operations.find(candidate => candidate.operationId === operationId);
  // The record is unreadable or gone: acceptance is unprovable, and the run's
  // own pending id still names the round. That is the UNCERTAIN row, not a
  // reason to drop the pending state.
  if (!operation) return { operationId, state: "UNCERTAIN" };
  if (operation.providerConversationRef !== undefined && operation.providerConversationRef !== conversationRef) {
    return { operationId, state: "UNCERTAIN" };
  }
  if (!isSubmissionFence(operation.dispatchFence)) return { operationId, state: "UNCERTAIN" };
  if (operation.dispatchFence.providerConversationRef !== conversationRef) return { operationId, state: "UNCERTAIN" };
  // Same execution: the ordinary lanes own it (they may reconcile or recover
  // in place). This selector only decides rounds the current execution did not
  // dispatch.
  const sameExecution = operation.targetCarrierRef === input.observation.carrierRef &&
    operation.dispatchFence.leaseOwnerRef === input.observation.executionInstanceRef;
  if (sameExecution) return null;
  if (operation.state === "COMPLETED") return { operationId, state: "COMPLETED" };
  if (operation.state === "FAILED_SAFE") return { operationId, state: "NOT_ACCEPTED" };
  return { operationId, state: "UNCERTAIN" };
}
