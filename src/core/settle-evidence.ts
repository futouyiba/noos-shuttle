/**
 * Settle-from-evidence glue (adjudication 2026-09-15, §十/§十三).
 *
 * Two steps, no shortcuts: the Provider Execution Journal records what actually
 * happened; this composer turns a recorded fact into a state-transition request
 * for the authoritative OperationalStateReducer. It never mutates the journal
 * and never settles without a durable evidence entry.
 *
 * Licensing is contract-conservative (command-submission-idempotency-contract
 * §5/§7): only a composite acceptance observation or a reconciliation record
 * may establish OBSERVED_ACCEPTED — a single transport-level ack or a blind
 * attempt can at most establish UNCERTAIN, because "ack received" is not
 * "result-bearing message accepted" and OBSERVED_ACCEPTED is irreversible
 * (it mints the delivery receipt and locks the route).
 *
 * Fence mapping (the wiring debt the journal review flagged): the journal and
 * the submission ledger share the five-field fence; the reducer's DispatchFence
 * spells the same authority as four of those fields — bindingEpoch≡
 * bindingGeneration (generation of the binding that authorized the attempt)
 * and targetCarrierRef≡carrierRef. leaseOwnerRef has no reducer counterpart:
 * the reducer already bound it into the lease it granted.
 */

import { dispatchFenceFingerprint, type ExecutionJournalEntry, type ExecutionEventKind } from "./execution-journal";
import type { SubmissionDispatchFence } from "./submission-operation";
import type {
  DispatchFence,
  OperationalStateReducer,
  ReducerResult,
  ReducerSubmissionOperation,
  SettleSubmissionDispatchInput,
} from "./operational-state-reducer";

/** The journal/ledger fence spelling; kept as an alias so callers import one name. */
export type JournalFence = SubmissionDispatchFence;

/** Map a journal/ledger fence onto the reducer's authority components. */
export function toReducerDispatchFence(fence: JournalFence): Omit<DispatchFence, "dispatchFenceId"> {
  return {
    providerConversationRef: fence.providerConversationRef,
    carrierRef: fence.targetCarrierRef,
    bindingGeneration: fence.bindingEpoch,
    leaseGeneration: fence.leaseGeneration
  };
}

export type SettleTarget = SettleSubmissionDispatchInput["targetState"];

/**
 * Which settle targets each evidence kind may license. Narrow on purpose:
 * only composite acceptance/reconciliation may establish OBSERVED_ACCEPTED;
 * transport-level facts alone (blind attempt, provider ack) cap at UNCERTAIN.
 */
const TARGET_BY_EVENT: Record<ExecutionEventKind, SettleTarget[]> = {
  BLIND_DISPATCH_ATTEMPT: ["UNCERTAIN"],
  PROVIDER_ACK: ["UNCERTAIN"],
  ACCEPTANCE_OBSERVED: ["OBSERVED_ACCEPTED", "COMPLETED", "UNCERTAIN", "FAILED_SAFE", "CANCELLED"],
  TURN_COMPLETION_OBSERVED: ["COMPLETED"],
  RECONCILIATION_EVIDENCE: ["OBSERVED_ACCEPTED", "COMPLETED", "UNCERTAIN", "FAILED_SAFE", "CANCELLED"]
};

export interface SettleFromEvidenceInput {
  operationId: string;
  /** Journal entry proving the transport fact. */
  evidence: ExecutionJournalEntry;
  /** Fence the evidence was recorded under (journal/ledger spelling). */
  fence: JournalFence;
  targetState: SettleTarget;
  /** CAS expectation: the operation revision the caller last observed. */
  expectedOperationRevision: number;
  /** The attempt identity whose evidence settles; minted at claim time. */
  expectedDispatchFenceId: string;
  reason: string;
  actor: SettleSubmissionDispatchInput["actor"];
  now: number;
}

/**
 * Drive one settle from a durable journal entry. Fails closed before touching
 * the reducer when the evidence does not belong to the operation, was not
 * recorded under the given fence, or its kind cannot license the requested
 * target; otherwise the reducer's own expectation fence, transition table,
 * and terminal-state guards apply unchanged.
 */
export function settleFromEvidence(
  reducer: OperationalStateReducer,
  input: SettleFromEvidenceInput
): ReducerResult<ReducerSubmissionOperation> {
  if (input.evidence.operationId !== input.operationId) {
    throw new Error("evidence_operation_mismatch");
  }
  if (input.evidence.dispatchFenceFingerprint !== dispatchFenceFingerprint(input.fence)) {
    throw new Error("evidence_fence_mismatch");
  }
  if (!TARGET_BY_EVENT[input.evidence.eventKind].includes(input.targetState)) {
    throw new Error(`evidence_kind_cannot_settle_target:${input.evidence.eventKind}->${input.targetState}`);
  }
  return reducer.settleSubmissionDispatch({
    operationId: input.operationId,
    expectedOperationRevision: input.expectedOperationRevision,
    expectedDispatchFenceId: input.expectedDispatchFenceId,
    targetState: input.targetState,
    executionEvidenceRef: input.evidence.executionAttemptId,
    reason: input.reason,
    actor: input.actor,
    now: input.now
  });
}
