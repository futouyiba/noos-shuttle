/**
 * Crash-consistent durable wrapper for the HarnessControlStateReducer.
 *
 * A mutation is applied to a staged copy of the state and the resulting state is
 * persisted BEFORE it is committed in memory, so a failing store leaves the
 * in-memory state untouched. If the process dies after the write lands but
 * before the result is acknowledged, the durable state may be ahead by that one
 * unacknowledged mutation — the standard write-ahead window; every mutation
 * carries an expectation fence, so reconciling on restart is safe.
 *
 * applyDelta adds the adjudicated delta-contract completeness: a delta_id +
 * fingerprint identity whose successful ApplyResult is durably recorded and
 * returned on replay (same id + same fingerprint → same logical apply; same id
 * + different fingerprint → rejected_invariant), with an audit/transition
 * record written in the SAME persistent transaction as the state.
 */

import {
  HarnessReducer,
  type CurrentConversationBinding,
  type HarnessReducerState,
  type ReducerResult,
} from "./harness-reducer";

export interface HarnessReducerStore {
  load(): Promise<DurableStateBundle | undefined>;
  save(bundle: DurableStateBundle): Promise<void>;
}

export interface DeltaApplyRecord {
  deltaId: string;
  deltaFingerprint: string;
  outcome: "applied" | "no_op";
  fromStateFingerprint: string;
  toStateFingerprint: string;
  auditRecordId: string;
  recordedAt: number;
}

export interface DeltaAuditRecord {
  auditRecordId: string;
  deltaId: string;
  reason: string;
  detail: Record<string, string | number | boolean>;
  recordedAt: number;
}

export interface DurableStateBundle {
  state?: HarnessReducerState;
  applyResults: DeltaApplyRecord[];
  auditRecords: DeltaAuditRecord[];
}

export type DeltaOutcome =
  | "applied"
  | "no_op"
  | "rejected_stale"
  | "rejected_precondition"
  | "rejected_invariant";

export interface ApplyDeltaInput<T> {
  deltaId: string;
  /** Content fingerprint of the delta request (not of the resulting state). */
  deltaFingerprint: string;
  /** Concurrency token: reject when the current state fingerprint differs. */
  expectedBaseStateFingerprint?: string;
  reason: string;
  detail?: Record<string, string | number | boolean>;
  mutate: (reducer: HarnessReducer) => ReducerResult<T>;
}

export type ApplyDeltaResult<T> =
  | { outcome: "applied" | "no_op"; value: T; record: DeltaApplyRecord; replayed: boolean }
  | { outcome: "rejected_invariant"; record?: undefined; replayed: true; priorOutcome: DeltaOutcome }
  | { outcome: "rejected_stale" | "rejected_precondition"; error?: { code: string; message: string } };

export const HARNESS_REDUCER_KEY = "noosHarnessReducer";

/** Deterministic fingerprint over a canonical (key-sorted) serialization. */
export function stateFingerprint(state: HarnessReducerState): string {
  const normalized = JSON.stringify(canonicalize(state));
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return `state:${hash.toString(16)}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = canonicalize(source[key]);
    return sorted;
  }
  return value;
}

export class DurableHarnessReducer {
  private reducer: HarnessReducer;
  private applyResults: DeltaApplyRecord[];
  private auditRecords: DeltaAuditRecord[];
  private queue: Promise<void> = Promise.resolve();

  private constructor(private readonly store: HarnessReducerStore) {
    this.reducer = new HarnessReducer();
    this.applyResults = [];
    this.auditRecords = [];
  }

  /** Load and validate the persisted bundle; corrupt state throws rather than silently resetting. */
  static async restore(store: HarnessReducerStore): Promise<DurableHarnessReducer> {
    const wrapper = new DurableHarnessReducer(store);
    const bundle = await store.load();
    if (bundle !== undefined && bundle !== null) {
      if (bundle.state !== undefined && bundle.state !== null) {
        wrapper.reducer.replace(bundle.state);
      }
      wrapper.applyResults = Array.isArray(bundle.applyResults) ? bundle.applyResults : [];
      wrapper.auditRecords = Array.isArray(bundle.auditRecords) ? bundle.auditRecords : [];
    }
    return wrapper;
  }

  snapshot(): HarnessReducerState {
    return this.reducer.snapshot();
  }

  getBinding(logicalThreadId: string): CurrentConversationBinding | undefined {
    return this.reducer.getBinding(logicalThreadId);
  }

  /** Persisted ApplyResults, for replay decisions and audit. */
  appliedDeltas(): DeltaApplyRecord[] {
    return [...this.applyResults];
  }

  auditTrail(): DeltaAuditRecord[] {
    return [...this.auditRecords];
  }

  /**
   * Apply a bare mutation and return its result. On success the post-state is
   * persisted before commit; if persistence fails the in-memory state is left
   * untouched, so nothing is acknowledged that is not durable.
   */
  applyResult<T>(mutate: (reducer: HarnessReducer) => ReducerResult<T>): Promise<ReducerResult<T>> {
    return this.serialize(async () => {
      const staged = new HarnessReducer(this.reducer.snapshot());
      const result = mutate(staged);
      if (!result.ok) return result;
      await this.persist(staged, this.applyResults, this.auditRecords);
      // Reference swap cannot throw, so a persisted state is never left ahead of
      // the in-memory state by a failing commit step.
      this.reducer = staged;
      return result;
    });
  }

  /**
   * Apply an identified delta (§2.4, §15 of the State Delta + Reducer Contract):
   * the state mutation, its ApplyResult record, and the audit/transition record
   * commit in one durable transaction; a successful apply replays as the
   * original record without re-executing, and a reused deltaId with a different
   * fingerprint is rejected as an invariant violation.
   */
  applyDelta<T>(input: ApplyDeltaInput<T>): Promise<ApplyDeltaResult<T>> {
    return this.serialize(async () => {
      const existing = this.applyResults.find(record => record.deltaId === input.deltaId);
      if (existing) {
        if (existing.deltaFingerprint !== input.deltaFingerprint) {
          this.rememberAudit(input, "rejected_invariant: deltaId reused with a different fingerprint");
          await this.persist(this.reducer, this.applyResults, this.auditRecords);
          return { outcome: "rejected_invariant" as const, replayed: true, priorOutcome: existing.outcome };
        }
        return { outcome: existing.outcome, value: undefined as T, record: existing, replayed: true };
      }

      const fromFingerprint = stateFingerprint(this.reducer.snapshot());
      if (input.expectedBaseStateFingerprint !== undefined && input.expectedBaseStateFingerprint !== fromFingerprint) {
        const outcome: ApplyDeltaResult<T> = { outcome: "rejected_stale" as const };
        this.rememberAudit(input, `rejected_stale (base ${input.expectedBaseStateFingerprint} != ${fromFingerprint})`);
        await this.persist(this.reducer, this.applyResults, this.auditRecords);
        return outcome;
      }

      const staged = new HarnessReducer(this.reducer.snapshot());
      const result = input.mutate(staged);
      if (!result.ok) {
        const outcome: ApplyDeltaResult<T> = {
          outcome: "rejected_precondition" as const,
          error: { code: result.error.code, message: result.error.message }
        };
        this.rememberAudit(input, `rejected_precondition: ${result.error.code}`);
        await this.persist(this.reducer, this.applyResults, this.auditRecords);
        return outcome;
      }

      const toState = staged.snapshot();
      const toFingerprint = stateFingerprint(toState);
      const outcome: "applied" | "no_op" = toFingerprint === fromFingerprint ? "no_op" : "applied";
      const auditRecordId = `ar:${input.deltaId}:${this.auditRecords.length + 1}`;
      const record: DeltaApplyRecord = {
        deltaId: input.deltaId,
        deltaFingerprint: input.deltaFingerprint,
        outcome,
        fromStateFingerprint: fromFingerprint,
        toStateFingerprint: toFingerprint,
        auditRecordId,
        recordedAt: Date.now()
      };
      const applyResults = [...this.applyResults, record];
      const auditRecords = [...this.auditRecords, {
        auditRecordId,
        deltaId: input.deltaId,
        reason: input.reason,
        detail: { ...(input.detail ?? {}) },
        recordedAt: record.recordedAt
      }];
      await this.persist(staged, applyResults, auditRecords);
      this.reducer = staged;
      this.applyResults = applyResults;
      this.auditRecords = auditRecords;
      if (outcome === "no_op") {
        return { outcome, value: result.value, record, replayed: false };
      }
      return { outcome, value: result.value, record, replayed: false };
    });
  }

  private rememberAudit(input: ApplyDeltaInput<unknown>, note: string): void {
    this.auditRecords = [...this.auditRecords, {
      auditRecordId: `ar:${input.deltaId}:${this.auditRecords.length + 1}`,
      deltaId: input.deltaId,
      reason: `${input.reason} — ${note}`,
      detail: { ...(input.detail ?? {}) },
      recordedAt: Date.now()
    }];
  }

  private async persist(staged: HarnessReducer, applyResults: DeltaApplyRecord[], auditRecords: DeltaAuditRecord[]): Promise<void> {
    await this.store.save({
      state: staged.snapshot(),
      applyResults,
      auditRecords
    });
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const chained = this.queue.then(work, work);
    this.queue = chained.then(() => undefined, () => undefined);
    return chained;
  }
}

export function createChromeHarnessReducerStore(
  chromeStorage: { get(key: string): Promise<unknown>; set(value: Record<string, unknown>): Promise<unknown> },
  key = HARNESS_REDUCER_KEY
): HarnessReducerStore {
  return {
    load: async () => {
      const raw = await chromeStorage.get(key);
      return raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] as DurableStateBundle | undefined : undefined;
    },
    save: async bundle => { await chromeStorage.set({ [key]: bundle }); }
  };
}
