/**
 * Sparse, durable Goal Re-anchor lifecycle state.
 *
 * This module deliberately does not decide whether an anchor is semantically
 * correct or approved. It records completed, evidence-backed Design
 * generations, raises a deduplicated lifecycle operation, and resets the
 * sparse counter only after transport completion has been observed.
 */

import type {
  SubmissionBaseline,
  SubmissionOperation,
  SubmissionOperationLedger,
  SubmissionObservation
} from "./submission-operation";

export type GoalReanchorTrigger =
  | "experimental_n"
  | "compaction"
  | "rollover"
  | "review_return"
  | "sedimentation_return"
  | "scope_correction";

export type GoalReanchorOperationStatus = "PENDING" | "COMPLETED";

export interface GoalReanchorOperation {
  operationId: string;
  trigger: GoalReanchorTrigger;
  sourceAnchorRevision: number;
  targetAnchorRevision: number;
  requestedAt: number;
  completedAt?: number;
  status: GoalReanchorOperationStatus;
  submissionState?: SubmissionOperation["state"];
}

export interface GoalReanchorState {
  version: 1;
  logicalThreadId: string;
  designTurnsSinceAnchor: number;
  anchorRevision: number;
  experimentalN: number;
  completedGenerationIds: string[];
  operations: Record<string, GoalReanchorOperation>;
}

export interface GoalReanchorStore {
  load(): GoalReanchorState | undefined;
  save(state: GoalReanchorState): void;
}

export interface DesignGenerationEvidence {
  generationId: string;
  role: "design";
  status: "COMPLETED";
  substantive: boolean;
  evidenceFingerprint: string;
  completedAt: number;
  /** Authority projection produced by the completed generation, never caller supplied. */
  completionEvidence?: { source: "WORKER_RESULT" | "REPORT" | "SNAPSHOT"; id: string; verified: true };
}

export interface GoalReanchorRuntime {
  carrierState: "READY" | "ATTACHING" | "STABILIZING" | "GENERATING" | "SUSPENDED" | "RECOVERING" | "BROKEN";
  logicalControl: "CONTINUE" | "WAIT_WORKER" | "WAIT_REVIEW" | "BOUNDARY_REACHED";
  targetCarrierRef: string;
  providerConversationRef?: string;
  baseline: SubmissionBaseline;
  dispatch(operation: SubmissionOperation): Promise<SubmissionObservation>;
}

export interface RecordDesignGenerationResult {
  accepted: boolean;
  duplicate: boolean;
  state: GoalReanchorState;
}

export interface RequestReanchorResult {
  eligible: boolean;
  created: boolean;
  operation?: GoalReanchorOperation;
  state: GoalReanchorState;
}

export interface CompleteReanchorResult {
  completed: boolean;
  duplicate: boolean;
  operation?: GoalReanchorOperation;
  state: GoalReanchorState;
}

export interface GoalReanchorLedgerOptions {
  logicalThreadId: string;
  experimentalN: number;
  store?: GoalReanchorStore;
  initialState?: GoalReanchorState;
  now?: () => number;
  /** Runtime supplied authority verifier; when present the caller boolean is ignored. */
  verifySubstantive?: (evidence: DesignGenerationEvidence) => boolean;
}

export class GoalReanchorLedger {
  private readonly logicalThreadId: string;
  private readonly store?: GoalReanchorStore;
  private readonly now: () => number;
  private readonly verifySubstantive?: (evidence: DesignGenerationEvidence) => boolean;
  private current: GoalReanchorState;

  constructor(options: GoalReanchorLedgerOptions) {
    assertNonEmpty(options.logicalThreadId, "logicalThreadId");
    assertPositiveInteger(options.experimentalN, "experimentalN");
    this.logicalThreadId = options.logicalThreadId;
    this.store = options.store;
    this.now = options.now ?? Date.now;
    this.verifySubstantive = options.verifySubstantive;
    this.current = normalizeState(options.store?.load() ?? options.initialState, options.logicalThreadId, options.experimentalN);
    this.persist();
  }

  get state(): GoalReanchorState {
    return cloneState(this.current);
  }

  get pendingOperation(): GoalReanchorOperation | undefined {
    const operation = Object.values(this.current.operations).find(value => value.status === "PENDING");
    return operation && { ...operation };
  }

  recordDesignGeneration(evidence: DesignGenerationEvidence): RecordDesignGenerationResult {
    validateGenerationEvidence(evidence);
    // The legacy boolean is only a hint; advancement requires an authority-backed
    // completion projection from the runtime.
    if (!(this.verifySubstantive ? this.verifySubstantive(evidence) : evidence.substantive)) {
      return { accepted: false, duplicate: false, state: this.state };
    }
    if (this.current.completedGenerationIds.includes(evidence.generationId)) {
      return { accepted: false, duplicate: true, state: this.state };
    }
    this.current = {
      ...this.current,
      designTurnsSinceAnchor: this.current.designTurnsSinceAnchor + 1,
      completedGenerationIds: [...this.current.completedGenerationIds, evidence.generationId]
    };
    this.persist();
    return { accepted: true, duplicate: false, state: this.state };
  }

  requestReanchor(
    trigger: GoalReanchorTrigger,
    operationId: string,
    requestedAt = this.now()
  ): RequestReanchorResult {
    assertNonEmpty(operationId, "operationId");
    assertTimestamp(requestedAt, "requestedAt");

    const known = this.current.operations[operationId];
    if (known) {
      if (known.trigger !== trigger) {
        throw new Error("Goal Re-anchor operation identity was reused for a different trigger.");
      }
      return {
        eligible: true,
        created: false,
        operation: { ...known },
        state: this.state
      };
    }

    const eligible = trigger !== "experimental_n" ||
      this.current.designTurnsSinceAnchor >= this.current.experimentalN;
    if (!eligible) return { eligible: false, created: false, state: this.state };

    // One anchor can satisfy multiple lifecycle signals. Keeping one pending
    // operation for the current source revision prevents restart/event races
    // from producing duplicate provider submissions.
    const pending = this.pendingOperation;
    if (pending && pending.sourceAnchorRevision === this.current.anchorRevision) {
      return { eligible: true, created: false, operation: pending, state: this.state };
    }

    const operation: GoalReanchorOperation = {
      operationId,
      trigger,
      sourceAnchorRevision: this.current.anchorRevision,
      targetAnchorRevision: this.current.anchorRevision + 1,
      requestedAt,
      status: "PENDING"
    };
    this.current = {
      ...this.current,
      operations: { ...this.current.operations, [operationId]: operation }
    };
    this.persist();
    return { eligible: true, created: true, operation: { ...operation }, state: this.state };
  }

  completeReanchor(operationId: string, completedAt = this.now()): CompleteReanchorResult {
    assertNonEmpty(operationId, "operationId");
    assertTimestamp(completedAt, "completedAt");
    const operation = this.current.operations[operationId];
    if (!operation) return { completed: false, duplicate: false, state: this.state };
    if (operation.status === "COMPLETED") {
      return { completed: true, duplicate: true, operation: { ...operation }, state: this.state };
    }
    if (operation.sourceAnchorRevision !== this.current.anchorRevision) {
      throw new Error("Goal Re-anchor operation is stale for the current anchor revision.");
    }
    if (operation.targetAnchorRevision !== operation.sourceAnchorRevision + 1) {
      throw new Error("Goal Re-anchor operation revision sequence is invalid.");
    }

    const completedOperation: GoalReanchorOperation = { ...operation, status: "COMPLETED", completedAt };
    this.current = {
      ...this.current,
      anchorRevision: Math.max(this.current.anchorRevision, operation.targetAnchorRevision),
      designTurnsSinceAnchor: 0,
      operations: { ...this.current.operations, [operationId]: completedOperation }
    };
    this.persist();
    return { completed: true, duplicate: false, operation: { ...completedOperation }, state: this.state };
  }

  onLifecycleEvent(
    event: Exclude<GoalReanchorTrigger, "experimental_n">,
    operationId: string,
    occurredAt = this.now()
  ): RequestReanchorResult {
    return this.requestReanchor(event, operationId, occurredAt);
  }

  async executeReanchor(
    trigger: GoalReanchorTrigger,
    operationId: string,
    runtime: GoalReanchorRuntime,
    submissionLedger: SubmissionOperationLedger,
    details: {
      workItemId: string;
      payload: string;
      payloadFingerprint: string;
      now?: number;
    }
  ): Promise<CompleteReanchorResult | RequestReanchorResult> {
    const requested = this.requestReanchor(trigger, operationId, details.now);
    if (!requested.operation || !requested.created && requested.operation.status === "COMPLETED") return requested;
    if (runtime.carrierState !== "READY" || runtime.logicalControl !== "CONTINUE") return requested;

    const operation = requested.operation;
    const durable = await submissionLedger.prepare({
      operationId,
      operationKind: "REANCHOR_GOAL",
      workItemId: details.workItemId,
      logicalThreadId: this.logicalThreadId,
      targetCarrierRef: runtime.targetCarrierRef,
      providerConversationRef: runtime.providerConversationRef,
      payloadFingerprint: details.payloadFingerprint,
      payload: details.payload,
      preSubmitBaseline: runtime.baseline,
      parentEpoch: operation.sourceAnchorRevision,
      now: details.now
    });
    const claimed = await submissionLedger.claim(operationId, details.now);
    if (!claimed || claimed.state !== "DISPATCHING") return requested;
    try {
      const observation = await runtime.dispatch(claimed);
      const reconciled = await submissionLedger.reconcile(operationId, observation);
      if (reconciled.outcome !== "PROVEN_ACCEPTED") return requested;
      await submissionLedger.record(operationId, "COMPLETED", {
        now: observation.observedAt ?? details.now,
        resultingTurnRef: observation.headFingerprint
      });
      return this.completeReanchor(operationId, observation.observedAt ?? details.now);
    } catch (error) {
      await submissionLedger.record(operationId, "UNCERTAIN", {
        now: details.now,
        error: error instanceof Error ? error.message : "reanchor dispatch failed"
      });
      return requested;
    }
  }

  private persist(): void {
    this.store?.save(this.state);
  }
}

function normalizeState(input: GoalReanchorState | undefined, logicalThreadId: string, experimentalN: number): GoalReanchorState {
  if (!input) {
    return {
      version: 1,
      logicalThreadId,
      designTurnsSinceAnchor: 0,
      anchorRevision: 0,
      experimentalN,
      completedGenerationIds: [],
      operations: {}
    };
  }
  if (input.version !== 1) throw new Error("Unsupported Goal Re-anchor state version.");
  if (input.logicalThreadId !== logicalThreadId) throw new Error("Goal Re-anchor logical thread identity mismatch.");
  if (!Number.isInteger(input.designTurnsSinceAnchor) || input.designTurnsSinceAnchor < 0) {
    throw new Error("Goal Re-anchor counter must be a non-negative integer.");
  }
  if (!Number.isInteger(input.anchorRevision) || input.anchorRevision < 0) {
    throw new Error("Goal Re-anchor revision must be a non-negative integer.");
  }
  if (!Number.isInteger(input.experimentalN) || input.experimentalN <= 0) {
    throw new Error("Goal Re-anchor experimental N must be a positive integer.");
  }
  const operations = Object.fromEntries(Object.entries(input.operations).map(([id, operation]) => {
    assertNonEmpty(id, "operationId");
    if (operation.operationId !== id) throw new Error("Goal Re-anchor operation identity mismatch.");
    if (!Number.isInteger(operation.sourceAnchorRevision) || operation.sourceAnchorRevision < 0 ||
      !Number.isInteger(operation.targetAnchorRevision) ||
      operation.targetAnchorRevision !== operation.sourceAnchorRevision + 1) {
      throw new Error("Goal Re-anchor operation revision sequence is invalid.");
    }
    if (operation.status !== "PENDING" && operation.status !== "COMPLETED") {
      throw new Error("Goal Re-anchor operation status is invalid.");
    }
    assertTimestamp(operation.requestedAt, "requestedAt");
    if (operation.status === "COMPLETED") {
      if (operation.completedAt === undefined) throw new Error("Completed Goal Re-anchor operation needs completedAt.");
      assertTimestamp(operation.completedAt, "completedAt");
      if (operation.completedAt < operation.requestedAt) {
        throw new Error("Goal Re-anchor completion cannot precede request.");
      }
    }
    return [id, { ...operation }];
  }));
  for (const operation of Object.values(operations)) {
    if (operation.status === "PENDING" && operation.sourceAnchorRevision !== input.anchorRevision) {
      throw new Error("Pending Goal Re-anchor operation is stale for the current anchor revision.");
    }
    if (operation.status === "COMPLETED" && operation.targetAnchorRevision > input.anchorRevision) {
      throw new Error("Completed Goal Re-anchor operation is ahead of the current anchor revision.");
    }
  }
  return {
    version: 1,
    logicalThreadId,
    designTurnsSinceAnchor: input.designTurnsSinceAnchor,
    anchorRevision: input.anchorRevision,
    experimentalN: input.experimentalN,
    completedGenerationIds: [...input.completedGenerationIds],
    operations
  };
}

function cloneState(state: GoalReanchorState): GoalReanchorState {
  return {
    ...state,
    completedGenerationIds: [...state.completedGenerationIds],
    operations: Object.fromEntries(Object.entries(state.operations).map(([id, operation]) => [id, { ...operation }]))
  };
}

function assertNonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be non-empty.`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
}

function assertTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a finite non-negative number.`);
}

function validateGenerationEvidence(evidence: DesignGenerationEvidence): void {
  assertNonEmpty(evidence.generationId, "generationId");
  if (evidence.role !== "design" || evidence.status !== "COMPLETED") {
    throw new Error("Only completed Design generations can advance the re-anchor counter.");
  }
  if (typeof evidence.substantive !== "boolean") throw new Error("Generation substantive flag is invalid.");
  assertNonEmpty(evidence.evidenceFingerprint, "evidenceFingerprint");
  assertTimestamp(evidence.completedAt, "completedAt");
  if (evidence.completionEvidence !== undefined) {
    if (!evidence.completionEvidence.verified || !["WORKER_RESULT", "REPORT", "SNAPSHOT"].includes(evidence.completionEvidence.source)) {
      throw new Error("Generation completion evidence is not authority-backed.");
    }
    assertNonEmpty(evidence.completionEvidence.id, "completionEvidence.id");
  }
}
