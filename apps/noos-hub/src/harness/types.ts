/**
 * Harness Dogfood Console v0 — read-only diagnostic projection shape.
 *
 * PROJECTION OWNERSHIP (frozen per review correction):
 * - The extension background coordinator owns and reads the authoritative
 *   Harness stores (work-item coordinator, submission ledger, durable
 *   reducer bundle, execution journal, child ledger, carrier observation).
 * - It builds this snapshot as an ephemeral projection and ships it to the
 *   Hub over the existing Extension <-> Hub HTTP bridge (127.0.0.1:17642).
 * - The Tauri Hub is a consumer/renderer only. It must never reconstruct
 *   canonical Harness truth, persist console-specific aggregate state, or
 *   gain mutation authority from any field here.
 *
 * FRESHNESS (per-source, not global):
 * - `projectionBuiltAt` is the only console-level timestamp; it says when
 *   the projection was assembled, NOT that every contained fact was fresh
 *   at that time. Each block carries the observedAt / revision / updatedAt
 *   that actually exists on its source store.
 *
 * Values use current runtime vocabulary only (no future rollover/authority
 * enums). Fields marked FIXTURE-ONLY have no backend source yet and are
 * listed in the page's observability-gaps panel.
 */

/** Scenario selector values (dev fixture switch, not a backend concept). */
export type HarnessScenarioId = "idle" | "active-submission" | "attention-recovery";

/** Real: WorkItemStatus (src/core/work-item-inbox.ts). */
export type FixtureWorkItemStatus = "DRAFT" | "ACTIVE" | "PROMOTED" | "ARCHIVED";

/** Real: ColdStartState.state (src/core/work-item-inbox.ts). */
export type FixtureColdStartState = "NEEDS_BOOTSTRAP" | "READY";

/**
 * Real: HumanGoCarrierSnapshot.carrierState / GoalReanchorRuntime.carrierState
 * (src/core/human-go-runtime.ts, src/core/goal-reanchor.ts).
 */
export type FixtureCarrierState =
  | "READY"
  | "ATTACHING"
  | "STABILIZING"
  | "GENERATING"
  | "SUSPENDED"
  | "RECOVERING"
  | "BROKEN";

/** Real: logicalControl vocabulary (claim context / reanchor runtime). */
export type FixtureLogicalControl =
  | "CONTINUE"
  | "WAIT_WORKER"
  | "WAIT_REVIEW"
  | "BOUNDARY_REACHED";

/** Real: ReducerActor (src/core/operational-state-reducer.ts). */
export type FixtureReducerActor = "system" | "human" | "worker";

/** Real: SubmissionOperationKind (src/core/submission-operation.ts). */
export type FixtureOperationKind =
  | "GO"
  | "REANCHOR_GOAL"
  | "BOOTSTRAP"
  | "REVIEW_DISPATCH"
  | "SEDIMENT"
  | "DELIVER_CHILD_RESULT";

/** Real: SubmissionOperationState (src/core/submission-operation.ts). */
export type FixtureOperationState =
  | "PREPARED"
  | "DISPATCHING"
  | "OBSERVED_ACCEPTED"
  | "COMPLETED"
  | "UNCERTAIN"
  | "FAILED_SAFE"
  | "CANCELLED";

/** Real: SubmissionDispatchReceipt.outcome. */
export type FixtureDispatchOutcome = "dispatched" | "uncertain";

/** Real: SubmissionReconcileResult.outcome. */
export type FixtureReconcileOutcome =
  | "PROVEN_ACCEPTED"
  | "PROVEN_NOT_ACCEPTED"
  | "STILL_AMBIGUOUS";

/** Real: ChildLifecycleState (src/core/child-worker.ts). */
export type FixtureChildState =
  | "PLANNED"
  | "SPAWNING"
  | "BOOTSTRAPPING"
  | "ACTIVE"
  | "RESULT_READY"
  | "RETURNING"
  | "COMPLETED"
  | "RETIRED"
  | "SPAWN_UNCERTAIN"
  | "BROKEN"
  | "CANCELLED";

/**
 * Event-row provenance for the diagnostic merge (no new event store, no
 * invented global sequence). Each source is an existing runtime record.
 */
export type FixtureEventSource =
  | "execution-journal"
  | "reducer-audit"
  | "submission-ledger"
  | "child-ledger"
  | "work-item"
  | "carrier-observation";

/** Presentation tone for a fact value; carries no backend semantics. */
export type FixtureTone = "neutral" | "ready" | "warn" | "error";

/**
 * Read-only diagnostic merge of existing runtime records. Rows are ordered
 * by timestamp for display only — the sources have no shared seq.
 */
export interface ConsoleEvent {
  timestamp: number;
  source: FixtureEventSource;
  eventType: string;
  subjectRef: string;
  correlationRef?: string;
  severity?: "info" | "warning";
  detail?: string;
}

export interface HarnessConsoleSnapshot {
  scenario: HarnessScenarioId;
  scenarioLabel: string;
  /** When the projection was assembled. Console-level only (see header). */
  projectionBuiltAt: number;

  workItem: {
    workItemId: string;
    title: string;
    status: FixtureWorkItemStatus;
    revision: number;
    coldStart: FixtureColdStartState;
    /** Real WorkItem.updatedAt, projected as epoch ms. */
    updatedAt: number;
  };

  primaryThread: {
    logicalThreadId: string;
    role: string;

    /** Real: CurrentConversationBinding + WorkItemBinding.carrierRef. */
    binding: {
      providerConversationRef: string;
      carrierRef: string;
      generation: number;
      mutationAt: number;
    };

    runtime: {
      /** Real: ActuationLease (contract carries no expiry/heartbeat). */
      lease: {
        carrierRef: string;
        leaseGeneration: number;
        claimedBy: FixtureReducerActor;
        claimedAt: number;
      } | null;

      /**
       * Real: SubmissionAuthority — the ledger's durable claim context
       * (authorityGeneration / establishedAt / explicitGo / carrier state).
       */
      authority?: {
        authorityGeneration: number;
        authorityEstablishedAt: number;
        carrierState: "READY";
        logicalControl: FixtureLogicalControl;
        explicitGo: boolean;
      };

      /**
       * Browser-side observation of the bound carrier. Shape mixes real
       * sources: carrierState union (incl. SUSPENDED/RECOVERING) is
       * GoalReanchorRuntime.carrierState (goal-reanchor.ts); providerFailure
       * is SubmissionObservation.providerFailure (submission-operation.ts);
       * lastTurnRef has NO direct source (nearest real concept is
       * SubmissionOperation.resultingTurnRef). FIXTURE-ONLY as a persisted
       * readable snapshot until a bridge defines the projection.
       */
      carrierObservation?: {
        carrierState: FixtureCarrierState;
        observedAt: number;
        lastTurnRef: string | null;
        providerFailure?: boolean;
      };
    };
  };

  /** Active (non-terminal) submission, if any. Mirrors SubmissionOperation. */
  currentOperation?: {
    operationId: string;
    operationKind: FixtureOperationKind;
    state: FixtureOperationState;
    workItemId: string;
    logicalThreadId: string;
    targetCarrierRef: string;
    providerConversationRef?: string;
    payloadFingerprint: string;
    createdAt: number;
    lastObservedAt: number;

    /** Real: preSubmitBaseline — the dispatch-time predecessor observation. */
    preSubmitBaseline: {
      assistantMessageCount: number;
      userMessageCount: number;
      headFingerprint: string;
      observedAt: number;
    };

    /** Real: dispatchClaimedAt + SubmissionDispatchFence fields. */
    dispatchClaim?: {
      claimedAt: number;
      leaseGeneration: number;
      leaseOwnerRef: string;
    } | null;

    /** Real: SubmissionDispatchReceipt. */
    dispatchReceipt?: {
      attemptedAt: number;
      outcome: FixtureDispatchOutcome;
    };

    /** Real: last reconciliation evidence projection. */
    reconciliation?: {
      outcome: FixtureReconcileOutcome;
      observedAt: number;
    };

    /** Real: turn observed in the provider conversation, when established. */
    resultingTurnRef?: string;

    /** Real: SubmissionOperation.error. */
    error?: string;
  };

  lastCompletedOperation?: {
    operationId: string;
    operationKind: FixtureOperationKind;
    completedAt: number;
    resultingTurnRef?: string;
  };

  childThreads: Array<{
    childThreadId: string;
    role: string;
    state: FixtureChildState;
    carrierRef: string | null;
    /** Real ChildWorkerRecord.createdAt / updatedAt, epoch ms. */
    createdAt: number;
    updatedAt: number;
    fact: string;
  }>;

  /** Diagnostic merge (see ConsoleEvent). FIXTURE until a bridge exists. */
  events: ConsoleEvent[];
}
