import { describe, expect, it } from "vitest";
import { HumanGoRuntime, type HumanGoCarrierSnapshot, type HumanGoRequest } from "../src/core/human-go-runtime";
import { SubmissionOperationLedger } from "../src/core/submission-operation";

function baseline() { return { routeRef: "/c/conversation-a", assistantMessageCount: 1, userMessageCount: 1, observedAt: 1 }; }
function carrier(overrides: Partial<HumanGoCarrierSnapshot> = {}): HumanGoCarrierSnapshot {
  return {
    logicalThreadId: "thread-1",
    providerConversationRef: "conversation-a",
    bindingEpoch: 3,
    leaseGeneration: 7,
    leaseOwnerRef: "lease-owner-a",
    targetCarrierRef: "browser-tab:11",
    carrierState: "READY",
    logicalControl: "CONTINUE",
    explicitGo: true,
    sourceEpoch: 4,
    sourceObservedAt: 1,
    ...overrides
  };
}
function request(overrides: Partial<HumanGoRequest> = {}): HumanGoRequest {
  return {
    operationId: "go-1",
    workItemId: "work-1",
    logicalThreadId: "thread-1",
    payload: "continue",
    payloadFingerprint: "de312ca7",
    preSubmitBaseline: baseline(),
    providerConversationRef: "conversation-a",
    targetCarrierRef: "browser-tab:11",
    bindingEpoch: 3,
    leaseGeneration: 7,
    leaseOwnerRef: "lease-owner-a",
    explicitGo: true,
    sourceEpoch: 4,
    sourceObservedAt: 1,
    ...overrides
  };
}
function memoryStore() {
  let value: unknown;
  const authority = carrier();
  return {
    get: async () => value,
    set: async (next: Record<string, unknown>) => { value = next; },
    ensureAuthority: async () => undefined,
    getAuthority: async () => ({
      logicalThreadId: "thread-1",
      providerConversationRef: authority.providerConversationRef,
      bindingEpoch: authority.bindingEpoch,
      leaseGeneration: authority.leaseGeneration,
      leaseOwnerRef: authority.leaseOwnerRef,
      targetCarrierRef: authority.targetCarrierRef,
      carrierState: "READY" as const,
      logicalControl: "CONTINUE" as const,
      explicitGo: true,
      sourceEpoch: authority.sourceEpoch,
      sourceObservedAt: authority.sourceObservedAt,
      authorityGeneration: 1,
      authorityEstablishedAt: authority.sourceObservedAt
    }),
    read: () => value
  };
}

describe("HumanGoRuntime", () => {
  it("persists and claims before provider actuation", async () => {
    const store = memoryStore();
    const ledger = new SubmissionOperationLedger(store);
    let observedState: string | undefined;
    const runtime = new HumanGoRuntime(ledger, {
      readCurrentCarrier: async () => carrier(),
      dispatch: async () => {
        const records = await ledger.list();
        observedState = records[0]?.state;
      }
    });
    const result = await runtime.execute(request());
    expect(result.status).toBe("DISPATCHED");
    expect(observedState).toBe("DISPATCHING");
    expect((await ledger.get("go-1"))?.dispatchReceipt).toEqual(expect.objectContaining({
      outcome: "dispatched",
      fence: expect.objectContaining({ providerConversationRef: "conversation-a" })
    }));
  });

  it("requires current READY carrier, CONTINUE and explicit GO", async () => {
    let dispatches = 0;
    const runtime = new HumanGoRuntime(new SubmissionOperationLedger(memoryStore()), {
      readCurrentCarrier: async () => carrier({ carrierState: "STABILIZING" }),
      dispatch: async () => { dispatches += 1; }
    });
    const result = await runtime.execute(request());
    expect(result).toEqual({ status: "BLOCKED", reason: "carrier_not_ready" });
    expect(dispatches).toBe(0);
  });

  it("rejects stale provider, binding or lease fences before claiming", async () => {
    let dispatches = 0;
    const runtime = new HumanGoRuntime(new SubmissionOperationLedger(memoryStore()), {
      readCurrentCarrier: async () => carrier({ leaseGeneration: 8 }),
      dispatch: async () => { dispatches += 1; }
    });
    const result = await runtime.execute(request());
    expect(result).toEqual({ status: "BLOCKED", reason: "fence_mismatch" });
    expect(dispatches).toBe(0);
  });

  it("leaves a failed provider dispatch UNCERTAIN and never fabricates FAILED_SAFE", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    const runtime = new HumanGoRuntime(ledger, {
      readCurrentCarrier: async () => carrier(),
      dispatch: async () => { throw new Error("provider_lost"); }
    });
    const result = await runtime.execute(request());
    expect(result.status).toBe("UNCERTAIN");
    expect(result.status === "UNCERTAIN" && result.operation.state).toBe("UNCERTAIN");
    expect((await ledger.get("go-1"))?.state).toBe("UNCERTAIN");
  });

  it("reuses a stable operation id after an uncertain response and does not resend blindly", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    let dispatches = 0;
    const runtime = new HumanGoRuntime(ledger, {
      readCurrentCarrier: async () => carrier(),
      dispatch: async () => { dispatches += 1; throw new Error("response_lost"); }
    });
    const first = await runtime.execute(request());
    const second = await runtime.execute(request());
    expect(first.status).toBe("UNCERTAIN");
    expect(second.status).toBe("UNCERTAIN");
    expect(dispatches).toBe(1);
  });

  it("recovers UNCERTAIN when the record response is lost after commit", async () => {
    const backing: { operations: unknown } = { operations: [] };
    const authority = carrier();
    const coordinator = new SubmissionOperationLedger({
      get: async () => ({ noosSubmissionOperations: backing.operations }),
      set: async (value) => { backing.operations = value.noosSubmissionOperations; },
      getAuthority: async () => ({
        logicalThreadId: authority.logicalThreadId,
        providerConversationRef: authority.providerConversationRef,
        bindingEpoch: authority.bindingEpoch,
        leaseGeneration: authority.leaseGeneration,
        leaseOwnerRef: authority.leaseOwnerRef,
        targetCarrierRef: authority.targetCarrierRef,
        carrierState: "READY",
        logicalControl: "CONTINUE",
        explicitGo: true,
        sourceEpoch: authority.sourceEpoch,
        sourceObservedAt: authority.sourceObservedAt,
        authorityGeneration: 1,
        authorityEstablishedAt: authority.sourceObservedAt
      }),
      ensureAuthority: async () => undefined
    });
    let lost = true;
    const client = new SubmissionOperationLedger({
      get: async () => ({ noosSubmissionOperations: backing.operations }),
      set: async (value) => { backing.operations = value.noosSubmissionOperations; },
      ensureAuthority: async () => undefined,
      dispatch: async mutation => {
        const result = await (async () => {
          switch (mutation.type) {
            case "prepare": return coordinator.prepare(mutation.input);
            case "claim": return coordinator.claim(mutation.operationId, mutation.context, mutation.now);
            case "record": return coordinator.record(mutation.operationId, mutation.state, mutation.details);
            default: return undefined;
          }
        })();
        if (mutation.type === "record" && lost) {
          lost = false;
          throw new Error("response_lost");
        }
        return result;
      }
    });
    let dispatches = 0;
    const runtime = new HumanGoRuntime(client, {
      readCurrentCarrier: async () => authority,
      dispatch: async () => { dispatches += 1; throw new Error("provider_lost"); }
    });
    const result = await runtime.execute(request());
    expect(result.status).toBe("UNCERTAIN");
    expect((await coordinator.get("go-1"))?.state).toBe("UNCERTAIN");
    expect(dispatches).toBe(1);
  });

  it("reports UNCERTAIN when a successful dispatch receipt cannot be persisted", async () => {
    let value: unknown;
    let writes = 0;
    const authority = carrier();
    const ledger = new SubmissionOperationLedger({
      get: async () => value,
      set: async (next: Record<string, unknown>) => {
        writes += 1;
        if (writes >= 3) throw new Error("storage_unavailable");
        value = next;
      },
      getAuthority: async () => ({
        ...authority,
        carrierState: "READY" as const,
        logicalControl: "CONTINUE" as const,
        explicitGo: true as const,
        authorityGeneration: 1,
        authorityEstablishedAt: authority.sourceObservedAt
      }),
      ensureAuthority: async () => undefined
    });
    const runtime = new HumanGoRuntime(ledger, {
      readCurrentCarrier: async () => authority,
      dispatch: async () => undefined
    });
    const result = await runtime.execute(request());
    expect(result.status).toBe("UNCERTAIN");
    expect(result.status === "UNCERTAIN" && result.operation.state).toBe("DISPATCHING");
  });

  it("re-reads the carrier after prepare and rejects an SPA conversation switch", async () => {
    const ledger = new SubmissionOperationLedger(memoryStore());
    let reads = 0;
    let dispatches = 0;
    const runtime = new HumanGoRuntime(ledger, {
      readCurrentCarrier: async () => {
        reads += 1;
        return reads === 1 ? carrier() : carrier({
          providerConversationRef: "conversation-b",
          sourceEpoch: 5,
          sourceObservedAt: 2,
          bindingEpoch: 5,
          leaseGeneration: 5
        });
      },
      dispatch: async () => { dispatches += 1; }
    });
    const result = await runtime.execute(request());
    expect(result).toEqual({ status: "BLOCKED", reason: "fence_mismatch" });
    expect(dispatches).toBe(0);
    expect((await ledger.get("go-1"))?.state).toBe("PREPARED");
  });
});
