/**
 * Harness Dogfood Console v0 — fixture scenarios.
 *
 * The Hub has no harness data source yet (the projection should eventually
 * be built by the extension background coordinator and pushed over the
 * existing 127.0.0.1:17642 bridge), so the console renders these snapshots.
 * Scenarios track the CURRENT runtime lifecycle only:
 *
 *   A · Stable / Idle          — no active submission, last GO completed.
 *   B · Active Submission      — GO in DISPATCHING (claimed + blind-dispatched,
 *                                observation pending; settle cap: receipt
 *                                evidence alone can only establish UNCERTAIN).
 *   C · Attention / Recovery   — GO in UNCERTAIN with ambiguous reconciliation,
 *                                stale carrier observation, one child in
 *                                SPAWN_UNCERTAIN.
 *
 * Future/exploratory vocabulary (ROLLOVER, policy AUTHORIZED, first-apply
 * gate) is deliberately absent until matching runtime support exists.
 *
 * Recent Runtime Events scope is frozen to Primary Thread / current (or
 * last) operation evidence — no work-item or standalone child-ledger rows
 * (they surface on the scope strip and Child Threads respectively).
 */

import type {
  ConsoleEvent,
  HarnessConsoleSnapshot,
  HarnessScenarioId
} from "./types";

export const harnessScenarioIds: HarnessScenarioId[] = ["idle", "active-submission", "attention-recovery"];

export const harnessScenarioLabels: Record<HarnessScenarioId, string> = {
  idle: "A · Stable / Idle",
  "active-submission": "B · Active Submission",
  "attention-recovery": "C · Attention / Recovery"
};

interface ConsoleEventInput {
  ageSec: number;
  source: ConsoleEvent["source"];
  eventType: string;
  subjectRef: string;
  correlationRef?: string;
  severity?: ConsoleEvent["severity"];
  detail?: string;
}

function events(now: number, inputs: ConsoleEventInput[]): ConsoleEvent[] {
  return inputs
    .map((input) => ({
      timestamp: now - input.ageSec * 1000,
      source: input.source,
      eventType: input.eventType,
      subjectRef: input.subjectRef,
      correlationRef: input.correlationRef,
      severity: input.severity,
      detail: input.detail
    }))
    .sort((left, right) => right.timestamp - left.timestamp);
}

export function createHarnessSnapshot(scenario: HarnessScenarioId): HarnessConsoleSnapshot {
  switch (scenario) {
    case "active-submission":
      return createActiveSubmissionSnapshot();
    case "attention-recovery":
      return createAttentionRecoverySnapshot();
    case "idle":
    default:
      return createIdleSnapshot();
  }
}

/**
 * Scenario A — Stable / Idle: WorkItem active, binding quiet, no submission
 * in flight. Last GO completed with its turn observed.
 */
function createIdleSnapshot(): HarnessConsoleSnapshot {
  const now = Date.now();

  return {
    scenario: "idle",
    scenarioLabel: harnessScenarioLabels.idle,
    projectionBuiltAt: now - 300,

    workItem: {
      workItemId: "WI-dogfood-001",
      title: "Harness Dogfood Console v0",
      status: "ACTIVE",
      revision: 61,
      coldStart: "READY",
      updatedAt: now - 95 * 1000
    },

    primaryThread: {
      logicalThreadId: "design-thread",
      role: "Design",
      binding: {
        providerConversationRef: "conv-8821",
        carrierRef: "C-8821",
        generation: 4,
        mutationAt: now - 2 * 60 * 60 * 1000
      },
      runtime: {
        lease: {
          carrierRef: "C-8821",
          leaseGeneration: 2,
          claimedBy: "worker",
          claimedAt: now - 9 * 1000
        },
        authority: {
          authorityGeneration: 7,
          authorityEstablishedAt: now - 9 * 1000,
          carrierState: "READY",
          logicalControl: "CONTINUE",
          explicitGo: true
        },
        carrierObservation: {
          carrierState: "READY",
          observedAt: now - 2 * 1000,
          lastTurnRef: "turn-221"
        }
      }
    },

    currentOperation: undefined,

    lastCompletedOperation: {
      operationId: "sub-0173",
      operationKind: "GO",
      completedAt: now - 95 * 1000,
      resultingTurnRef: "turn-221"
    },

    childThreads: [
      {
        childThreadId: "review-thread",
        role: "Review",
        state: "COMPLETED",
        carrierRef: "C-8830",
        createdAt: now - 55 * 60 * 1000,
        updatedAt: now - 6 * 60 * 1000,
        fact: "result delivered"
      },
      {
        childThreadId: "integration-thread",
        role: "Integration",
        state: "ACTIVE",
        carrierRef: "C-8836",
        createdAt: now - 40 * 60 * 1000,
        updatedAt: now - 3 * 60 * 1000,
        fact: "no active submission"
      }
    ],

    events: events(now, [
      { ageSec: 3, source: "execution-journal", eventType: "TURN_COMPLETION_OBSERVED", subjectRef: "sub-0173", correlationRef: "turn-221" },
      { ageSec: 8, source: "execution-journal", eventType: "ACCEPTANCE_OBSERVED", subjectRef: "sub-0173", correlationRef: "fp:a3f2" },
      { ageSec: 11, source: "submission-ledger", eventType: "recorded", subjectRef: "sub-0173", correlationRef: "COMPLETED", detail: "resultingTurnRef turn-221" },
      { ageSec: 15, source: "execution-journal", eventType: "RECONCILIATION_EVIDENCE", subjectRef: "sub-0173", correlationRef: "baseline-v12" },
      { ageSec: 19, source: "execution-journal", eventType: "PROVIDER_ACK", subjectRef: "sub-0173", correlationRef: "turn-220" },
      { ageSec: 20, source: "execution-journal", eventType: "BLIND_DISPATCH_ATTEMPT", subjectRef: "sub-0173", correlationRef: "fence:9c1e" },
      { ageSec: 22, source: "reducer-audit", eventType: "delta.applied", subjectRef: "claim:sub-0173", correlationRef: "dispatch claim (reducer-minted attempt)" },
      { ageSec: 26, source: "submission-ledger", eventType: "prepared", subjectRef: "sub-0173", correlationRef: "GO" },
      { ageSec: 40, source: "reducer-audit", eventType: "delta.applied", subjectRef: "transferActuationLease", correlationRef: "T-014 · lease gen 2" },
      { ageSec: 65, source: "reducer-audit", eventType: "delta.applied", subjectRef: "commitCurrentConversationBinding", correlationRef: "conv-8821 · gen 4" }
    ])
  };
}

/**
 * Scenario B — Active Submission: GO durably PREPARED, dispatch claimed
 * through the reducer (fence minted), blind dispatch attempted with provider
 * ack received — still DISPATCHING while acceptance observation pends. Per
 * the settle cap, receipt/ack evidence alone could only establish UNCERTAIN.
 */
function createActiveSubmissionSnapshot(): HarnessConsoleSnapshot {
  const now = Date.now();

  return {
    scenario: "active-submission",
    scenarioLabel: harnessScenarioLabels["active-submission"],
    projectionBuiltAt: now - 300,

    workItem: {
      workItemId: "WI-dogfood-001",
      title: "Harness Dogfood Console v0",
      status: "ACTIVE",
      revision: 62,
      coldStart: "READY",
      updatedAt: now - 12 * 1000
    },

    primaryThread: {
      logicalThreadId: "design-thread",
      role: "Design",
      binding: {
        providerConversationRef: "conv-8821",
        carrierRef: "C-8821",
        generation: 4,
        mutationAt: now - 2 * 60 * 60 * 1000
      },
      runtime: {
        lease: {
          carrierRef: "C-8821",
          leaseGeneration: 3,
          claimedBy: "system",
          claimedAt: now - 24 * 1000
        },
        authority: {
          authorityGeneration: 8,
          authorityEstablishedAt: now - 24 * 1000,
          carrierState: "READY",
          logicalControl: "CONTINUE",
          explicitGo: true
        },
        carrierObservation: {
          carrierState: "GENERATING",
          observedAt: now - 4 * 1000,
          lastTurnRef: "turn-222"
        }
      }
    },

    currentOperation: {
      operationId: "sub-0181",
      operationKind: "GO",
      state: "DISPATCHING",
      workItemId: "WI-dogfood-001",
      logicalThreadId: "design-thread",
      targetCarrierRef: "C-8821",
      providerConversationRef: "conv-8821",
      payloadFingerprint: "fp:7d41",
      createdAt: now - 26 * 1000,
      lastObservedAt: now - 4 * 1000,

      preSubmitBaseline: {
        assistantMessageCount: 221,
        userMessageCount: 220,
        headFingerprint: "fp:head-9f33",
        observedAt: now - 25 * 1000
      },

      dispatchClaim: {
        claimedAt: now - 24 * 1000,
        leaseGeneration: 3,
        leaseOwnerRef: "worker-shuttle"
      },

      dispatchReceipt: {
        attemptedAt: now - 23 * 1000,
        outcome: "dispatched"
      },

      reconciliation: undefined,
      resultingTurnRef: undefined
    },

    lastCompletedOperation: {
      operationId: "sub-0173",
      operationKind: "GO",
      completedAt: now - 95 * 1000,
      resultingTurnRef: "turn-221"
    },

    childThreads: [
      {
        childThreadId: "review-thread",
        role: "Review",
        state: "RESULT_READY",
        carrierRef: "C-8830",
        createdAt: now - 55 * 60 * 1000,
        updatedAt: now - 2 * 60 * 1000,
        fact: "result ready · 等待 delivery"
      },
      {
        childThreadId: "integration-thread",
        role: "Integration",
        state: "ACTIVE",
        carrierRef: "C-8836",
        createdAt: now - 40 * 60 * 1000,
        updatedAt: now - 3 * 60 * 1000,
        fact: "no active submission"
      }
    ],

    events: events(now, [
      { ageSec: 4, source: "carrier-observation", eventType: "carrier_state", subjectRef: "C-8821", correlationRef: "GENERATING", detail: "sourceEpoch stable" },
      { ageSec: 6, source: "execution-journal", eventType: "PROVIDER_ACK", subjectRef: "sub-0181", correlationRef: "fence:44aa · ack epoch 12" },
      { ageSec: 7, source: "execution-journal", eventType: "BLIND_DISPATCH_ATTEMPT", subjectRef: "sub-0181", correlationRef: "fence:44aa" },
      { ageSec: 9, source: "submission-ledger", eventType: "recorded", subjectRef: "sub-0181", correlationRef: "DISPATCHING" },
      { ageSec: 11, source: "reducer-audit", eventType: "delta.applied", subjectRef: "claim:sub-0181", correlationRef: "dispatch claim (reducer-minted attempt)" },
      { ageSec: 17, source: "submission-ledger", eventType: "prepared", subjectRef: "sub-0181", correlationRef: "GO" },
      { ageSec: 24, source: "reducer-audit", eventType: "delta.applied", subjectRef: "transferActuationLease", correlationRef: "T-014 · lease gen 3" }
    ])  };
}

/**
 * Scenario C — Attention / Recovery: the GO submission sits in UNCERTAIN
 * after an ambiguous reconciliation (STILL_AMBIGUOUS); the carrier
 * observation has gone stale with a provider failure flag; one child worker
 * is parked in SPAWN_UNCERTAIN. Canonical layers stay healthy — the page
 * must show runtime/observation trouble without inventing a global health
 * state.
 */
function createAttentionRecoverySnapshot(): HarnessConsoleSnapshot {
  const now = Date.now();

  return {
    scenario: "attention-recovery",
    scenarioLabel: harnessScenarioLabels["attention-recovery"],
    projectionBuiltAt: now - 400,

    workItem: {
      workItemId: "WI-dogfood-001",
      title: "Harness Dogfood Console v0",
      status: "ACTIVE",
      revision: 63,
      coldStart: "READY",
      updatedAt: now - 4 * 60 * 1000
    },

    primaryThread: {
      logicalThreadId: "design-thread",
      role: "Design",
      binding: {
        providerConversationRef: "conv-8821",
        carrierRef: "C-8821",
        generation: 4,
        mutationAt: now - 2 * 60 * 60 * 1000
      },
      runtime: {
        lease: {
          carrierRef: "C-8821",
          leaseGeneration: 3,
          claimedBy: "system",
          claimedAt: now - 47 * 1000
        },
        authority: {
          authorityGeneration: 8,
          authorityEstablishedAt: now - 47 * 1000,
          carrierState: "READY",
          logicalControl: "CONTINUE",
          explicitGo: true
        },
        carrierObservation: {
          carrierState: "SUSPENDED",
          observedAt: now - 38 * 1000,
          lastTurnRef: "turn-223",
          providerFailure: true
        }
      }
    },

    currentOperation: {
      operationId: "sub-0186",
      operationKind: "GO",
      state: "UNCERTAIN",
      workItemId: "WI-dogfood-001",
      logicalThreadId: "design-thread",
      targetCarrierRef: "C-8821",
      providerConversationRef: "conv-8821",
      payloadFingerprint: "fp:ee07",
      createdAt: now - 45 * 1000,
      lastObservedAt: now - 31 * 1000,

      preSubmitBaseline: {
        assistantMessageCount: 222,
        userMessageCount: 221,
        headFingerprint: "fp:head-91b7",
        observedAt: now - 44 * 1000
      },

      dispatchClaim: {
        claimedAt: now - 43 * 1000,
        leaseGeneration: 3,
        leaseOwnerRef: "worker-shuttle"
      },

      dispatchReceipt: {
        attemptedAt: now - 42 * 1000,
        outcome: "uncertain"
      },

      reconciliation: {
        outcome: "STILL_AMBIGUOUS",
        observedAt: now - 31 * 1000
      },

      resultingTurnRef: undefined,
      error: "acceptance not provable from current observation"
    },

    lastCompletedOperation: {
      operationId: "sub-0181",
      operationKind: "GO",
      completedAt: now - 95 * 1000,
      resultingTurnRef: "turn-222"
    },

    childThreads: [
      {
        childThreadId: "review-thread",
        role: "Review",
        state: "COMPLETED",
        carrierRef: "C-8830",
        createdAt: now - 55 * 60 * 1000,
        updatedAt: now - 6 * 60 * 1000,
        fact: "result delivered"
      },
      {
        childThreadId: "integration-thread",
        role: "Integration",
        state: "SPAWN_UNCERTAIN",
        carrierRef: null,
        createdAt: now - 70 * 1000,
        updatedAt: now - 35 * 1000,
        fact: "spawn 结果未确认 · 等待 probe 恢复"
      }
    ],

    events: events(now, [
      { ageSec: 31, source: "execution-journal", eventType: "RECONCILIATION_EVIDENCE", subjectRef: "sub-0186", correlationRef: "STILL_AMBIGUOUS", severity: "warning", detail: "baseline head 未推进，无法证明 acceptance" },
      { ageSec: 33, source: "submission-ledger", eventType: "recorded", subjectRef: "sub-0186", correlationRef: "UNCERTAIN", severity: "warning" },
      { ageSec: 38, source: "carrier-observation", eventType: "carrier_state", subjectRef: "C-8821", correlationRef: "SUSPENDED", severity: "warning", detail: "providerFailure=true" },
      { ageSec: 40, source: "execution-journal", eventType: "PROVIDER_ACK", subjectRef: "sub-0186", correlationRef: "ack epoch 19" },
      { ageSec: 41, source: "execution-journal", eventType: "BLIND_DISPATCH_ATTEMPT", subjectRef: "sub-0186", correlationRef: "fence:7e02" },
      { ageSec: 43, source: "reducer-audit", eventType: "delta.applied", subjectRef: "claim:sub-0186", correlationRef: "dispatch claim (reducer-minted attempt)" },
      { ageSec: 45, source: "submission-ledger", eventType: "prepared", subjectRef: "sub-0186", correlationRef: "GO" }
    ])
  };
}
