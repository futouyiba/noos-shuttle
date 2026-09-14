/**
 * Settle-from-evidence glue (adjudication 2026-09-15, §十/§十三).
 *
 * Two steps, no shortcuts: the Provider Execution Journal records what actually
 * happened; this composer turns a recorded fact into a state-transition request
 * for the authoritative OperationalStateReducer. It never mutates the journal
 * and never settles without a durable evidence entry.
 *
 * Fence mapping (the wiring debt the journal review flagged): the journal and
 * the submission ledger share the five-field fence
 * {providerConversationRef, bindingEpoch, leaseGeneration, leaseOwnerRef,
 * targetCarrierRef}; the reducer's DispatchFence spells the same authority as
 * {providerConversationRef, carrierRef, bindingGeneration, leaseGeneration} —
 * bindingEpoch≡bindingGeneration (generation of the binding that authorized the
 * attempt) and targetCarrierRef≡carrierRef. leaseOwnerRef has no reducer
 * counterpart: the reducer already bound it into the lease it granted.
 */

import type { ExecutionJournalEntry } from "./execution-journal";
import type {
  DispatchFence,
  OperationalStateReducer,
  ReducerResult,
  ReducerSubmissionOperation,
  SettleSubmissionDispatchInput,
} from "./operational-state-reducer";

export interface JournalFence {
  providerConversationRef: string;
  bindingEpoch: number;
  leaseGeneration: number;
  leaseOwnerRef: string;
  targetCarrierRef: string;
}

/** Map a journal/ledger fence onto the reducer's authority fence spelling. */
export function toReducerDispatchFence(fence: JournalFence): DispatchFence {
  return {
    providerConversationRef: fence.providerConversationRef,
    carrierRef: fence.targetCarrierRef,
    bindingGeneration: fence.bindingEpoch,
    leaseGeneration: fence.leaseGeneration
  };
}

export type SettleTarget = SettleSubmissionDispatchInput["targetState"];

/** Evidence kinds that license each settle target (§9 journal taxonomy). */
const TARGET_BY_EVENT: Record<string, SettleTarget[]> = {
  ACCEPTANCE_OBSERVED: ["OBSERVED_ACCEPTED", "COMPLETED", "UNCERTAIN", "FAILED_SAFE", "CANCELLED"],
  TURN_COMPLETION_OBSERVED: ["COMPLETED"],
  RECONCILIATION_EVIDENCE: ["OBSERVED_ACCEPTED", "COMPLETED", "UNCERTAIN", "FAILED_SAFE", "CANCELLED"],
  BLIND_DISPATCH_ATTEMPT: ["UNCERTAIN", "FAILED_SAFE", "CANCELLED"],
  PROVIDER_ACK: ["OBSERVED_ACCEPTED", "COMPLETED", "UNCERTAIN", "FAILED_SAFE", "CANCELLED"]
};

export interface SettleFromEvidenceInput {
  operationId: string;
  /** Journal entry proving the transport fact. */
  evidence: ExecutionJournalEntry;
  /** Fence the evidence was recorded under (journal/ledger spelling). */
  fence: JournalFence;
  targetState: SettleTarget;
  /** The state the caller expects the operation to be in (expectation fence). */
  expectedCurrentState: SettleSubmissionDispatchInput["expectedCurrentState"];
  reason: string;
  actor: SettleSubmissionDispatchInput["actor"];
  now: number;
}

export type SettleFromEvidenceError =
  | "evidence_operation_mismatch"
  | "evidence_kind_cannot_settle_target";

/**
 * Drive one settle from a durable journal entry. Fails closed before touching
 * the reducer when the evidence does not belong to the operation or its kind
 * cannot license the requested target; otherwise the reducer's own expectation
 * fence, transition table, and terminal-state guards apply unchanged.
 */
export function settleFromEvidence(
  reducer: OperationalStateReducer,
  input: SettleFromEvidenceInput
): ReducerResult<ReducerSubmissionOperation> {
  if (input.evidence.operationId !== input.operationId) {
    throw new Error("evidence_operation_mismatch");
  }
  const licensed = TARGET_BY_EVENT[input.evidence.eventKind] ?? [];
  if (!licensed.includes(input.targetState)) {
    throw new Error(`evidence_kind_cannot_settle_target:${input.evidence.eventKind}->${input.targetState}`);
  }
  return reducer.settleSubmissionDispatch({
    operationId: input.operationId,
    expectedCurrentState: input.expectedCurrentState,
    expectedDispatchFence: toReducerDispatchFence(input.fence),
    targetState: input.targetState,
    executionEvidenceRef: input.evidence.executionAttemptId,
    reason: input.reason,
    actor: input.actor,
    now: input.now
  });
}
