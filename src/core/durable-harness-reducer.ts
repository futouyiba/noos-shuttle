/**
 * Crash-consistent durable wrapper for HarnessReducer.
 *
 * A mutation is applied to a staged copy of the state and the resulting state is
 * persisted BEFORE it is committed in memory, so a failing store leaves the
 * in-memory state untouched. If the process dies after the write lands but
 * before the result is acknowledged, the durable state may be ahead by that one
 * unacknowledged mutation — the standard write-ahead window; every mutation
 * carries an expectation fence, so reconciling on restart is safe.
 * See docs: v1-final-e2e-readiness-confirmation.md §5 (crash-consistent ApplyResults).
 */

import {
  HarnessReducer,
  type CurrentConversationBinding,
  type HarnessReducerState,
  type ReducerResult
} from "./harness-reducer";

export interface HarnessReducerStore {
  load(): Promise<unknown>;
  save(state: HarnessReducerState): Promise<void>;
}

export const HARNESS_REDUCER_KEY = "noosHarnessReducer";

export class DurableHarnessReducer {
  private reducer: HarnessReducer;
  private queue: Promise<void> = Promise.resolve();

  private constructor(private readonly store: HarnessReducerStore) {
    this.reducer = new HarnessReducer();
  }

  /** Load and validate the persisted state; corrupt state throws rather than silently resetting. */
  static async restore(store: HarnessReducerStore): Promise<DurableHarnessReducer> {
    const wrapper = new DurableHarnessReducer(store);
    const raw = await store.load();
    if (raw !== undefined && raw !== null) {
      wrapper.reducer.replace(raw as HarnessReducerState);
    }
    return wrapper;
  }

  snapshot(): HarnessReducerState {
    return this.reducer.snapshot();
  }

  getBinding(logicalThreadId: string): CurrentConversationBinding | undefined {
    return this.reducer.getBinding(logicalThreadId);
  }

  /**
   * Apply a mutation and return its result. On success the post-state is
   * persisted before commit; if persistence fails the in-memory state is left
   * untouched, so nothing is acknowledged that is not durable.
   */
  applyResult<T>(mutate: (reducer: HarnessReducer) => ReducerResult<T>): Promise<ReducerResult<T>> {
    return this.serialize(async () => {
      const staged = new HarnessReducer(this.reducer.snapshot());
      const result = mutate(staged);
      if (!result.ok) return result;
      const persisted = staged.snapshot();
      await this.store.save(persisted);
      // Reference swap cannot throw, so a persisted state is never left ahead of
      // the in-memory state by a failing commit step.
      this.reducer = staged;
      return result;
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
      return raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
    },
    save: async state => { await chromeStorage.set({ [key]: state }); }
  };
}
