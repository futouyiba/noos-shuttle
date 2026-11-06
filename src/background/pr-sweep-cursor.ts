/**
 * Background coordinator half of the PR comment sweep watermark (issue #61
 * slice 5). Proposal §5.3 constraint 1 puts the durable watermark in the
 * extension, and §6 Q7 requires one writer per `prRef` slot. The content script
 * is not that writer: it asks this module, which serialises every mutation
 * through one promise chain and then applies the pure compare-and-set reducer
 * from `core/pr-sweep-cursor`.
 */
import {
  PR_SWEEP_CURSOR_STORAGE_KEY,
  advancePrSweepCursor,
  readPrSweepCursorRecord,
  type PrSweepCursorAdvanceInput,
  type PrSweepCursorAdvanceResult
} from "../core/pr-sweep-cursor";

export interface PrSweepCursorStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
}

/** One mutation lane for every PR ref: the durable store has a single writer. */
let pending: Promise<unknown> = Promise.resolve();

/** The pre-dispatch snapshot a content script may carry into its CAS. */
export async function readStoredPrSweepCursor(
  storage: PrSweepCursorStorage,
  prRef: string
): Promise<{ cursor: string; observedAt: number } | undefined> {
  const persisted = await storage.get(PR_SWEEP_CURSOR_STORAGE_KEY);
  const record = readPrSweepCursorRecord(persisted[PR_SWEEP_CURSOR_STORAGE_KEY], prRef);
  return record ? { cursor: record.cursor, observedAt: record.observedAt } : undefined;
}

/**
 * Advance one slot only when the stored cursor still equals the snapshot the
 * dispatching tab read. Never throws for a conflict: a conflict is a normal
 * outcome and leaves the stored watermark untouched.
 */
export function advanceStoredPrSweepCursor(
  storage: PrSweepCursorStorage,
  input: PrSweepCursorAdvanceInput
): Promise<PrSweepCursorAdvanceResult> {
  const run = pending.then(async () => {
    const persisted = await storage.get(PR_SWEEP_CURSOR_STORAGE_KEY);
    const result = advancePrSweepCursor(persisted[PR_SWEEP_CURSOR_STORAGE_KEY], input);
    if (result.ok) {
      await storage.set({ [PR_SWEEP_CURSOR_STORAGE_KEY]: result.records });
    }
    return result;
  });
  pending = run.catch(() => undefined);
  return run;
}
