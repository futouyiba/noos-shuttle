/**
 * Provider Execution Journal — append-only execution/evidence log.
 *
 * Separate from the authoritative control-state reducer (adjudication
 * 2026-09-15, §九/§十三): the reducer decides what is allowed now; this journal
 * records what actually happened on the provider/browser side. It owns no
 * binding, lease, or SubmissionOperation canonical state. Idempotency key is
 * (operationId, dispatchFenceFingerprint, eventKind) per the frozen identity
 * map — replaying the same fact returns the original entry instead of double
 * bookkeeping. Journal idempotency prevents duplicate records, not duplicate
 * provider actuation; that stays with persist-PREPARED → atomic claim → fence →
 * one blind dispatch → reconcile. Artifacts here are deliberately not named
 * "ApplyResult", which belongs to the control-state reducer.
 */

export type ExecutionEventKind =
  | "BLIND_DISPATCH_ATTEMPT"
  | "PROVIDER_ACK"
  | "ACCEPTANCE_OBSERVED"
  | "TURN_COMPLETION_OBSERVED"
  | "RECONCILIATION_EVIDENCE";

export interface ExecutionJournalEntry {
  executionAttemptId: string;
  operationId: string;
  dispatchFenceFingerprint: string;
  eventKind: ExecutionEventKind;
  /** Caller-supplied evidence payload (observation ref, receipt, error note). */
  evidence: Record<string, string | number | boolean>;
  recordedAt: number;
}

export interface AppendExecutionEventInput {
  executionAttemptId: string;
  operationId: string;
  dispatchFence: {
    providerConversationRef: string;
    bindingEpoch: number;
    leaseGeneration: number;
    leaseOwnerRef: string;
    targetCarrierRef: string;
  };
  eventKind: ExecutionEventKind;
  evidence?: Record<string, string | number | boolean>;
  now?: number;
}

export interface ExecutionJournalStore {
  get(key?: string): Promise<unknown>;
  set(value: Record<string, unknown>): Promise<unknown>;
}

export const EXECUTION_JOURNAL_KEY = "noosExecutionJournal";

/** Deterministic fence fingerprint: same fence → same fingerprint, always. */
export function dispatchFenceFingerprint(fence: AppendExecutionEventInput["dispatchFence"]): string {
  if (!isFence(fence)) throw new Error("journal_fence_invalid");
  // JSON encoding is delimiter-safe: free-string fields cannot collide across
  // different field splits (a " "-joined encoding would fold "x y"+z onto
  // x+"y z"). Structure mirrors the control-state reducer's DispatchFence
  // (providerConversationRef, generation pair, owner, carrier) under its
  // binding/lease epoch naming; the wiring slice owns the field mapping.
  const normalized = JSON.stringify([
    fence.providerConversationRef,
    fence.bindingEpoch,
    fence.leaseGeneration,
    fence.leaseOwnerRef,
    fence.targetCarrierRef
  ]);
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return `fence:${hash.toString(16)}`;
}

export class ProviderExecutionJournal {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly store: ExecutionJournalStore) {}

  async list(operationId?: string): Promise<ExecutionJournalEntry[]> {
    const raw = await this.store.get(EXECUTION_JOURNAL_KEY);
    const records = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[EXECUTION_JOURNAL_KEY] : undefined;
    const entries = Array.isArray(records) ? records.filter(isExecutionJournalEntry) : [];
    return operationId === undefined ? entries : entries.filter(entry => entry.operationId === operationId);
  }

  /** Append-or-get: the frozen three-part key decides replay vs new entry. */
  async append(input: AppendExecutionEventInput): Promise<{ entry: ExecutionJournalEntry; replayed: boolean }> {
    if (!isAppendInput(input)) throw new Error("journal_input_invalid");
    const fenceFingerprint = dispatchFenceFingerprint(input.dispatchFence);
    return this.serialize<{ entry: ExecutionJournalEntry; replayed: boolean }>(records => {
      const existing = records.find(candidate =>
        candidate.operationId === input.operationId &&
        candidate.dispatchFenceFingerprint === fenceFingerprint &&
        candidate.eventKind === input.eventKind
      );
      if (existing) return { records, result: { entry: existing, replayed: true } };
      const entry: ExecutionJournalEntry = {
        executionAttemptId: input.executionAttemptId,
        operationId: input.operationId,
        dispatchFenceFingerprint: fenceFingerprint,
        eventKind: input.eventKind,
        evidence: { ...(input.evidence ?? {}) },
        recordedAt: input.now ?? Date.now()
      };
      return { records: [...records, entry], result: { entry, replayed: false } };
    });
  }

  private async serialize<T>(work: (records: ExecutionJournalEntry[]) => { records: ExecutionJournalEntry[]; result: T }): Promise<T> {
    const run = async (): Promise<T> => {
      const raw = await this.store.get(EXECUTION_JOURNAL_KEY);
      const records = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[EXECUTION_JOURNAL_KEY] : undefined;
      const valid = Array.isArray(records) ? records.filter(isExecutionJournalEntry) : [];
      const { records: nextRecords, result } = work(valid);
      await this.store.set({ [EXECUTION_JOURNAL_KEY]: nextRecords });
      return result;
    };
    const chained = this.queue.then(run, run);
    this.queue = chained.then(() => undefined, () => undefined);
    return chained;
  }
}

export function createChromeExecutionJournalStore(chromeStorage: {
  get(key: string): Promise<unknown>;
  set(value: Record<string, unknown>): Promise<unknown>;
}): ExecutionJournalStore {
  return {
    get: key => chromeStorage.get(key ?? EXECUTION_JOURNAL_KEY),
    set: value => chromeStorage.set(value)
  };
}

export function isExecutionJournalEntry(value: unknown): value is ExecutionJournalEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return isOperationId(entry.executionAttemptId) &&
    isOperationId(entry.operationId) &&
    typeof entry.dispatchFenceFingerprint === "string" &&
    /^fence:[0-9a-f]+$/.test(entry.dispatchFenceFingerprint) &&
    isExecutionEventKind(entry.eventKind) &&
    isEvidence(entry.evidence) &&
    isFiniteInteger(entry.recordedAt);
}

const EVENT_KINDS: ExecutionEventKind[] = [
  "BLIND_DISPATCH_ATTEMPT",
  "PROVIDER_ACK",
  "ACCEPTANCE_OBSERVED",
  "TURN_COMPLETION_OBSERVED",
  "RECONCILIATION_EVIDENCE"
];

function isExecutionEventKind(value: unknown): value is ExecutionEventKind {
  return typeof value === "string" && (EVENT_KINDS as string[]).includes(value);
}

function isEvidence(value: unknown): value is Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    item => typeof item === "string" || typeof item === "number" || typeof item === "boolean"
  );
}

function isAppendInput(value: unknown): value is AppendExecutionEventInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return isOperationId(input.executionAttemptId) &&
    isOperationId(input.operationId) &&
    isFence(input.dispatchFence) &&
    isExecutionEventKind(input.eventKind) &&
    (input.evidence === undefined || isEvidence(input.evidence)) &&
    (input.now === undefined || isFiniteInteger(input.now));
}

function isFence(value: unknown): value is AppendExecutionEventInput["dispatchFence"] {
  if (!value || typeof value !== "object") return false;
  const fence = value as Record<string, unknown>;
  return typeof fence.providerConversationRef === "string" && fence.providerConversationRef.trim().length > 0 &&
    typeof fence.leaseOwnerRef === "string" && fence.leaseOwnerRef.trim().length > 0 &&
    typeof fence.targetCarrierRef === "string" && fence.targetCarrierRef.trim().length > 0 &&
    isFiniteInteger(fence.bindingEpoch) && fence.bindingEpoch >= 0 &&
    isFiniteInteger(fence.leaseGeneration) && fence.leaseGeneration >= 0;
}

function isOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value);
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
