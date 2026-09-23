import { describe, expect, it } from "vitest";
import { GoalReanchorLedger, type GoalReanchorState, type GoalReanchorStore } from "../src/core/goal-reanchor";
import { SubmissionOperationLedger, createChromeSubmissionStore, fingerprintSubmissionPayload, provenNotActuatedRefusal } from "../src/core/submission-operation";

class MemoryStore implements GoalReanchorStore {
  value?: GoalReanchorState;
  load(): GoalReanchorState | undefined { return this.value; }
  save(state: GoalReanchorState): void { this.value = structuredClone(state); }
}

function evidence(generationId: string, substantive = true, completedAt = 1) {
  return { generationId, role: "design" as const, status: "COMPLETED" as const,
    substantive, evidenceFingerprint: `evidence:${generationId}`, completedAt,
    completionEvidence: { source: "WORKER_RESULT" as const, id: `result:${generationId}`, verified: true as const } };
}

describe("GoalReanchorLedger", () => {
  it("rejects self-declared completion without a runtime authority verifier", () => {
    const ledger = new GoalReanchorLedger({ logicalThreadId: "pdlt-1", experimentalN: 1 });
    expect(ledger.recordDesignGeneration(evidence("forged")).accepted).toBe(false);
    const verified = new GoalReanchorLedger({ logicalThreadId: "pdlt-1", experimentalN: 1, verifySubstantive: () => true });
    expect(verified.recordDesignGeneration({ ...evidence("missing"), completionEvidence: undefined }).accepted).toBe(false);
  });
  it("increments only substantive completed generations and deduplicates after recovery", () => {
    const store = new MemoryStore();
    const ledger = new GoalReanchorLedger({ verifySubstantive: value => value.substantive, logicalThreadId: "pdlt-1", experimentalN: 2, store });
    expect(ledger.recordDesignGeneration(evidence("g1")).accepted).toBe(true);
    expect(ledger.recordDesignGeneration(evidence("g1")).duplicate).toBe(true);
    expect(ledger.recordDesignGeneration(evidence("draft", false)).accepted).toBe(false);
    expect(ledger.recordDesignGeneration(evidence("g2")).state.designTurnsSinceAnchor).toBe(2);

    const recovered = new GoalReanchorLedger({ verifySubstantive: value => value.substantive, logicalThreadId: "pdlt-1", experimentalN: 2, store });
    expect(recovered.recordDesignGeneration(evidence("g2")).duplicate).toBe(true);
    expect(recovered.state.designTurnsSinceAnchor).toBe(2);
  });

  it("raises one experimental-N operation and does not reset before completion", () => {
    const ledger = new GoalReanchorLedger({ verifySubstantive: value => value.substantive, logicalThreadId: "pdlt-1", experimentalN: 2, now: () => 10 });
    ledger.recordDesignGeneration(evidence("g1"));
    expect(ledger.requestReanchor("experimental_n", "anchor-1").eligible).toBe(false);
    ledger.recordDesignGeneration(evidence("g2", true, 2));
    const first = ledger.requestReanchor("experimental_n", "anchor-1");
    expect(first).toMatchObject({ eligible: true, created: true, operation: { status: "PENDING" } });
    expect(ledger.state.designTurnsSinceAnchor).toBe(2);
    expect(ledger.requestReanchor("experimental_n", "anchor-1").created).toBe(false);
    expect(ledger.completeReanchor("anchor-1", 20).operation).toMatchObject({
      status: "COMPLETED",
      targetAnchorRevision: 1,
      completedAt: 20
    });
    expect(ledger.state).toMatchObject({ designTurnsSinceAnchor: 0, anchorRevision: 1 });
  });

  it.each(["compaction", "rollover", "review_return", "sedimentation_return", "scope_correction"] as const)(
    "raises immediately for lifecycle event %s",
    event => {
      const ledger = new GoalReanchorLedger({ verifySubstantive: value => value.substantive, logicalThreadId: "pdlt-1", experimentalN: 99 });
      const result = ledger.onLifecycleEvent(event, `operation-${event}`);
      expect(result).toMatchObject({ eligible: true, created: true });
    }
  );

  it("deduplicates different event signals while one anchor is pending", () => {
    const ledger = new GoalReanchorLedger({ verifySubstantive: value => value.substantive, logicalThreadId: "pdlt-1", experimentalN: 3 });
    const first = ledger.onLifecycleEvent("compaction", "anchor-compaction");
    const second = ledger.onLifecycleEvent("rollover", "anchor-rollover");
    expect(first.operation?.operationId).toBe("anchor-compaction");
    expect(second).toMatchObject({ eligible: true, created: false, operation: { operationId: "anchor-compaction" } });
    expect(Object.keys(ledger.state.operations)).toEqual(["anchor-compaction"]);
    expect(() => ledger.requestReanchor("scope_correction", "anchor-compaction")).toThrow(/different trigger/);
  });

  it("recovers a pending operation and resets only once after completion", () => {
    const store = new MemoryStore();
    const ledger = new GoalReanchorLedger({ verifySubstantive: value => value.substantive, logicalThreadId: "pdlt-1", experimentalN: 1, store });
    ledger.recordDesignGeneration(evidence("g1"));
    ledger.requestReanchor("experimental_n", "anchor-1", 10);

    const recovered = new GoalReanchorLedger({ verifySubstantive: value => value.substantive, logicalThreadId: "pdlt-1", experimentalN: 1, store });
    expect(recovered.requestReanchor("experimental_n", "retry-with-same-id", 11)).toMatchObject({
      created: false,
      operation: { operationId: "anchor-1", status: "PENDING" }
    });
    expect(recovered.completeReanchor("anchor-1", 12).duplicate).toBe(false);
    expect(recovered.completeReanchor("anchor-1", 13).duplicate).toBe(true);
    expect(recovered.state.designTurnsSinceAnchor).toBe(0);
  });

  it("rejects malformed or incomplete durable state", () => {
    expect(() => new GoalReanchorLedger({ verifySubstantive: value => value.substantive,
      logicalThreadId: "pdlt-1",
      experimentalN: 2,
      initialState: { version: 1, logicalThreadId: "pdlt-1", designTurnsSinceAnchor: -1, anchorRevision: 0, experimentalN: 2, completedGenerationIds: [], operations: {} }
    })).toThrow(/counter/);
    expect(() => new GoalReanchorLedger({ verifySubstantive: value => value.substantive, logicalThreadId: "pdlt-1", experimentalN: 0 })).toThrow(/experimentalN/);
    expect(() => new GoalReanchorLedger({ verifySubstantive: value => value.substantive,
      logicalThreadId: "pdlt-1", experimentalN: 2,
      initialState: {
        version: 1, logicalThreadId: "pdlt-1", designTurnsSinceAnchor: 0, anchorRevision: 1,
        experimentalN: 2, completedGenerationIds: [],
        operations: {
          stale: { operationId: "stale", trigger: "compaction", sourceAnchorRevision: 0,
            targetAnchorRevision: 1, requestedAt: 2, status: "PENDING" }
        }
      }
    })).toThrow(/stale/);
    expect(() => new GoalReanchorLedger({ verifySubstantive: value => value.substantive,
      logicalThreadId: "pdlt-1", experimentalN: 2,
      initialState: {
        version: 1, logicalThreadId: "pdlt-1", designTurnsSinceAnchor: 0, anchorRevision: 1,
        experimentalN: 2, completedGenerationIds: [],
        operations: {
          incomplete: { operationId: "incomplete", trigger: "compaction", sourceAnchorRevision: 0,
            targetAnchorRevision: 1, requestedAt: 2, status: "COMPLETED" }
        }
      }
    })).toThrow(/completedAt/);
  });

  it("requires completed evidence and retains deduplication beyond the in-memory window", () => {
    const ledger = new GoalReanchorLedger({ verifySubstantive: value => value.substantive, logicalThreadId: "pdlt-1", experimentalN: 999 });
    for (let index = 0; index < 300; index += 1) {
      expect(ledger.recordDesignGeneration({
        generationId: `g-${index}`, role: "design", status: "COMPLETED", substantive: true,
        evidenceFingerprint: `e-${index}`, completedAt: index + 1,
        completionEvidence: { source: "WORKER_RESULT", id: `result:g-${index}`, verified: true }
      }).accepted).toBe(true);
    }
    expect(ledger.recordDesignGeneration(evidence("g-0")).duplicate).toBe(true);
    expect(() => ledger.recordDesignGeneration({
      generationId: "bad", role: "design", status: "COMPLETED", substantive: true,
      evidenceFingerprint: "", completedAt: 1, completionEvidence: { source: "WORKER_RESULT", id: "r", verified: true }
    })).toThrow(/evidenceFingerprint/);
  });

  it("tracks the backing submission identity and supersedes rotations durably", () => {
    const store = new MemoryStore();
    const ledger = new GoalReanchorLedger({ verifySubstantive: value => value.substantive, logicalThreadId: "pdlt-1", experimentalN: 1, store });
    ledger.recordDesignGeneration(evidence("g1"));
    ledger.requestReanchor("rollover", "anchor-1", 10);
    const first = "reanchor:pdlt-1:1:c1:tab-1:abcd1234";
    const second = "reanchor:pdlt-1:1:c2:tab-2:abcd1234";
    expect(ledger.noteSubmissionOperation("anchor-1", first)).toMatchObject({
      submissionOperationId: first,
      supersededSubmissionOperationIds: []
    });
    expect(ledger.noteSubmissionOperation("anchor-1", second)).toMatchObject({
      submissionOperationId: second,
      supersededSubmissionOperationIds: [first]
    });
    // Re-noting the current identity is idempotent and never self-supersedes.
    expect(ledger.noteSubmissionOperation("anchor-1", second).supersededSubmissionOperationIds).toEqual([first]);
    expect(() => ledger.noteSubmissionOperation("unknown-anchor", second)).toThrow(/unknown/);
    ledger.completeReanchor("anchor-1", 20);
    expect(() => ledger.noteSubmissionOperation("anchor-1", "reanchor:pdlt-1:1:c3:tab-3:abcd1234")).toThrow(/pending/);

    const recovered = new GoalReanchorLedger({ verifySubstantive: value => value.substantive, logicalThreadId: "pdlt-1", experimentalN: 1, store });
    expect(recovered.state.operations["anchor-1"]).toMatchObject({
      status: "COMPLETED",
      submissionOperationId: second,
      supersededSubmissionOperationIds: [first]
    });
    expect(() => new GoalReanchorLedger({ verifySubstantive: value => value.substantive,
      logicalThreadId: "pdlt-1", experimentalN: 1,
      initialState: { version: 1, logicalThreadId: "pdlt-1", designTurnsSinceAnchor: 0, anchorRevision: 0,
        experimentalN: 1, completedGenerationIds: [],
        operations: { bad: { operationId: "bad", trigger: "rollover", sourceAnchorRevision: 0, targetAnchorRevision: 1,
          requestedAt: 1, status: "PENDING", submissionOperationId: "x", supersededSubmissionOperationIds: ["x"] } } }
    })).toThrow(/both current and superseded/);
  });

  it("executes a re-anchor through the durable submission ledger and resets only after accepted evidence", async () => {
    let value: Record<string, unknown> = {};
    const store = {
      get: async (_key: string) => value,
      set: async (next: Record<string, unknown>) => { Object.assign(value, next); }
    };
    const submissionLedger = new SubmissionOperationLedger(createChromeSubmissionStore(store, { claimViaCoordinator: false, lock: async work => work() }));
    const claimContext = { logicalThreadId: "pdlt-1", providerConversationRef: "c1", targetCarrierRef: "tab-1",
      bindingEpoch: 1, leaseGeneration: 1, leaseOwnerRef: "owner", explicitGo: true,
      carrierState: "READY" as const, logicalControl: "CONTINUE" as const, sourceEpoch: 1, sourceObservedAt: 10 };
    await submissionLedger.initializeAuthority(claimContext);
    const ledger = new GoalReanchorLedger({ verifySubstantive: value => value.substantive, logicalThreadId: "pdlt-1", experimentalN: 1 });
    ledger.recordDesignGeneration(evidence("g1"));
    const result = await ledger.executeReanchor("experimental_n", "anchor-1", {
      carrierState: "READY", logicalControl: "CONTINUE", targetCarrierRef: "tab-1",
      providerConversationRef: "c1", claimContext,
      baseline: { routeRef: "/c/c1", conversationRef: "c1", assistantMessageCount: 1,
        userMessageCount: 1, headFingerprint: "h1", observedAt: 10 },
      dispatch: async () => ({ routeRef: "/c/c1", conversationRef: "c1", assistantMessageCount: 1,
        userMessageCount: 2, headFingerprint: "h2", observedAt: 5010, sourceEpoch: 1,
        stableSince: 10, generationActive: false, lastUserMessageFingerprint: fingerprintSubmissionPayload("anchor"), dispatchFence: claimContext })
    }, submissionLedger, { workItemId: "w1", payload: "anchor",
      payloadFingerprint: fingerprintSubmissionPayload("anchor"), now: 10 });
    expect(result).toMatchObject({ completed: true, operation: { status: "COMPLETED" } });
    expect(ledger.state).toMatchObject({ anchorRevision: 1, designTurnsSinceAnchor: 0 });
    expect((await submissionLedger.get("anchor-1"))?.operationKind).toBe("REANCHOR_GOAL");
  });

  it("converges a proven pre-write refusal to PREPARED instead of UNCERTAIN (issue #108)", async () => {
    let value: Record<string, unknown> = {};
    const store = {
      get: async (_key: string) => value,
      set: async (next: Record<string, unknown>) => { Object.assign(value, next); }
    };
    const submissionLedger = new SubmissionOperationLedger(createChromeSubmissionStore(store, { claimViaCoordinator: false, lock: async work => work() }));
    const claimContext = { logicalThreadId: "pdlt-1", providerConversationRef: "c1", targetCarrierRef: "tab-1",
      bindingEpoch: 1, leaseGeneration: 1, leaseOwnerRef: "owner", explicitGo: true,
      carrierState: "READY" as const, logicalControl: "CONTINUE" as const, sourceEpoch: 1, sourceObservedAt: 10 };
    await submissionLedger.initializeAuthority(claimContext);
    const ledger = new GoalReanchorLedger({ verifySubstantive: value => value.substantive, logicalThreadId: "pdlt-1", experimentalN: 1 });
    ledger.recordDesignGeneration(evidence("g1"));
    const result = await ledger.executeReanchor("experimental_n", "anchor-1", {
      carrierState: "READY", logicalControl: "CONTINUE", targetCarrierRef: "tab-1",
      providerConversationRef: "c1", claimContext,
      baseline: { routeRef: "/c/c1", conversationRef: "c1", assistantMessageCount: 1,
        userMessageCount: 1, headFingerprint: "h1", observedAt: 10 },
      // The carrier's composer held a draft: the refusal happened before any
      // provider-facing write, so it is provably not actuated.
      dispatch: async () => { throw provenNotActuatedRefusal("chatgpt_composer_not_empty"); }
    }, submissionLedger, { workItemId: "w1", payload: "anchor",
      payloadFingerprint: fingerprintSubmissionPayload("anchor"), now: 10 });
    // The anchor cycle did not complete — the transport simply did not happen.
    expect(result).toMatchObject({ operation: { status: "PENDING" } });
    const operation = await submissionLedger.get("anchor-1");
    expect(operation?.state).toBe("PREPARED");
    expect(operation?.dispatchReceipt?.outcome).toBe("refused");
    expect(operation?.error).toBe("chatgpt_composer_not_empty");
  });
});
