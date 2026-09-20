/** Type declarations for the scripts/noos-watch-migrate-dismissed.mjs CLI (consumed by tests). */
import type { DismissalDecision, ThreadComment, WatcherState } from "./noos-watch-state.mjs";

export interface MigrationPlan {
  decisions: (DismissalDecision & { commentId: string })[];
  indeterminate: { commentId: string; why: string }[];
  stayed: { commentId: string; action: string | null }[];
}

export declare function defaultStatePath(lockPath: string): string;
export declare function parseArgs(argv: string[]): {
  apply: boolean;
  confirmR4: boolean;
  state?: string;
  comments?: string;
  "lock-file"?: string;
};
export declare function normalizeComments(raw: unknown): ThreadComment[];
export declare function planMigration(
  state: WatcherState,
  comments: ThreadComment[],
  options?: { confirmR4?: boolean }
): MigrationPlan;
export declare function refreshDerivedFields(state: WatcherState): WatcherState;
export declare function renderPlan(state: WatcherState, plan: MigrationPlan): string[];
