import { describe, expect, it } from "vitest";
import { GoalReanchorLedger, type GoalReanchorState, type GoalReanchorStore } from "../src/core/goal-reanchor";

class MemoryStore implements GoalReanchorStore {
  value?: GoalReanchorState;
  load(): GoalReanchorState | undefined { return this.value; }
  save(state: GoalReanchorState): void { this.value = structuredClone(state); }
}

describe("GoalReanchorLedger", () => {
  it("increments only substantive completed generations and deduplicates after recovery", () => {
    const store = new MemoryStore();
    const ledger = new GoalReanchorLedger({ logicalThreadId: "pdlt-1", experimentalN: 2, store });
    expect(ledger.recordDesignGeneration("g1").accepted).toBe(true);
    expect(ledger.recordDesignGeneration("g1").duplicate).toBe(true);
    expect(ledger.recordDesignGeneration("draft", false).accepted).toBe(false);
    expect(ledger.recordDesignGeneration("g2").state.designTurnsSinceAnchor).toBe(2);

    const recovered = new GoalReanchorLedger({ logicalThreadId: "pdlt-1", experimentalN: 2, store });
    expect(recovered.recordDesignGeneration("g2").duplicate).toBe(true);
    expect(recovered.state.designTurnsSinceAnchor).toBe(2);
  });

  it("raises one experimental-N operation and does not reset before completion", () => {
    const ledger = new GoalReanchorLedger({ logicalThreadId: "pdlt-1", experimentalN: 2, now: () => 10 });
    ledger.recordDesignGeneration("g1");
    expect(ledger.requestReanchor("experimental_n", "anchor-1").eligible).toBe(false);
    ledger.recordDesignGeneration("g2");
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
      const ledger = new GoalReanchorLedger({ logicalThreadId: "pdlt-1", experimentalN: 99 });
      const result = ledger.onLifecycleEvent(event, `operation-${event}`);
      expect(result).toMatchObject({ eligible: true, created: true });
    }
  );

  it("deduplicates different event signals while one anchor is pending", () => {
    const ledger = new GoalReanchorLedger({ logicalThreadId: "pdlt-1", experimentalN: 3 });
    const first = ledger.onLifecycleEvent("compaction", "anchor-compaction");
    const second = ledger.onLifecycleEvent("rollover", "anchor-rollover");
    expect(first.operation?.operationId).toBe("anchor-compaction");
    expect(second).toMatchObject({ eligible: true, created: false, operation: { operationId: "anchor-compaction" } });
    expect(Object.keys(ledger.state.operations)).toEqual(["anchor-compaction"]);
    expect(() => ledger.requestReanchor("scope_correction", "anchor-compaction")).toThrow(/different trigger/);
  });

  it("recovers a pending operation and resets only once after completion", () => {
    const store = new MemoryStore();
    const ledger = new GoalReanchorLedger({ logicalThreadId: "pdlt-1", experimentalN: 1, store });
    ledger.recordDesignGeneration("g1");
    ledger.requestReanchor("experimental_n", "anchor-1", 10);

    const recovered = new GoalReanchorLedger({ logicalThreadId: "pdlt-1", experimentalN: 1, store });
    expect(recovered.requestReanchor("experimental_n", "retry-with-same-id", 11)).toMatchObject({
      created: false,
      operation: { operationId: "anchor-1", status: "PENDING" }
    });
    expect(recovered.completeReanchor("anchor-1", 12).duplicate).toBe(false);
    expect(recovered.completeReanchor("anchor-1", 13).duplicate).toBe(true);
    expect(recovered.state.designTurnsSinceAnchor).toBe(0);
  });

  it("rejects malformed or incomplete durable state", () => {
    expect(() => new GoalReanchorLedger({
      logicalThreadId: "pdlt-1",
      experimentalN: 2,
      initialState: { version: 1, logicalThreadId: "pdlt-1", designTurnsSinceAnchor: -1, anchorRevision: 0, experimentalN: 2, completedGenerationIds: [], operations: {} }
    })).toThrow(/counter/);
    expect(() => new GoalReanchorLedger({ logicalThreadId: "pdlt-1", experimentalN: 0 })).toThrow(/experimentalN/);
  });
});
