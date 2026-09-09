import { describe, expect, it } from "vitest";
import { SubmissionOperationLedger, SUBMISSION_OPERATIONS_KEY, createChromeSubmissionStore } from "../src/core/submission-operation";

function baseline() { return { routeRef: "route:a", assistantMessageCount: 1, userMessageCount: 1, lastUserMessageFingerprint: "u1", lastAssistantMessageFingerprint: "a1", headFingerprint: "h1", observedAt: 1 }; }
function input(operationId: string, carrier = "browser-tab:1") { return { operationId, operationKind: "GO" as const, workItemId: "w1", logicalThreadId: "t1", targetCarrierRef: carrier, payloadFingerprint: "p1", payload: "go", preSubmitBaseline: baseline() }; }
function memoryStore() { let value: unknown; return { get: async (_key?: string) => value, set: async (next: Record<string, unknown>) => { value = next; } }; }

describe("SubmissionOperationLedger", () => {
  it("persists PREPARED before claim and is idempotent by operation id", async () => {
    const store = memoryStore(); const ledger = new SubmissionOperationLedger(store);
    const prepared = await ledger.prepare(input("op-1"),); expect(prepared.state).toBe("PREPARED");
    expect((await store.get(SUBMISSION_OPERATIONS_KEY) as any).noosSubmissionOperations[0].state).toBe("PREPARED");
    expect((await ledger.prepare(input("op-1"))).createdAt).toBe(prepared.createdAt);
    await expect(ledger.prepare({ ...input("op-1"), payloadFingerprint: "different" })).rejects.toThrow("operation_id_reuse_conflict");
  });
  it("allows only one active dispatch per carrier under concurrent claims", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore()); await ledger.prepare(input("a")); await ledger.prepare(input("b"));
    const [first, second] = await Promise.all([ledger.claim("a", 10), ledger.claim("b", 11)]);
    expect([first, second].filter(Boolean)).toHaveLength(1); expect((await ledger.list()).filter(x => x.state === "DISPATCHING")).toHaveLength(1);
  });
  it("reconciles accepted, proven-not-accepted and ambiguous evidence conservatively", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore()); await ledger.prepare(input("op-1")); await ledger.claim("op-1");
    let result = await ledger.reconcile("op-1", { ...baseline(), userMessageCount: 2, observedAt: 20 }); expect(result.outcome).toBe("PROVEN_ACCEPTED");
    await ledger.prepare(input("op-2")); await ledger.claim("op-2"); result = await ledger.reconcile("op-2", { ...baseline(), generationActive: false }); expect(result.outcome).toBe("PROVEN_NOT_ACCEPTED");
    await ledger.prepare(input("op-3")); await ledger.claim("op-3"); result = await ledger.reconcile("op-3", { ...baseline(), generationActive: true }); expect(result.outcome).toBe("STILL_AMBIGUOUS");
  });
  it("re-arms only after a fresh baseline", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore()); await ledger.prepare(input("op-1")); await ledger.claim("op-1"); await ledger.reconcile("op-1", { ...baseline(), generationActive: false });
    const next = await ledger.rearm("op-1", { ...baseline(), observedAt: 99 }); expect(next?.state).toBe("PREPARED"); expect(next?.preSubmitBaseline.observedAt).toBe(99);
  });
  it("adapts chrome storage promise API", async () => {
    const backing: Record<string, unknown> = {}; const ledger = new SubmissionOperationLedger(createChromeSubmissionStore({ get: async key => backing[key], set: async value => Object.assign(backing, value) }));
    await ledger.prepare(input("op-1")); expect((await ledger.list())[0].operationId).toBe("op-1");
  });
});
