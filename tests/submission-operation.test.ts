import { describe, expect, it, vi } from "vitest";
import { SubmissionOperationLedger, SUBMISSION_OPERATIONS_KEY, SUBMISSION_OPERATIONS_REVISION_KEY, createChromeSubmissionStore, fingerprintSubmissionPayload, type SubmissionAuthority, type SubmissionClaimContext } from "../src/core/submission-operation";

function baseline() { return { routeRef: "route:a", assistantMessageCount: 1, userMessageCount: 1, lastUserMessageFingerprint: "ce8", lastAssistantMessageFingerprint: "a1", headFingerprint: "h1", observedAt: 1 }; }
function context(carrier = "browser-tab:1", conversation = "conversation:a", logicalThreadId = "t1", sourceEpoch = 0, sourceObservedAt = 1): SubmissionClaimContext { return { logicalThreadId, providerConversationRef: conversation, bindingEpoch: 1, leaseGeneration: 1, leaseOwnerRef: "owner-1", targetCarrierRef: carrier, carrierState: "READY", logicalControl: "CONTINUE", explicitGo: true, sourceEpoch, sourceObservedAt }; }
function authority(value = context()) { return { ...value, authorityGeneration: 1, authorityEstablishedAt: value.sourceObservedAt }; }
function input(operationId: string, carrier = "browser-tab:1", providerConversationRef = "conversation:a") { const fence = context(carrier, providerConversationRef); return { operationId, operationKind: "GO" as const, workItemId: "w1", logicalThreadId: "t1", targetCarrierRef: carrier, providerConversationRef, dispatchFence: fence, payloadFingerprint: "ce8", payload: "go", preSubmitBaseline: baseline() }; }
function memoryStore(authorityValue = authority()) { let value: unknown; return { get: async (_key?: string) => value, set: async (next: Record<string, unknown>) => { value = next; }, getAuthority: async () => authorityValue, ensureAuthority: async () => undefined }; }
async function recordDispatchReceipt(ledger: SubmissionOperationLedger, operationId: string, fence = context(), claimedAt = 10): Promise<void> {
  await ledger.record(operationId, "DISPATCHING", {
    now: claimedAt + 1,
    dispatchReceipt: { claimedAt, attemptedAt: claimedAt + 1, outcome: "dispatched", fence }
  });
}
let sharedLock: Promise<void> = Promise.resolve();
async function withSharedLock<T>(work: () => Promise<T>): Promise<T> { const previous = sharedLock; let release!: () => void; sharedLock = new Promise(resolve => { release = resolve; }); await previous; try { return await work(); } finally { release(); } }

describe("SubmissionOperationLedger", () => {
  it("persists PREPARED before claim and is idempotent by operation id", async () => {
    const store = memoryStore(); const ledger = new SubmissionOperationLedger(store);
    const prepared = await ledger.prepare(input("op-1"),); expect(prepared.state).toBe("PREPARED");
    expect((await store.get(SUBMISSION_OPERATIONS_KEY) as any).noosSubmissionOperations[0].state).toBe("PREPARED");
    expect((await ledger.prepare(input("op-1"))).createdAt).toBe(prepared.createdAt);
    await expect(ledger.prepare({ ...input("op-1"), payloadFingerprint: "different" })).rejects.toThrow("operation_id_reuse_conflict");
  });
  it("allows only one active dispatch per carrier under concurrent claims in one ledger", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore()); await ledger.prepare(input("a")); await ledger.prepare(input("b"));
    const [first, second] = await Promise.all([ledger.claim("a", context(), 10), ledger.claim("b", context(), 11)]);
    expect([first, second].filter(Boolean)).toHaveLength(1); expect((await ledger.list()).filter(x => x.state === "DISPATCHING")).toHaveLength(1);
  });
  it("rejects a claim when provider, binding, lease or carrier fence is stale", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("fenced"));
    expect(await ledger.claim("fenced", { ...context(), bindingEpoch: 2 }, 10)).toBeUndefined();
    expect((await ledger.list())[0].state).toBe("PREPARED");
  });
  it("attaches a late dispatch receipt without moving an observed operation backwards", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("late-receipt"));
    await ledger.claim("late-receipt", context(), 10);
    await ledger.reconcile("late-receipt", {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 2,
      generationActive: true,
      observedAt: 20,
      sourceEpoch: 0,
      dispatchFence: context()
    });
    const recorded = await ledger.record("late-receipt", "DISPATCHING", {
      now: 19,
      dispatchReceipt: { claimedAt: 10, attemptedAt: 11, outcome: "dispatched", fence: context() }
    });
    expect(recorded?.state).toBe("OBSERVED_ACCEPTED");
    expect(recorded?.dispatchReceipt?.fence).toEqual(context());
    expect(recorded?.lastObservedAt).toBe(20);
  });
  it("rejects dispatch receipts with a mismatched fence or time", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("receipt-fence"));
    await ledger.claim("receipt-fence", context(), 10);
    expect(await ledger.record("receipt-fence", "DISPATCHING", {
      now: 11,
      dispatchReceipt: { claimedAt: 10, attemptedAt: 11, outcome: "dispatched", fence: { ...context(), leaseGeneration: 2 } }
    })).toEqual(expect.objectContaining({ state: "DISPATCHING" }));
    expect((await ledger.get("receipt-fence"))?.dispatchReceipt).toBeUndefined();
    expect(await ledger.record("receipt-fence", "DISPATCHING", {
      now: 9,
      dispatchReceipt: { claimedAt: 10, attemptedAt: 11, outcome: "dispatched", fence: context() }
    })).toEqual(expect.objectContaining({ state: "DISPATCHING" }));
    expect((await ledger.get("receipt-fence"))?.dispatchReceipt).toBeUndefined();
    expect(await ledger.record("receipt-fence", "DISPATCHING", {
      now: 10,
      dispatchReceipt: { claimedAt: 10, attemptedAt: 11, outcome: "dispatched", fence: context() }
    })).toEqual(expect.objectContaining({ state: "DISPATCHING" }));
    expect((await ledger.get("receipt-fence"))?.dispatchReceipt).toBeUndefined();
  });
  it("does not attach a late receipt to a terminal operation", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("terminal-receipt"));
    await ledger.claim("terminal-receipt", context(), 10);
    await ledger.record("terminal-receipt", "CANCELLED", { now: 11 });
    const recorded = await ledger.record("terminal-receipt", "DISPATCHING", {
      now: 12,
      dispatchReceipt: { claimedAt: 10, attemptedAt: 11, outcome: "dispatched", fence: context() }
    });
    expect(recorded?.state).toBe("CANCELLED");
    expect((await ledger.get("terminal-receipt"))?.dispatchReceipt).toBeUndefined();
  });
  it("rotates a recovered operation to the new content execution lease", async () => {
    const backing: Record<string, unknown> = {};
    const storage = {
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (value: Record<string, unknown>) => Object.assign(backing, value)
    };
    const ledger = new SubmissionOperationLedger(createChromeSubmissionStore(storage, {
      claimViaCoordinator: false,
      lock: withSharedLock
    }));
    const oldContext = context("browser-tab:1", "conversation:a", "t1", 0, 10);
    const newContext = { ...oldContext, leaseOwnerRef: "owner-2", sourceObservedAt: 20 };
    await ledger.initializeAuthority(oldContext);
    await ledger.prepare({ ...input("recover-operation"), dispatchFence: oldContext });
    await ledger.claim("recover-operation", oldContext, 11);
    await recordDispatchReceipt(ledger, "recover-operation", oldContext, 11);
    const beforeStaleRecovery = await ledger.get("recover-operation");
    const beforeStaleAuthority = { ...(backing.noosSubmissionAuthority as Record<string, unknown>) };
    const oldRecovery = await ledger.recover("recover-operation", { ...oldContext, sourceObservedAt: 9 }, 9);
    const afterStaleRecovery = await ledger.get("recover-operation");
    expect(oldRecovery).toBeUndefined();
    expect(afterStaleRecovery).toEqual(beforeStaleRecovery);
    expect(afterStaleRecovery?.dispatchFence).toEqual(beforeStaleRecovery?.dispatchFence);
    expect(afterStaleRecovery?.dispatchReceipt).toEqual(beforeStaleRecovery?.dispatchReceipt);
    expect(afterStaleRecovery?.lastObservedAt).toBe(beforeStaleRecovery?.lastObservedAt);
    expect(backing.noosSubmissionAuthority).toEqual(beforeStaleAuthority);
    await ledger.initializeAuthority(newContext);
    const wrongThread = await ledger.recover("recover-operation", { ...newContext, logicalThreadId: "other-thread" }, 20);
    expect(wrongThread).toBeUndefined();
    const recovered = await ledger.recover("recover-operation", newContext, 20);
    expect(recovered?.dispatchFence?.leaseOwnerRef).toBe("owner-2");
    expect(recovered?.dispatchReceipt?.fence.leaseOwnerRef).toBe("owner-2");
    expect(recovered?.lastObservedAt).toBe(20);
    const staleReceipt = await ledger.record("recover-operation", "DISPATCHING", {
      now: 21,
      dispatchReceipt: { claimedAt: 11, attemptedAt: 21, outcome: "dispatched", fence: oldContext }
    });
    expect(staleReceipt?.dispatchReceipt).toEqual(recovered?.dispatchReceipt);
    expect(staleReceipt?.dispatchReceipt?.attemptedAt).toBe(12);
    expect(staleReceipt?.dispatchReceipt?.outcome).toBe("dispatched");
    expect(staleReceipt?.dispatchReceipt?.fence.leaseOwnerRef).toBe("owner-2");
    expect((await ledger.get("recover-operation"))?.dispatchReceipt).toEqual(recovered?.dispatchReceipt);
  });
  it("serializes concurrent recovery and keeps the newest authority and fence", async () => {
    const backing: Record<string, unknown> = {};
    const storage = {
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (value: Record<string, unknown>) => Object.assign(backing, value)
    };
    const first = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { claimViaCoordinator: false, lock: withSharedLock }));
    const second = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { claimViaCoordinator: false, lock: withSharedLock }));
    const oldContext = context("browser-tab:1", "conversation:a", "t1", 0, 10);
    const contextA = { ...oldContext, leaseOwnerRef: "owner-a", sourceObservedAt: 20 };
    const contextB = { ...oldContext, leaseOwnerRef: "owner-b", sourceObservedAt: 21 };
    await first.initializeAuthority(oldContext);
    await first.prepare({ ...input("concurrent-recovery"), dispatchFence: oldContext });
    await first.claim("concurrent-recovery", oldContext, 11);
    await Promise.all([
      first.recover("concurrent-recovery", contextA, 20),
      second.recover("concurrent-recovery", contextB, 21)
    ]);
    const finalOperation = await first.get("concurrent-recovery");
    const finalAuthority = (backing.noosSubmissionAuthority ?? {}) as SubmissionAuthority;
    expect(finalAuthority.leaseOwnerRef).toBe("owner-b");
    expect(finalAuthority.sourceObservedAt).toBe(21);
    expect(finalOperation?.dispatchFence?.leaseOwnerRef).toBe("owner-b");
    expect(finalOperation?.logicalThreadId).toBe("t1");
  });
  it("keeps dispatch receipt evidence monotonic", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("receipt-monotonic"));
    await ledger.claim("receipt-monotonic", context(), 10);
    await ledger.record("receipt-monotonic", "DISPATCHING", {
      now: 20,
      dispatchReceipt: { claimedAt: 10, attemptedAt: 20, outcome: "dispatched", fence: context() }
    });
    const downgraded = await ledger.record("receipt-monotonic", "UNCERTAIN", {
      now: 21,
      dispatchReceipt: { claimedAt: 10, attemptedAt: 19, outcome: "uncertain", fence: context() }
    });
    expect(downgraded?.state).toBe("DISPATCHING");
    expect(downgraded?.dispatchReceipt?.outcome).toBe("dispatched");
    expect(downgraded?.dispatchReceipt?.attemptedAt).toBe(20);
  });
  it("allows only one lease holder to claim a provider conversation across duplicate carriers", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("first", "browser-tab:1", "conversation:a"));
    await ledger.prepare({ ...input("second", "browser-tab:2", "conversation:a"), dispatchFence: context("browser-tab:2", "conversation:a") });
    const first = await ledger.claim("first", context("browser-tab:1", "conversation:a"), 10);
    const second = await ledger.claim("second", context("browser-tab:2", "conversation:a"), 11);
    expect(first?.operationId).toBe("first");
    expect(second).toBeUndefined();
  });
  it("coordinates claims from separate contexts through the background service worker", async () => {
    const backing: Record<string, unknown> = { [SUBMISSION_OPERATIONS_KEY]: [], noosSubmissionAuthority: authority() };
    const storage = {
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (value: Record<string, unknown>) => Object.assign(backing, value)
    };
    const coordinator = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { claimViaCoordinator: false, lock: withSharedLock }));
    const runtime = {
      sendMessage: async (message: unknown) => {
        const mutation = (message as { mutation: any }).mutation;
        switch (mutation.type) {
          case "prepare": return { ok: true, result: await coordinator.prepare(mutation.input) };
          case "claim": return { ok: true, result: await coordinator.claim(mutation.operationId, mutation.context, mutation.now) };
          default: return { ok: false };
        }
      }
    };
    const first = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { runtime }));
    const second = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { runtime }));
    await first.prepare(input("a"));
    await first.prepare(input("b"));
    const [claimedA, claimedB] = await Promise.all([first.claim("a", context(), 10), second.claim("b", context(), 11)]);
    expect([claimedA, claimedB].filter(Boolean)).toHaveLength(1);
    expect((await coordinator.list()).filter(item => item.state === "DISPATCHING")).toHaveLength(1);
  });
  it("serializes prepare create-or-get across separate contexts", async () => {
    const backing: Record<string, unknown> = { [SUBMISSION_OPERATIONS_KEY]: [], noosSubmissionAuthority: authority() };
    const storage = {
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (value: Record<string, unknown>) => {
        await new Promise(resolve => setTimeout(resolve, 2));
        Object.assign(backing, value);
      }
    };
    const first = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { lock: withSharedLock }));
    const second = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { lock: withSharedLock }));
    const [a, b] = await Promise.all([
      first.prepare({ ...input("same", "browser-tab:1", "conversation:a"), now: 10 }),
      second.prepare({ ...input("same", "browser-tab:1", "conversation:a"), now: 11 })
    ]);
    expect(a.operationId).toBe("same");
    expect(b.operationId).toBe("same");
    expect((await first.list())).toHaveLength(1);
    await expect(second.prepare({ ...input("same", "browser-tab:1", "conversation:a"), payloadFingerprint: "different" })).rejects.toThrow("operation_id_reuse_conflict");
  });
  it("recovers a persisted prepare after the create response is lost", async () => {
    const backing: Record<string, unknown> = { [SUBMISSION_OPERATIONS_KEY]: [], noosSubmissionAuthority: authority() };
    const storage = {
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (value: Record<string, unknown>) => Object.assign(backing, value)
    };
    const coordinator = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { claimViaCoordinator: false, lock: withSharedLock }));
    let first = true;
    const client = new SubmissionOperationLedger(createChromeSubmissionStore(storage, {
      runtime: { sendMessage: async (message: unknown) => {
        const mutation = (message as { mutation: any }).mutation;
        if (mutation.type !== "prepare") return { ok: false };
        const result = await coordinator.prepare(mutation.input);
        if (first) { first = false; throw new Error("response_lost"); }
        return { ok: true, result };
      } }
    }));
    await expect(client.prepare(input("create-retry"))).rejects.toThrow("submission_prepare_unavailable");
    const recovered = await client.prepare(input("create-retry"));
    expect(recovered.operationId).toBe("create-retry");
    expect((await coordinator.list())).toHaveLength(1);
  });
  it("fails closed when the background coordinator cannot grant a claim", async () => {
    const backing: Record<string, unknown> = { [SUBMISSION_OPERATIONS_KEY]: [], noosSubmissionAuthority: authority() };
    const storage = {
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (value: Record<string, unknown>) => Object.assign(backing, value)
    };
    const ledger = new SubmissionOperationLedger(createChromeSubmissionStore(storage, {
      runtime: { sendMessage: async () => { throw new Error("service_worker_restarting"); } }
    }));
    await expect(ledger.prepare(input("op-1", "browser-tab:1", "conversation:a"))).rejects.toThrow("submission_prepare_unavailable");
    expect(await ledger.claim("op-1", context(), 10)).toBeUndefined();
    expect(await ledger.list()).toEqual([]);
  });
  it("requires a stable operation id and a real authority lock", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await expect(ledger.prepare({ ...input("" as string), operationId: "" })).rejects.toThrow("operation_id_required");
    const backing: Record<string, unknown> = {};
    const storage = { get: async (key: string) => ({ [key]: backing[key] }), set: async (value: Record<string, unknown>) => Object.assign(backing, value) };
    vi.stubGlobal("navigator", {});
    try {
      const chromeLedger = new SubmissionOperationLedger(createChromeSubmissionStore(storage));
      await expect(chromeLedger.prepare(input("locked"))).rejects.toThrow("submission_authority_unavailable");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("rejects incomplete prepare input and does not infer missing fields", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await expect(ledger.prepare({ ...input("invalid"), dispatchFence: undefined })).rejects.toThrow("submission_prepare_invalid");
    await expect(ledger.prepare({ ...input("invalid-fingerprint"), payloadFingerprint: "" })).rejects.toThrow("submission_prepare_invalid");
  });
  it("recovers a persisted dispatch after a worker response is lost", async () => {
    const backing: Record<string, unknown> = { [SUBMISSION_OPERATIONS_KEY]: [], noosSubmissionAuthority: authority() };
    const storage = {
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (value: Record<string, unknown>) => Object.assign(backing, value)
    };
    const coordinator = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { claimViaCoordinator: false, lock: withSharedLock }));
    const client = new SubmissionOperationLedger(createChromeSubmissionStore(storage, {
      runtime: { sendMessage: async (message: unknown) => {
        const mutation = (message as { mutation: any }).mutation;
        if (mutation.type === "prepare") return { ok: true, result: await coordinator.prepare(mutation.input) };
        if (mutation.type === "claim") { await coordinator.claim(mutation.operationId, mutation.context, mutation.now); throw new Error("response_lost"); }
        return { ok: false };
      } }
    }));
    await client.prepare(input("op-1", "browser-tab:1", "conversation:a"));
    expect(await client.claim("op-1", context(), 10)).toBeUndefined();
    const restartedCoordinator = new SubmissionOperationLedger(createChromeSubmissionStore(storage, { claimViaCoordinator: false, lock: withSharedLock }));
    expect((await restartedCoordinator.get("op-1"))?.state).toBe("DISPATCHING");
    const reconciled = await restartedCoordinator.reconcile("op-1", { ...baseline(), conversationRef: "conversation:a", userMessageCount: 2, observedAt: 20, sourceEpoch: 0, generationActive: true, dispatchFence: context() });
    expect(reconciled.outcome).toBe("PROVEN_ACCEPTED");
  });
  it("reconciles accepted, proven-not-accepted and ambiguous evidence conservatively", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore()); await ledger.prepare(input("op-1", "browser-tab:1", "conversation:a")); await ledger.claim("op-1", context(), 1);
    let result = await ledger.reconcile("op-1", { ...baseline(), conversationRef: "conversation:a", userMessageCount: 2, observedAt: 20, sourceEpoch: 0, generationActive: true, dispatchFence: context() }); expect(result.outcome).toBe("PROVEN_ACCEPTED");
    expect(await ledger.record("op-1", "COMPLETED")).toBeUndefined();
    await ledger.reconcile("op-1", { ...baseline(), conversationRef: "conversation:a", generationActive: false, stableSince: 20, observedAt: 2030, sourceEpoch: 0, dispatchFence: context() });
    expect((await ledger.record("op-1", "COMPLETED", { now: 2031 }))?.state).toBe("COMPLETED");
    await ledger.prepare(input("op-2", "browser-tab:1", "conversation:a")); await ledger.claim("op-2", context("browser-tab:1", "conversation:a"), 21); await recordDispatchReceipt(ledger, "op-2", context("browser-tab:1", "conversation:a"), 21); result = await ledger.reconcile("op-2", { ...baseline(), conversationRef: "conversation:a", generationActive: false, stableSince: 22, observedAt: 2023, sourceEpoch: 0, dispatchFence: context("browser-tab:1", "conversation:a") }); expect(result.outcome).toBe("PROVEN_NOT_ACCEPTED");
    await ledger.prepare(input("op-3", "browser-tab:1", "conversation:a")); await ledger.claim("op-3", context("browser-tab:1", "conversation:a"), 23); result = await ledger.reconcile("op-3", { ...baseline(), conversationRef: "conversation:a", generationActive: true, observedAt: 24, sourceEpoch: 0, dispatchFence: context("browser-tab:1", "conversation:a") }); expect(result.outcome).toBe("STILL_AMBIGUOUS");
  });
  it("requires fresh, fenced observations before reconciliation", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("fresh"));
    await ledger.claim("fresh", context(), 10);
    const stale = await ledger.reconcile("fresh", { ...baseline(), conversationRef: "conversation:a", observedAt: 10, sourceEpoch: 0, dispatchFence: context() });
    expect(stale.outcome).toBe("STILL_AMBIGUOUS");
    const wrongFence = await ledger.reconcile("fresh", { ...baseline(), conversationRef: "conversation:a", userMessageCount: 2, observedAt: 11, sourceEpoch: 0, dispatchFence: { ...context(), leaseGeneration: 2 } });
    expect(wrongFence.outcome).toBe("STILL_AMBIGUOUS");
    const accepted = await ledger.reconcile("fresh", { ...baseline(), conversationRef: "conversation:a", userMessageCount: 2, observedAt: 12, sourceEpoch: 0, generationActive: true, dispatchFence: context() });
    expect(accepted.outcome).toBe("PROVEN_ACCEPTED");
  });
  it("compares fingerprints only when both baseline and observation provide them", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare({ ...input("fingerprints"), preSubmitBaseline: { ...baseline(), headFingerprint: undefined } });
    await ledger.claim("fingerprints", context(), 10);
    const result = await ledger.reconcile("fingerprints", {
      ...baseline(),
      conversationRef: "conversation:a",
      headFingerprint: "new-but-unpaired",
      generationActive: false,
      observedAt: 11,
      sourceEpoch: 0,
      dispatchFence: context()
    });
    expect(result.outcome).toBe("STILL_AMBIGUOUS");
    expect(result.operation?.state).toBe("UNCERTAIN");
  });
  it("keeps acceptance uncertain when generation activity is not observed", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("missing-generation"));
    await ledger.claim("missing-generation", context(), 10);
    const result = await ledger.reconcile("missing-generation", {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 2,
      observedAt: 20,
      sourceEpoch: 0,
      dispatchFence: context()
    });
    expect(result.outcome).toBe("STILL_AMBIGUOUS");
    expect(result.operation?.state).toBe("UNCERTAIN");
  });
  it("only re-arms after reconciliation proves not accepted", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("uncertain"));
    await ledger.claim("uncertain", context(), 10);
    await recordDispatchReceipt(ledger, "uncertain", context(), 10);
    await ledger.record("uncertain", "UNCERTAIN", { now: 12 });
    expect((await ledger.rearm("uncertain", { ...baseline(), conversationRef: "conversation:a", observedAt: 20 }, context()))?.state).toBe("UNCERTAIN");
    await ledger.reconcile("uncertain", { ...baseline(), conversationRef: "conversation:a", generationActive: false, observedAt: 2021, stableSince: 12, sourceEpoch: 0, dispatchFence: context() });
    expect((await ledger.rearm("uncertain", { ...baseline(), conversationRef: "conversation:a", observedAt: 2022 }, context()))?.state).toBe("PREPARED");
  });
  it("re-arms only after a fresh baseline", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore()); await ledger.prepare(input("op-1", "browser-tab:1", "conversation:a")); await ledger.claim("op-1", context(), 1); await recordDispatchReceipt(ledger, "op-1", context(), 1); await ledger.reconcile("op-1", { ...baseline(), conversationRef: "conversation:a", generationActive: false, stableSince: 2, observedAt: 2005, sourceEpoch: 0, dispatchFence: context() });
    const next = await ledger.rearm("op-1", { ...baseline(), conversationRef: "conversation:a", observedAt: 2006 }, context(), 2007); expect(next?.state).toBe("PREPARED"); expect(next?.preSubmitBaseline.observedAt).toBe(2006);
  });
  it("requires the rearm baseline and fence to match the recorded safe evidence", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("rearm-evidence"));
    await ledger.claim("rearm-evidence", context(), 10);
    await recordDispatchReceipt(ledger, "rearm-evidence", context(), 10);
    await ledger.reconcile("rearm-evidence", {
      ...baseline(),
      conversationRef: "conversation:a",
      generationActive: false,
      stableSince: 12,
      observedAt: 2020,
      sourceEpoch: 0,
      dispatchFence: context()
    });
    expect((await ledger.rearm("rearm-evidence", {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 2,
      observedAt: 2021
    }, context(), 2022))?.state).toBe("FAILED_SAFE");
    expect((await ledger.rearm("rearm-evidence", {
      ...baseline(),
      conversationRef: "conversation:a",
      observedAt: 2021
    }, { ...context(), leaseGeneration: 2 }, 2022))?.state).toBe("FAILED_SAFE");
    expect((await ledger.rearm("rearm-evidence", {
      ...baseline(),
      conversationRef: "conversation:a",
      observedAt: 2021
    }, context(), 2022))?.state).toBe("PREPARED");
  });
  it("completes an accepted GO before a second GO can claim the carrier", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("go-first"));
    await ledger.claim("go-first", context(), 10);
    await ledger.reconcile("go-first", {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 2,
      generationActive: true,
      observedAt: 20,
      sourceEpoch: 0,
      dispatchFence: context()
    });
    await ledger.reconcile("go-first", {
      ...baseline(),
      conversationRef: "conversation:a",
      generationActive: false,
      stableSince: 20,
      observedAt: 2030,
      sourceEpoch: 0,
      dispatchFence: context()
    });
    expect((await ledger.record("go-first", "COMPLETED", { now: 2031 }))?.state).toBe("COMPLETED");
    await ledger.prepare(input("go-second"));
    expect((await ledger.claim("go-second", context(), 22))?.operationId).toBe("go-second");
  });
  it("does not accept observations without a verified provider conversation identity", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("op-1", "browser-tab:1", "conversation:a"));
    await ledger.claim("op-1", context(), 1);
    const result = await ledger.reconcile("op-1", { ...baseline(), userMessageCount: 2, observedAt: 20, sourceEpoch: 0, dispatchFence: context() });
    expect(result.outcome).toBe("STILL_AMBIGUOUS");
    expect(result.operation?.state).toBe("UNCERTAIN");
  });
  it("does not revive a terminal operation during reconciliation", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("op-1", "browser-tab:1", "conversation:a"));
    await ledger.claim("op-1", context(), 1);
    await ledger.reconcile("op-1", { ...baseline(), conversationRef: "conversation:a", userMessageCount: 2, observedAt: 20, sourceEpoch: 0, generationActive: true, dispatchFence: context() });
    await ledger.reconcile("op-1", { ...baseline(), conversationRef: "conversation:a", stableSince: 20, observedAt: 2030, sourceEpoch: 0, generationActive: false, dispatchFence: context() });
    expect((await ledger.record("op-1", "COMPLETED", { now: 2031 }))?.state).toBe("COMPLETED");
    const result = await ledger.reconcile("op-1", { ...baseline(), conversationRef: "conversation:a", userMessageCount: 3, observedAt: 22, sourceEpoch: 0, dispatchFence: context() });
    expect(result.outcome).toBe("STILL_AMBIGUOUS");
    expect(result.operation?.state).toBe("COMPLETED");
  });
  it("does not allow record to manufacture FAILED_SAFE without reconciliation evidence", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("op-failure"));
    await ledger.claim("op-failure", context(), 1);
    expect(await ledger.record("op-failure", "FAILED_SAFE", { now: 2 })).toBeUndefined();
    expect((await ledger.get("op-failure"))?.state).toBe("DISPATCHING");
  });
  it("does not allow record to manufacture OBSERVED_ACCEPTED", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("accepted"));
    await ledger.claim("accepted", context(), 1);
    expect(await ledger.record("accepted", "OBSERVED_ACCEPTED")).toBeUndefined();
    expect((await ledger.get("accepted"))?.state).toBe("DISPATCHING");
  });
  it("keeps an accepted operation open while the provider is still generating", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("delayed-provider"));
    await ledger.claim("delayed-provider", context(), 10);
    await recordDispatchReceipt(ledger, "delayed-provider", context(), 10);
    const generating = await ledger.reconcile("delayed-provider", {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 2,
      observedAt: 20,
      sourceEpoch: 0,
      generationActive: true,
      dispatchFence: context()
    });
    expect(generating.outcome).toBe("PROVEN_ACCEPTED");
    expect(generating.operation?.state).toBe("OBSERVED_ACCEPTED");
    expect(await ledger.record("delayed-provider", "COMPLETED", { now: 21 })).toBeUndefined();

    const stillGenerating = await ledger.reconcile("delayed-provider", {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 2,
      observedAt: 100,
      sourceEpoch: 0,
      generationActive: true,
      dispatchFence: context()
    });
    expect(stillGenerating.operation?.state).toBe("OBSERVED_ACCEPTED");
    expect(await ledger.record("delayed-provider", "COMPLETED", { now: 101 })).toBeUndefined();

    await ledger.reconcile("delayed-provider", {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 2,
      observedAt: 2_200,
      stableSince: 100,
      sourceEpoch: 0,
      generationActive: false,
      dispatchFence: context()
    });
    expect((await ledger.record("delayed-provider", "COMPLETED", { now: 2_201 }))?.state).toBe("COMPLETED");
  });
  it("blocks a second GO while the first provider generation is unresolved", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("go-first"));
    await ledger.claim("go-first", context(), 10);
    await ledger.reconcile("go-first", {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 2,
      observedAt: 20,
      sourceEpoch: 0,
      generationActive: true,
      dispatchFence: context()
    });
    await ledger.prepare(input("go-second"));
    expect(await ledger.claim("go-second", context(), 21)).toBeUndefined();
  });
  it("rejects an out-of-order observation after newer reconciliation evidence", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("ordered"));
    await ledger.claim("ordered", context(), 10);
    await ledger.reconcile("ordered", {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 2,
      observedAt: 20,
      sourceEpoch: 0,
      generationActive: true,
      dispatchFence: context()
    });
    const stale = await ledger.reconcile("ordered", {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 3,
      observedAt: 19,
      sourceEpoch: 0,
      generationActive: true,
      dispatchFence: context()
    });
    expect(stale.outcome).toBe("STILL_AMBIGUOUS");
    expect(stale.operation?.lastObservedAt).toBe(20);
    expect(stale.operation?.state).toBe("OBSERVED_ACCEPTED");
  });
  it("rejects a GO payload fingerprint mismatch before persistence", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await expect(ledger.prepare({
      ...input("payload-mismatch"),
      payload: "different"
    })).rejects.toThrow("submission_prepare_invalid");
  });
  it("does not accept a concurrent human message as the GO payload", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("concurrent-human"));
    await ledger.claim("concurrent-human", context(), 10);
    const result = await ledger.reconcile("concurrent-human", {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 2,
      lastUserMessageFingerprint: "human-message",
      observedAt: 20,
      sourceEpoch: 0,
      generationActive: true,
      dispatchFence: context()
    });
    expect(result.outcome).toBe("STILL_AMBIGUOUS");
    expect(result.operation?.state).toBe("UNCERTAIN");
  });
  it("does not replace accepted evidence with a mismatched recovered conversation", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    await ledger.prepare(input("recovered-mismatch"));
    await ledger.claim("recovered-mismatch", context(), 10);
    const accepted = await ledger.reconcile("recovered-mismatch", {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 2,
      observedAt: 20,
      sourceEpoch: 0,
      generationActive: true,
      dispatchFence: context()
    });
    expect(accepted.outcome).toBe("PROVEN_ACCEPTED");
    const mismatched = await ledger.reconcile("recovered-mismatch", {
      ...baseline(),
      conversationRef: "conversation:other",
      userMessageCount: 2,
      observedAt: 30,
      sourceEpoch: 0,
      generationActive: false,
      stableSince: 30,
      dispatchFence: context()
    });
    expect(mismatched.outcome).toBe("STILL_AMBIGUOUS");
    expect(mismatched.operation?.lastReconciliationEvidence?.conversationRef).toBe("conversation:a");
    expect(mismatched.operation?.state).toBe("OBSERVED_ACCEPTED");
  });
  it("adapts chrome storage promise API", async () => {
    const backing: Record<string, unknown> = {}; const ledger = new SubmissionOperationLedger(createChromeSubmissionStore({ get: async key => ({ [key]: backing[key] }), set: async value => Object.assign(backing, value) }, { lock: withSharedLock }));
    await ledger.prepare(input("op-1")); expect((await ledger.list())[0].operationId).toBe("op-1"); expect(backing[SUBMISSION_OPERATIONS_REVISION_KEY]).toBe(1);
  });

  it("rotates authority after a content reload and permits a second GO", async () => {
    const backing: Record<string, unknown> = {};
    const storage = {
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (value: Record<string, unknown>) => Object.assign(backing, value)
    };
    const oldContext = context("browser-tab:1", "conversation:a", "t1", 0, 10);
    const newContext = {
      ...oldContext,
      leaseOwnerRef: "owner-2",
      sourceObservedAt: 20
    };
    const first = new SubmissionOperationLedger(createChromeSubmissionStore(storage, {
      claimViaCoordinator: false,
      lock: withSharedLock
    }));
    await first.initializeAuthority(oldContext);
    await first.prepare({ ...input("go-old"), dispatchFence: oldContext });
    expect((await first.claim("go-old", oldContext, 11))?.state).toBe("DISPATCHING");
    await first.record("go-old", "CANCELLED", { now: 12 });

    const reloaded = new SubmissionOperationLedger(createChromeSubmissionStore(storage, {
      claimViaCoordinator: false,
      lock: withSharedLock
    }));
    await reloaded.initializeAuthority(newContext);
    const authority = (backing.noosSubmissionAuthority ?? {}) as Partial<SubmissionClaimContext> & { authorityGeneration?: number };
    expect(authority?.leaseOwnerRef).toBe("owner-2");
    expect(authority?.authorityGeneration).toBe(2);

    const oldPrepared = await first.prepare({ ...input("old-after-reload"), dispatchFence: oldContext });
    expect(await first.claim(oldPrepared.operationId, oldContext, 21)).toBeUndefined();
    const newPrepared = await reloaded.prepare({
      ...input("go-new"),
      dispatchFence: newContext,
      providerConversationRef: newContext.providerConversationRef
    });
    expect((await reloaded.claim(newPrepared.operationId, newContext, 22))?.operationId).toBe("go-new");
  });

  it("rotates authority on SPA conversation change and fences the previous conversation", async () => {
    const backing: Record<string, unknown> = {};
    const storage = {
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (value: Record<string, unknown>) => Object.assign(backing, value)
    };
    const oldContext = context("browser-tab:1", "conversation:a", "t1", 0, 10);
    const nextContext = context("browser-tab:1", "conversation:b", "t1", 1, 20);
    const ledger = new SubmissionOperationLedger(createChromeSubmissionStore(storage, {
      claimViaCoordinator: false,
      lock: withSharedLock
    }));
    await ledger.initializeAuthority(oldContext);
    await ledger.prepare({ ...input("spa-old"), dispatchFence: oldContext });
    expect((await ledger.claim("spa-old", oldContext, 11))?.operationId).toBe("spa-old");
    await ledger.initializeAuthority(nextContext);
    expect((await ledger.claim("spa-old", oldContext, 21))).toBeUndefined();
    const next = await ledger.prepare({
      ...input("spa-new", "browser-tab:1", "conversation:b"),
      logicalThreadId: "t1",
      providerConversationRef: "conversation:b",
      dispatchFence: nextContext,
      preSubmitBaseline: { ...baseline(), conversationRef: "conversation:b", routeRef: "route:b" }
    });
    expect((await ledger.claim(next.operationId, nextContext, 22))?.operationId).toBe("spa-new");
  });

  it("does not reconcile a recovered old operation with a new authority or source epoch", async () => {
    const backing: Record<string, unknown> = {};
    const storage = {
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (value: Record<string, unknown>) => Object.assign(backing, value)
    };
    const oldContext = context("browser-tab:1", "conversation:a", "t1", 0, 10);
    const reloadedContext = {
      ...oldContext,
      leaseOwnerRef: "owner-2",
      sourceObservedAt: 20
    };
    const ledger = new SubmissionOperationLedger(createChromeSubmissionStore(storage, {
      claimViaCoordinator: false,
      lock: withSharedLock
    }));
    await ledger.initializeAuthority(oldContext);
    await ledger.prepare({ ...input("recover-old"), dispatchFence: oldContext });
    await ledger.claim("recover-old", oldContext, 11);
    await ledger.initializeAuthority(reloadedContext);
    const result = await ledger.reconcile("recover-old", {
      ...baseline(),
      conversationRef: "conversation:a",
      sourceEpoch: 0,
      userMessageCount: 2,
      observedAt: 30,
      generationActive: true,
      dispatchFence: oldContext
    });
    expect(result.outcome).toBe("STILL_AMBIGUOUS");
    expect((await ledger.get("recover-old"))?.state).toBe("DISPATCHING");
  });

  it("retarget re-fences a PREPARED operation to a rolled-over destination", async () => {
    const rolledOver = context("browser-tab:9", "conversation:b", "t1", 4, 200);
    const ledger = new SubmissionOperationLedger(memoryStore(authority(rolledOver)));
    await ledger.prepare({ ...input("rt-1"), now: 10 });
    const retargeted = await ledger.retarget("rt-1", rolledOver, { ...baseline(), routeRef: "route:b", observedAt: 200 }, 50);
    expect(retargeted).toMatchObject({ state: "PREPARED", providerConversationRef: "conversation:b", targetCarrierRef: "browser-tab:9", operationKind: "GO", logicalThreadId: "t1" });
    expect(retargeted?.dispatchFence).toMatchObject({ providerConversationRef: "conversation:b", targetCarrierRef: "browser-tab:9" });
    expect(retargeted?.preSubmitBaseline.routeRef).toBe("route:b");
    // The stale fence can no longer claim; the rolled-over one can.
    expect(await ledger.claim("rt-1", context(), 60)).toBeUndefined();
    expect((await ledger.claim("rt-1", rolledOver, 60))?.state).toBe("DISPATCHING");
  });

  it("retarget refuses non-PREPARED states, stale authority, and backwards time", async () => {
    const rolledOver = context("browser-tab:9", "conversation:b", "t1", 4, 200);
    // DISPATCHING refuses (recover/rearm own that territory).
    const dispatching = new SubmissionOperationLedger(memoryStore());
    await dispatching.prepare({ ...input("rt-2"), now: 10 });
    await dispatching.claim("rt-2", context(), 10);
    expect(await dispatching.retarget("rt-2", context(), baseline(), 20)).toBeUndefined();
    // Authority must match the new context.
    const mismatched = new SubmissionOperationLedger(memoryStore());
    await mismatched.prepare({ ...input("rt-3"), now: 10 });
    expect(await mismatched.retarget("rt-3", rolledOver, baseline(), 50)).toBeUndefined();
    expect((await mismatched.list())[0].providerConversationRef).toBe("conversation:a");
    // Time must not move backwards from the operation's last observation.
    const backwards = new SubmissionOperationLedger(memoryStore(authority(rolledOver)));
    await backwards.prepare({ ...input("rt-4"), now: 100 });
    expect(await backwards.retarget("rt-4", rolledOver, baseline(), 50)).toBeUndefined();
    expect((await backwards.retarget("rt-4", rolledOver, baseline(), 150))?.providerConversationRef).toBe("conversation:b");
  });

  it("re-arm clears a stale acceptance stamp with the evidence", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    const fingerprint = fingerprintSubmissionPayload("delivered result");
    await ledger.prepare({ ...input("rearm-stamp"), operationKind: "DELIVER_CHILD_RESULT", payload: "delivered result", payloadFingerprint: fingerprint });
    await ledger.claim("rearm-stamp", context(), 10);
    await ledger.record("rearm-stamp", "DISPATCHING", {
      now: 11, dispatchReceipt: { claimedAt: 10, attemptedAt: 11, outcome: "dispatched", fence: context() }
    });
    await ledger.reconcile("rearm-stamp", {
      ...baseline(), conversationRef: "conversation:a", userMessageCount: 2,
      lastUserMessageFingerprint: fingerprint, observedAt: 20, sourceEpoch: 0,
      generationActive: false, dispatchFence: context()
    });
    expect((await ledger.get("rearm-stamp"))?.acceptedPayloadFingerprint).toBe(fingerprint);
    // The reviewer chain: a raced record parks it UNCERTAIN, then a quiet
    // proven-not-accepted observation fails it safe, then it re-arms.
    await ledger.record("rearm-stamp", "UNCERTAIN", { now: 25, error: "raced" });
    await ledger.reconcile("rearm-stamp", {
      ...baseline(), conversationRef: "conversation:a", userMessageCount: 1,
      observedAt: 30, sourceEpoch: 0, generationActive: false,
      providerFailure: true, dispatchFence: context()
    });
    const rearmed = await ledger.rearm("rearm-stamp", { ...baseline(), conversationRef: "conversation:a", observedAt: 40 }, context(), 50);
    expect(rearmed?.state).toBe("PREPARED");
    expect(rearmed?.acceptedPayloadFingerprint).toBeUndefined();
    expect(rearmed?.lastReconciliationEvidence).toBeUndefined();
  });

  it("stamps the acceptance payload fingerprint when reconciliation proves acceptance", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    // Non-GO transports (delivery) do not require the payload fingerprint for
    // acceptance, so the stamp is what makes the proof durable.
    const fingerprint = fingerprintSubmissionPayload("delivered result");
    await ledger.prepare({ ...input("stamp-1"), operationKind: "DELIVER_CHILD_RESULT", payload: "delivered result", payloadFingerprint: fingerprint });
    await ledger.claim("stamp-1", context(), 10);
    await ledger.record("stamp-1", "DISPATCHING", {
      now: 11,
      dispatchReceipt: { claimedAt: 10, attemptedAt: 11, outcome: "dispatched", fence: context() }
    });
    const accepted = await ledger.reconcile("stamp-1", {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 2,
      lastUserMessageFingerprint: fingerprint,
      observedAt: 20,
      sourceEpoch: 0,
      generationActive: false,
      dispatchFence: context()
    });
    expect(accepted.outcome).toBe("PROVEN_ACCEPTED");
    expect(accepted.operation?.acceptedPayloadFingerprint).toBe(fingerprint);
    // A later legitimate user message overwrites the evidence but not the stamp.
    const later = fingerprintSubmissionPayload("operator follow-up");
    const overwritten = await ledger.reconcile("stamp-1", {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 3,
      lastUserMessageFingerprint: later,
      observedAt: 30,
      sourceEpoch: 0,
      generationActive: false,
      dispatchFence: context()
    });
    expect(overwritten.outcome).toBe("PROVEN_ACCEPTED");
    expect(overwritten.operation?.lastReconciliationEvidence?.lastUserMessageFingerprint).toBe(later);
    expect(overwritten.operation?.acceptedPayloadFingerprint).toBe(fingerprint);
    // Acceptance proven without the payload's fingerprint never stamps.
    const ledger2 = new SubmissionOperationLedger(memoryStore());
    await ledger2.prepare({ ...input("stamp-2"), operationKind: "DELIVER_CHILD_RESULT", payload: "delivered result", payloadFingerprint: fingerprint });
    await ledger2.claim("stamp-2", context(), 10);
    await ledger2.record("stamp-2", "DISPATCHING", {
      now: 11,
      dispatchReceipt: { claimedAt: 10, attemptedAt: 11, outcome: "dispatched", fence: context() }
    });
    const foreign = await ledger2.reconcile("stamp-2", {
      ...baseline(),
      conversationRef: "conversation:a",
      userMessageCount: 2,
      lastUserMessageFingerprint: later,
      observedAt: 20,
      sourceEpoch: 0,
      generationActive: false,
      dispatchFence: context()
    });
    expect(foreign.outcome).toBe("PROVEN_ACCEPTED");
    expect(foreign.operation?.acceptedPayloadFingerprint).toBeUndefined();
  });

  it("retargets a FAILED_SAFE operation as a fresh attempt with the claim cleared", async () => {
    const rolledOver = context("browser-tab:9", "conversation:b", "t1", 4, 200);
    let currentAuthority = authority(context());
    const store = {
      ...memoryStore(),
      getAuthority: async () => currentAuthority
    };
    const ledger = new SubmissionOperationLedger(store);
    await ledger.prepare({ ...input("fs-1"), now: 10 });
    await ledger.claim("fs-1", context(), 10);
    await ledger.record("fs-1", "DISPATCHING", {
      now: 11, dispatchReceipt: { claimedAt: 10, attemptedAt: 11, outcome: "dispatched", fence: context() }
    });
    // Proven not accepted on the old destination.
    await ledger.reconcile("fs-1", {
      ...baseline(), conversationRef: "conversation:a",
      observedAt: 20, sourceEpoch: 0, generationActive: false,
      providerFailure: true, dispatchFence: context()
    });
    expect((await ledger.get("fs-1"))?.state).toBe("FAILED_SAFE");
    // The destination rolls over: the durable authority advances first.
    currentAuthority = authority(rolledOver);
    const retargeted = await ledger.retarget("fs-1", rolledOver, { ...baseline(), routeRef: "route:b", observedAt: 200 }, 50);
    expect(retargeted).toMatchObject({
      state: "PREPARED", providerConversationRef: "conversation:b", targetCarrierRef: "browser-tab:9",
      dispatchClaimedAt: undefined, dispatchReceipt: undefined,
      lastReconciliationEvidence: undefined, acceptedPayloadFingerprint: undefined, error: undefined
    });
    // The fresh attempt claims under the new fence.
    expect((await ledger.claim("fs-1", rolledOver, 60))?.state).toBe("DISPATCHING");
  });

  it("retarget refuses every non-retargetable state and a same-fence FAILED_SAFE reset", async () => {
    const rolledOver = context("browser-tab:9", "conversation:b", "t1", 4, 200);
    // Same-fence FAILED_SAFE must go through rearm, not retarget.
    const sameFence = new SubmissionOperationLedger(memoryStore());
    await sameFence.prepare({ ...input("lane-1"), now: 10 });
    await sameFence.claim("lane-1", context(), 10);
    await sameFence.reconcile("lane-1", {
      ...baseline(), conversationRef: "conversation:a",
      observedAt: 20, sourceEpoch: 0, generationActive: false,
      providerFailure: true, dispatchFence: context()
    });
    expect((await sameFence.get("lane-1"))?.state).toBe("FAILED_SAFE");
    expect(await sameFence.retarget("lane-1", context(), baseline(), 50)).toBeUndefined();
    expect((await sameFence.get("lane-1"))?.state).toBe("FAILED_SAFE");
    // Every execution-owning and terminal state refuses.
    for (const setup of [
      { id: "st-dispatching", reach: async (ledger: SubmissionOperationLedger, id: string) => ledger.claim(id, context(), 10) },
      { id: "st-uncertain", reach: async (ledger: SubmissionOperationLedger, id: string) => ledger.record(id, "UNCERTAIN", { now: 11, error: "lost" }) },
      { id: "st-observed", reach: async (ledger: SubmissionOperationLedger, id: string) => ledger.reconcile(id, {
        ...baseline(), conversationRef: "conversation:a", userMessageCount: 2,
        observedAt: 20, sourceEpoch: 0, generationActive: false, dispatchFence: context()
      }) },
      { id: "st-completed", reach: async (ledger: SubmissionOperationLedger, id: string) => {
        await ledger.reconcile(id, {
          ...baseline(), conversationRef: "conversation:a", userMessageCount: 2,
          lastUserMessageFingerprint: "ce8", observedAt: 3_015, stableSince: 12, sourceEpoch: 0,
          generationActive: false, dispatchFence: context()
        });
        await ledger.record(id, "COMPLETED", { now: 3_020 });
      } },
      { id: "st-cancelled", reach: async (ledger: SubmissionOperationLedger, id: string) => ledger.record(id, "CANCELLED", { now: 11 }) }
    ] as const) {
      let currentAuthority = authority(context());
      const store = { ...memoryStore(), getAuthority: async () => currentAuthority };
      const ledger = new SubmissionOperationLedger(store);
      await ledger.prepare({ ...input(setup.id), now: 10 });
      await ledger.claim(setup.id, context(), 10);
      await setup.reach(ledger, setup.id);
      const state = (await ledger.get(setup.id))?.state;
      expect(["DISPATCHING", "UNCERTAIN", "OBSERVED_ACCEPTED", "COMPLETED", "CANCELLED"], setup.id).toContain(state);
      currentAuthority = authority(rolledOver);
      expect(await ledger.retarget(setup.id, rolledOver, { ...baseline(), routeRef: "route:b", observedAt: 200 }, 300), setup.id).toBeUndefined();
      expect((await ledger.get(setup.id))?.state, setup.id).toBe(state);
    }
  });

  it("retarget refuses a context or baseline from another logical thread or conversation", async () => {
    // Cross-thread: the authority moved to another thread's tuple; the
    // operation must not follow it.
    const otherThread = context("browser-tab:9", "conversation:b", "other-l9", 4, 200);
    const crossThread = new SubmissionOperationLedger(memoryStore(authority(otherThread)));
    await crossThread.prepare({ ...input("rt-5"), now: 10 });
    expect(await crossThread.retarget("rt-5", otherThread, baseline(), 50)).toBeUndefined();
    expect((await crossThread.list())[0].providerConversationRef).toBe("conversation:a");
    // Baseline naming a different conversation than the new fence.
    const rolledOver = context("browser-tab:9", "conversation:b", "t1", 4, 200);
    const mismatchedBaseline = new SubmissionOperationLedger(memoryStore(authority(rolledOver)));
    await mismatchedBaseline.prepare({ ...input("rt-6"), now: 10 });
    expect(await mismatchedBaseline.retarget("rt-6", rolledOver, { ...baseline(), conversationRef: "conversation:old" }, 50)).toBeUndefined();
    expect((await mismatchedBaseline.retarget("rt-6", rolledOver, { ...baseline(), conversationRef: "conversation:b" }, 50))?.providerConversationRef).toBe("conversation:b");
  });
});
