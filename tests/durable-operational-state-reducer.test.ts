import { describe, expect, it } from "vitest";
import {
  DurableOperationalStateReducer,
  OPERATIONAL_STATE_REDUCER_KEY,
  createChromeOperationalStateReducerStore,
  stateFingerprint,
  type DeltaApplyRecord,
  type DeltaAuditRecord,
  type DurableStateBundle,
  type OperationalStateReducerStore,
} from "../src/core/durable-operational-state-reducer";
import type { OperationalStateReducer, OperationalStateReducerState } from "../src/core/operational-state-reducer";

function memoryStore(): OperationalStateReducerStore & { saved: DurableStateBundle[] } {
  let current: DurableStateBundle | undefined;
  const saved: DurableStateBundle[] = [];
  return {
    load: async () => current,
    save: async bundle => { current = bundle; saved.push(bundle); },
    saved
  };
}

const commit = (logicalThreadId: string, providerConversationRef: string, now = 1) => (reducer: OperationalStateReducer) =>
  reducer.commitCurrentConversationBinding({ logicalThreadId, providerConversationRef, expected: null, actor: "system", now });

function bundleStore(initial?: DurableStateBundle): OperationalStateReducerStore & { current: () => DurableStateBundle | undefined } {
  let current = initial;
  return {
    load: async () => current,
    save: async bundle => { current = bundle; },
    current: () => current
  };
}

describe("durable operational state reducer", () => {
  it("persists the post-state before committing it in memory", async () => {
    const store = memoryStore();
    const reducer = await DurableOperationalStateReducer.restore(store);
    const result = await reducer.applyResult(commit("t1", "c1"));
    expect(result.ok).toBe(true);
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0].state?.bindings.t1).toMatchObject({ providerConversationRef: "c1" });
    expect(reducer.getBinding("t1")).toMatchObject({ providerConversationRef: "c1" });
  });

  it("does not persist a rejected mutation", async () => {
    const store = memoryStore();
    const reducer = await DurableOperationalStateReducer.restore(store);
    await reducer.applyResult(commit("t1", "c1"));
    const conflict = await reducer.applyResult(commit("t2", "c1"));
    expect(conflict.ok).toBe(false);
    expect(store.saved).toHaveLength(1);
    expect(reducer.getBinding("t2")).toBeUndefined();
  });

  it("leaves the in-memory state unchanged when persistence fails", async () => {
    const store: OperationalStateReducerStore = { load: async () => undefined, save: async () => { throw new Error("disk_full"); } };
    const reducer = await DurableOperationalStateReducer.restore(store);
    await expect(reducer.applyResult(commit("t1", "c1"))).rejects.toThrow("disk_full");
    expect(reducer.getBinding("t1")).toBeUndefined();
    expect(reducer.snapshot().bindings).toEqual({});
  });

  it("restores the persisted state on restart", async () => {
    const store = memoryStore();
    const first = await DurableOperationalStateReducer.restore(store);
    await first.applyResult(commit("t1", "c1"));
    const restarted = await DurableOperationalStateReducer.restore(store);
    expect(restarted.getBinding("t1")).toMatchObject({ providerConversationRef: "c1" });
  });

  it("refuses to restore corrupt persisted state", async () => {
    const store: OperationalStateReducerStore = {
      load: async () => ({
        state: { bindings: { t1: { logicalThreadId: "t1" } }, leases: {}, operations: {} } as unknown as OperationalStateReducerState,
        applyResults: [],
        auditRecords: []
      }),
      save: async () => undefined
    };
    await expect(DurableOperationalStateReducer.restore(store)).rejects.toThrow();
  });

  it("keeps serving mutations after a persistence failure", async () => {
    let failNext = true;
    const saved: DurableStateBundle[] = [];
    const store: OperationalStateReducerStore = {
      load: async () => undefined,
      save: async bundle => { if (failNext) { failNext = false; throw new Error("disk_full"); } saved.push(bundle); }
    };
    const reducer = await DurableOperationalStateReducer.restore(store);
    await expect(reducer.applyResult(commit("t1", "c1"))).rejects.toThrow("disk_full");
    const retry = await reducer.applyResult(commit("t1", "c1"));
    expect(retry.ok).toBe(true);
    expect(reducer.getBinding("t1")).toMatchObject({ providerConversationRef: "c1" });
    expect(saved).toHaveLength(1);
  });

  it("leaves state and storage untouched when the mutation callback throws", async () => {
    const store = memoryStore();
    const reducer = await DurableOperationalStateReducer.restore(store);
    await expect(reducer.applyResult(() => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(store.saved).toHaveLength(0);
    expect(reducer.snapshot().bindings).toEqual({});
  });

  it("round-trips through the chrome storage adapter", async () => {
    const backing: Record<string, unknown> = {};
    const adapter = createChromeOperationalStateReducerStore({
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
    });
    const reducer = await DurableOperationalStateReducer.restore(adapter);
    await reducer.applyDelta({
      deltaId: "SD-1",
      deltaFingerprint: "fp-1",
      reason: "initial binding",
      mutate: commit("t1", "c1")
    });
    expect(backing[OPERATIONAL_STATE_REDUCER_KEY]).toBeDefined();
    const restarted = await DurableOperationalStateReducer.restore(adapter);
    expect(restarted.getBinding("t1")).toMatchObject({ providerConversationRef: "c1" });
  });

  it("serializes concurrent mutations so neither is lost", async () => {
    const store = memoryStore();
    const reducer = await DurableOperationalStateReducer.restore(store);
    await Promise.all([
      reducer.applyResult(commit("t1", "c1")),
      reducer.applyResult(commit("t2", "c2"))
    ]);
    expect(store.saved).toHaveLength(2);
    expect(reducer.getBinding("t1")).toBeDefined();
    expect(reducer.getBinding("t2")).toBeDefined();
    expect(store.saved[store.saved.length - 1].state?.bindings).toHaveProperty("t1");
    expect(store.saved[store.saved.length - 1].state?.bindings).toHaveProperty("t2");
  });
});

describe("applyDelta (State Delta + Reducer Contract §2.4, §15)", () => {
  const delta = {
    deltaId: "SD-087",
    deltaFingerprint: "sha256:abc",
    reason: "rollover to fresh conversation",
    detail: { actor: "system" }
  };

  it("applies once, persists the ApplyResult and audit record in the same transaction", async () => {
    const store = memoryStore();
    const reducer = await DurableOperationalStateReducer.restore(store);
    const outcome = await reducer.applyDelta({ ...delta, mutate: commit("t1", "c1") });
    expect(outcome.outcome).toBe("applied");
    if (outcome.outcome !== "applied" && outcome.outcome !== "no_op") throw new Error("unreachable");
    expect(outcome.record).toMatchObject({ deltaId: "SD-087", outcome: "applied", auditRecordId: "ar:SD-087:1" });
    expect(outcome.record.fromStateFingerprint).toMatch(/^state:[0-9a-f]+$/);
    expect(outcome.record.toStateFingerprint).not.toBe(outcome.record.fromStateFingerprint);
    const audit = reducer.auditTrail();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ auditRecordId: "ar:SD-087:1", deltaId: "SD-087", reason: delta.reason });
    const last = store.saved[store.saved.length - 1];
    expect(last.applyResults).toHaveLength(1);
    expect(last.auditRecords).toHaveLength(1);
  });

  it("replays the original ApplyResult without re-executing (§15.2)", async () => {
    const store = memoryStore();
    const reducer = await DurableOperationalStateReducer.restore(store);
    let executions = 0;
    const mutate = (r: OperationalStateReducer) => { executions += 1; return commit("t1", "c1")(r); };
    const first = await reducer.applyDelta({ ...delta, mutate });
    expect(first.outcome).toBe("applied");
    const before = stateFingerprint(reducer.snapshot());
    const replay = await reducer.applyDelta({ ...delta, mutate });
    expect(executions).toBe(1);
    expect(replay).toMatchObject({ outcome: "applied", replayed: true });
    // Replay leaves the authoritative state byte-identical.
    expect(stateFingerprint(reducer.snapshot())).toBe(before);
    if (replay.outcome === "applied" || replay.outcome === "no_op") {
      expect(replay.record).toEqual(first.outcome === "applied" ? (first as { record: DeltaApplyRecord }).record : replay.record);
    }
    expect(store.saved).toHaveLength(1);
  });

  it("keeps in-memory audit clean when persisting a rejection fails", async () => {
    let failNext = false;
    const saved: DurableStateBundle[] = [];
    const store: OperationalStateReducerStore = {
      load: async () => undefined,
      save: async bundle => { if (failNext) { failNext = false; throw new Error("disk_full"); } saved.push(bundle); }
    };
    const reducer = await DurableOperationalStateReducer.restore(store);
    await reducer.applyResult(commit("t0", "c0"));
    failNext = true;
    const before = stateFingerprint(reducer.snapshot());
    // The stale rejection's audit write hits the failing store: like the applied
    // path, an unpersisted transaction is not acknowledged — it throws, and
    // nothing may leak into memory.
    await expect(reducer.applyDelta({
      ...delta, deltaId: "SD-1", expectedBaseStateFingerprint: "state:nomatch", mutate: commit("t1", "c1")
    })).rejects.toThrow("disk_full");
    expect(reducer.auditTrail()).toHaveLength(0);
    expect(stateFingerprint(reducer.snapshot())).toBe(before);
    // Only the earlier preparation write exists; the failed rejection wrote nothing.
    expect(saved).toHaveLength(1);
    // Once persistence works again the rejection is durably audited, exactly once.
    const retry = await reducer.applyDelta({
      ...delta, deltaId: "SD-1", expectedBaseStateFingerprint: "state:nomatch", mutate: commit("t1", "c1")
    });
    expect(retry.outcome).toBe("rejected_stale");
    expect(reducer.auditTrail()).toHaveLength(1);
    // A rejected delta has no ApplyResult, so its id stays free for real work;
    // the invariant guard applies only to successfully applied ids.
    const applied = await reducer.applyDelta({ ...delta, deltaId: "SD-2", mutate: commit("t1", "c1") });
    expect(applied.outcome).toBe("applied");
    const rejected = await reducer.applyDelta({ ...delta, deltaId: "SD-2", deltaFingerprint: "fp-other", mutate: commit("t2", "c2") });
    expect(rejected.outcome).toBe("rejected_invariant");
    expect(reducer.auditTrail()).toHaveLength(3);
  });

  it("rejects a delta without a reason before entering the transaction", async () => {
    const store = memoryStore();
    const reducer = await DurableOperationalStateReducer.restore(store);
    await expect(reducer.applyDelta({ ...delta, reason: "   ", mutate: commit("t1", "c1") })).rejects.toThrow("delta_reason_required");
    expect(store.saved).toHaveLength(0);
    expect(reducer.snapshot().bindings).toEqual({});
  });

  it("keeps in-memory audit clean when persisting a precondition or invariant rejection fails", async () => {
    // Precondition branch: the reducer rejects the mutation itself.
    {
      let failNext = false;
      const saved: DurableStateBundle[] = [];
      const store: OperationalStateReducerStore = {
        load: async () => undefined,
        save: async bundle => { if (failNext) { failNext = false; throw new Error("disk_full"); } saved.push(bundle); }
      };
      const reducer = await DurableOperationalStateReducer.restore(store);
      await reducer.applyResult(commit("t0", "c0"));
      failNext = true;
      const before = stateFingerprint(reducer.snapshot());
      await expect(reducer.applyDelta({ ...delta, deltaId: "SD-1", mutate: commit("t2", "c0") }))
        .rejects.toThrow("disk_full");
      expect(reducer.auditTrail()).toHaveLength(0);
      expect(stateFingerprint(reducer.snapshot())).toBe(before);
      expect(saved).toHaveLength(1);
      const retry = await reducer.applyDelta({ ...delta, deltaId: "SD-1", mutate: commit("t2", "c0") });
      expect(retry.outcome).toBe("rejected_precondition");
      expect(reducer.auditTrail()).toHaveLength(1);
    }
    // Invariant branch: a successfully applied deltaId reused with a different fingerprint.
    {
      let failNext = false;
      const saved: DurableStateBundle[] = [];
      const store: OperationalStateReducerStore = {
        load: async () => undefined,
        save: async bundle => { if (failNext) { failNext = false; throw new Error("disk_full"); } saved.push(bundle); }
      };
      const reducer = await DurableOperationalStateReducer.restore(store);
      await reducer.applyDelta({ ...delta, deltaId: "SD-9", mutate: commit("t1", "c1") });
      failNext = true;
      const before = stateFingerprint(reducer.snapshot());
      await expect(reducer.applyDelta({ ...delta, deltaId: "SD-9", deltaFingerprint: "fp-other", mutate: commit("t2", "c2") }))
        .rejects.toThrow("disk_full");
      expect(reducer.auditTrail()).toHaveLength(1);
      expect(stateFingerprint(reducer.snapshot())).toBe(before);
      expect(saved).toHaveLength(1);
    }
  });

  it("returns copies that cannot poison internal replay decisions", async () => {
    const store = memoryStore();
    const reducer = await DurableOperationalStateReducer.restore(store);
    const first = await reducer.applyDelta({ ...delta, mutate: commit("t1", "c1") });
    if (first.outcome !== "applied") throw new Error("expected applied");
    first.record.deltaFingerprint = "tampered";
    reducer.appliedDeltas()[0].deltaId = "tampered";
    reducer.auditTrail()[0].detail.injected = true;
    // The internal record is untouched: replay still matches the real identity...
    const replay = await reducer.applyDelta({ ...delta, mutate: () => { throw new Error("must not re-execute"); } });
    expect(replay.outcome).toBe("applied");
    // ...and the tampered fingerprint would have tripped the invariant guard.
    const poisoned = await reducer.applyDelta({ ...delta, deltaFingerprint: "tampered", mutate: commit("t2", "c2") });
    expect(poisoned.outcome).toBe("rejected_invariant");
    expect(reducer.auditTrail()[0].detail).not.toHaveProperty("injected");
  });

  it("rejects a reused deltaId carrying different content (§15.3)", async () => {
    const store = memoryStore();
    const reducer = await DurableOperationalStateReducer.restore(store);
    await reducer.applyDelta({ ...delta, mutate: commit("t1", "c1") });
    const tampered = await reducer.applyDelta({ ...delta, deltaFingerprint: "sha256:other", mutate: commit("t2", "c2") });
    expect(tampered.outcome).toBe("rejected_invariant");
    expect(reducer.getBinding("t2")).toBeUndefined();
    // The rejected attempt is audited but never becomes the delta's ApplyResult.
    expect(reducer.appliedDeltas()).toHaveLength(1);
    expect(reducer.auditTrail().at(-1)?.reason).toContain("rejected_invariant");
  });

  it("rejects stale base state via the version/fingerprint token (§11)", async () => {
    const store = memoryStore();
    const reducer = await DurableOperationalStateReducer.restore(store);
    const base = stateFingerprint(reducer.snapshot());
    await reducer.applyResult(commit("t0", "c0"));
    const stale = await reducer.applyDelta({ ...delta, expectedBaseStateFingerprint: base, mutate: commit("t1", "c1") });
    expect(stale.outcome).toBe("rejected_stale");
    expect(reducer.getBinding("t1")).toBeUndefined();
    expect(reducer.appliedDeltas()).toHaveLength(0);
  });

  it("records rejected_precondition without producing an ApplyResult", async () => {
    const store = memoryStore();
    const reducer = await DurableOperationalStateReducer.restore(store);
    await reducer.applyResult(commit("t1", "c1"));
    const rejected = await reducer.applyDelta({ ...delta, mutate: commit("t2", "c1") });
    expect(rejected).toMatchObject({ outcome: "rejected_precondition", error: { code: "BINDING_REVERSE_CONFLICT" } });
    expect(reducer.appliedDeltas()).toHaveLength(0);
    expect(reducer.auditTrail().at(-1)?.reason).toContain("rejected_precondition");
  });

  it("records a durable no_op receipt without changing the state (§15.4)", async () => {
    const store = memoryStore();
    const reducer = await DurableOperationalStateReducer.restore(store);
    await reducer.applyResult(commit("t1", "c1"));
    const before = stateFingerprint(reducer.snapshot());
    const noOp = await reducer.applyDelta({
      ...delta,
      mutate: (r) => ({ ok: true as const, value: "inspected" as const, state: r.snapshot() })
    });
    expect(noOp.outcome).toBe("no_op");
    expect(stateFingerprint(reducer.snapshot())).toBe(before);
    expect(reducer.appliedDeltas()).toHaveLength(1);
    expect(reducer.appliedDeltas()[0].outcome).toBe("no_op");
    const replay = await reducer.applyDelta({ ...delta, mutate: () => { throw new Error("must not re-execute"); } });
    expect(replay.outcome).toBe("no_op");
    expect(reducer.auditTrail().at(-1)?.reason).not.toContain("must not");
  });

  it("does not persist anything when the store save fails mid-delta", async () => {
    let failNext = true;
    const saved: DurableStateBundle[] = [];
    const store: OperationalStateReducerStore = {
      load: async () => undefined,
      save: async bundle => { if (failNext) { failNext = false; throw new Error("disk_full"); } saved.push(bundle); }
    };
    const reducer = await DurableOperationalStateReducer.restore(store);
    await expect(reducer.applyDelta({ ...delta, mutate: commit("t1", "c1") })).rejects.toThrow("disk_full");
    expect(reducer.appliedDeltas()).toHaveLength(0);
    expect(reducer.auditTrail()).toHaveLength(0);
    expect(reducer.snapshot().bindings).toEqual({});
    // Retry succeeds cleanly with the same delta identity.
    const retry = await reducer.applyDelta({ ...delta, mutate: commit("t1", "c1") });
    expect(retry.outcome).toBe("applied");
    expect(reducer.appliedDeltas()).toHaveLength(1);
  });

  it("keeps deltas serializable under concurrency", async () => {
    const store = memoryStore();
    const reducer = await DurableOperationalStateReducer.restore(store);
    const outcomes = await Promise.all([
      reducer.applyDelta({ ...delta, deltaId: "SD-1", mutate: commit("t1", "c1") }),
      reducer.applyDelta({ ...delta, deltaId: "SD-2", mutate: commit("t2", "c2") })
    ]);
    expect(outcomes.map(outcome => outcome.outcome).sort()).toEqual(["applied", "applied"]);
    expect(reducer.appliedDeltas()).toHaveLength(2);
  });
});
