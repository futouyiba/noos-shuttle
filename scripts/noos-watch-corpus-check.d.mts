/** Type declarations for scripts/noos-watch-corpus-check.mjs (consumed by tests). */
import type { CommentKind, DismissalRule } from "./noos-watch-state.mjs";

export interface CorpusComment {
  id: number | string;
  thread: number | null;
  body: string;
  createdAt: string | null;
}

export interface RuleComparison {
  count: number;
  ids: number[];
  identicalToIndependent: boolean;
}

export interface CrossCheckResult {
  concordant: boolean;
  rules: Record<"D1" | "D2" | "D3" | "D5", RuleComparison>;
  kinds: Partial<Record<CommentKind, number>>;
  corpus: number;
  mismatches: { id: number; thread: number | null; module: DismissalRule | null; independent: DismissalRule | null }[];
}

export declare function parseArgs(argv: string[]): { comments: string; json: boolean };
export declare function normalizeCorpus(raw: unknown): CorpusComment[];
export declare function crossCheck(corpus: CorpusComment[]): CrossCheckResult;
export declare function render(result: CrossCheckResult): string[];
