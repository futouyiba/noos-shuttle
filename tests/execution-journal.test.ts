import { describe, expect, it } from "vitest";
import {
  EXECUTION_JOURNAL_KEY,
  ProviderExecutionJournal,
  createChromeExecutionJournalStore,
  dispatchFenceFingerprint,
  isExecutionJournalEntry,
  type ExecutionJournalStore,
} from "../src/core/execution-journal";

function memoryStore(): ExecutionJournalStore {
  const backing: Record<string, unknown> = {};
  return createChromeExecutionJournalStore({
    get: async (key: string) => ({ [key]: backing[key] }),
    set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
  });
}

const fence = {
  providerConversationRef: "conv-l1c",
  bindingEpoch: 3,
  leaseGeneration: 2,
  leaseOwnerRef: "obs-1",
  targetCarrierRef: "browser-tab:5"
};

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    executionAttemptId: "attempt-1",
    operationId: "op-1",
    dispatchFence: fence,
    eventKind: "BLIND_DISPATCH_ATTEMPT" as const,
    now: 100,
    ...overrides
  };
}

describe("execution journal fingerprint", () => {
  it("is deterministic for equal fences and differs on any field change", () => {
    expect(dispatchFenceFingerprint(fence)).toBe(dispatchFenceFingerprint({ ...fence }));
    expect(dispatchFenceFingerprint(fence)).not.toBe(dispatchFenceFingerprint({ ...fence, bindingEpoch: 4 }));
    expect(dispatchFenceFingerprint(fence)).not.toBe(dispatchFenceFingerprint({ ...fence, targetCarrierRef: "browser-tab:9" }));
    expect(dispatchFenceFingerprint(fence)).toMatch(/^fence:[0-9a-f]+$/);
  });

  it("keeps whitespace-split field collisions apart", () => {
    const split = dispatchFenceFingerprint({ ...fence, leaseOwnerRef: "x y", targetCarrierRef: "z" });
    const merged = dispatchFenceFingerprint({ ...fence, leaseOwnerRef: "x", targetCarrierRef: "y z" });
    expect(split).not.toBe(merged);
  });

  it("rejects a malformed fence", () => {
    expect(() => dispatchFenceFingerprint({ ...fence, bindingEpoch: -1 })).toThrow("journal_fence_invalid");
  });
});

describe("execution journal append", () => {
  it("appends a new entry once and replays the same fact idempotently", async () => {
    const journal = new ProviderExecutionJournal(memoryStore());
    const first = await journal.append(attempt());
    expect(first.replayed).toBe(false);
    expect(first.entry).toMatchObject({ operationId: "op-1", eventKind: "BLIND_DISPATCH_ATTEMPT", recordedAt: 100 });
    const replay = await journal.append(attempt({ now: 200, executionAttemptId: "attempt-2" }));
    expect(replay.replayed).toBe(true);
    expect(replay.entry).toEqual(first.entry);
    expect(await journal.list()).toHaveLength(1);
  });

  it("keeps distinct facts separate across kind, operation, and fence", async () => {
    const journal = new ProviderExecutionJournal(memoryStore());
    await journal.append(attempt());
    await journal.append(attempt({ eventKind: "PROVIDER_ACK" as const }));
    await journal.append(attempt({ operationId: "op-2" }));
    await journal.append(attempt({ dispatchFence: { ...fence, bindingEpoch: 4 } }));
    expect(await journal.list()).toHaveLength(4);
    expect(await journal.list("op-1")).toHaveLength(3);
  });

  it("serializes concurrent appends so neither is lost", async () => {
    const journal = new ProviderExecutionJournal(memoryStore());
    await Promise.all([
      journal.append(attempt({ operationId: "op-a" })),
      journal.append(attempt({ operationId: "op-b" }))
    ]);
    expect(await journal.list()).toHaveLength(2);
  });

  it("rejects malformed input", async () => {
    const journal = new ProviderExecutionJournal(memoryStore());
    await expect(journal.append(attempt({ operationId: "" }))).rejects.toThrow("journal_input_invalid");
    await expect(journal.append(attempt({ eventKind: "BOGUS" as never }))).rejects.toThrow("journal_input_invalid");
  });
});

describe("execution journal persistence", () => {
  it("survives a store round-trip and rejects malformed entries", async () => {
    const store = memoryStore();
    const journal = new ProviderExecutionJournal(store);
    await journal.append(attempt({ evidence: { ok: true, latencyMs: 42, note: "clicked" } }));
    const restored = await new ProviderExecutionJournal(store).list();
    expect(restored).toHaveLength(1);
    expect(restored[0].evidence).toEqual({ ok: true, latencyMs: 42, note: "clicked" });

    const base = {
      executionAttemptId: "a", operationId: "o",
      dispatchFenceFingerprint: "fence:1a", eventKind: "PROVIDER_ACK" as const,
      evidence: {}, recordedAt: 1
    };
    expect(isExecutionJournalEntry(base)).toBe(true);
    expect(isExecutionJournalEntry({ ...base, dispatchFenceFingerprint: "not-a-fence" })).toBe(false);
    expect(isExecutionJournalEntry({ ...base, eventKind: "NOPE" })).toBe(false);
    expect(isExecutionJournalEntry({ ...base, evidence: { nested: {} } })).toBe(false);
  });

  it("ignores corrupted array entries", async () => {
    const store = memoryStore();
    await store.set({ [EXECUTION_JOURNAL_KEY]: [{ operationId: "bad" }] });
    expect(await new ProviderExecutionJournal(store).list()).toEqual([]);
  });
});
