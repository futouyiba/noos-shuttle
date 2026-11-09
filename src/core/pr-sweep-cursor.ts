/**
 * PR comment sweep cursor (issue #61 slice 5, proposal §5.3 and §6 Q7/Q8).
 *
 * EXPERIMENTAL HARNESS — observe-only, no durable watermark.
 *
 * The designer ruling on PR #151 (`DESIGN: REQUEST_CHANGES`, comment
 * 6680747888) narrowed this slice to path B: until Q8 evidence establishes what
 * a retrieved range means for deterministic replay/dedup, the sweep may exist
 * as an instrument but MUST NOT promote a durable cursor. Q8's open questions —
 * the retrieval path's ordering semantics, whether one scalar is replay-safe,
 * whether the assistant reports its range stably, whether edited old comments
 * re-enter a sweep — cannot be proven from the extension: GitHub is unreachable
 * here (F3), and retrieval happens inside the injected ChatGPT turn.
 *
 * So production behavior is: parse and attribute the echo (R2), honor the
 * "no new comments" veto (R3), and *display* the observed token. Nothing is
 * persisted, no compare-and-set commit runs, and no stored value can become the
 * authority for "already processed". This module therefore makes no claim
 * that a sweep can never skip comments — that property is exactly what Q8 has
 * to establish before the durable path below may be re-enabled.
 *
 * The durable reducer at the bottom of this file is retained as the frozen
 * design for that promotion. It has no production caller: the background
 * writer and both cursor storage messages were removed. Re-enable it only with
 * Q8 evidence and a fresh independent review.
 */

export const PR_SWEEP_CURSOR_ECHO_PREFIX = "NOOS:PR_SWEEP:CURSOR=";

/** Transport bound only: a cursor must fit one payload line. Not a shape. */
export const PR_SWEEP_MAX_CURSOR_LENGTH = 512;

function singleLine(value: string, maxLength: number): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  if (/[\r\n\u0000]/.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Normalize an opaque cursor. This validates transport safety only — it does not
 * interpret, order or compare tokens.
 */
export function normalizePrSweepCursor(value: unknown): string | undefined {
  return typeof value === "string" ? singleLine(value, PR_SWEEP_MAX_CURSOR_LENGTH) : undefined;
}

/** Markdown renderers may wrap the echo in a list marker and backticks. */
function stripEchoDecorations(value: string): string {
  let next = value.trim();
  next = next.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "");
  if (next.startsWith("`") && next.endsWith("`") && next.length >= 2) {
    next = next.slice(1, -1).trim();
  }
  return next;
}

/**
 * Read the machine-readable cursor echo from one assistant reply. The last valid
 * line wins. Placeholders (`<...>`, `...`) are rejected: they mean the assistant
 * repeated the instruction instead of reporting what it read.
 */
export function parsePrSweepCursorEcho(text: string): string | undefined {
  let found: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripEchoDecorations(rawLine);
    const index = line.indexOf(PR_SWEEP_CURSOR_ECHO_PREFIX);
    if (index === -1) continue;
    let value = line.slice(index + PR_SWEEP_CURSOR_ECHO_PREFIX.length).trim();
    if (value.startsWith("`") && value.endsWith("`") && value.length >= 2) {
      value = value.slice(1, -1).trim();
    }
    // The payload's own placeholder is `<...>`; a model substituting inside it
    // commonly answers `<token>`. Unwrap one pair rather than storing punctuation.
    const wrapped = value.match(/^<([\s\S]+)>$/);
    if (wrapped) value = wrapped[1].trim();
    if (!value || value === "..." || value === "<...>") continue;
    const normalized = normalizePrSweepCursor(value);
    if (normalized) found = normalized;
  }
  return found;
}

/**
 * The payload's explicit no-silence branch. Used only to finish the wait early;
 * it never advances the watermark (there is no observed range to advance to).
 */
export function prSweepReportsNoNewComments(text: string): boolean {
  return /无新评论|no\s+new\s+comments/i.test(text);
}

/* ==================== INACTIVE DURABLE DESIGN (Q8) ====================
 * Everything below this line is the frozen *durable watermark* design. It has
 * NO production caller: PR #151 was narrowed to an observe-only harness, so the
 * background writer and the `NOOS_PR_SWEEP_CURSOR_READ`/`_ADVANCE` messages no
 * longer exist. The unit tests for this reducer are kept as the specification
 * that must be re-enabled together with the durable path once Q8 evidence
 * resolves. Do not wire any of it back in without that evidence and a fresh
 * independent review (designer ruling 6680747888, path B).
 * ==================================================================== */

export const PR_SWEEP_CURSOR_STORAGE_KEY = "noosPrSweepCursors";

/** Transport bound only: a ref must fit one payload line. Not a shape. */
export const PR_SWEEP_MAX_REF_LENGTH = 256;

/** One durable watermark, keyed by PR ref. */
export interface PrSweepCursorRecord {
  /** The opaque token echoed by the last completed sweep. */
  readonly cursor: string;
  /** Ledger operation that produced the echo; ties the watermark to provenance. */
  readonly operationId: string;
  /** When the echo was observed (not when the comments were written). */
  readonly observedAt: number;
}

export type PrSweepCursorRecords = Readonly<Record<string, PrSweepCursorRecord>>;

/** Normalize an explicitly supplied PR ref; undefined means "refuse, never guess". */
export function normalizePrSweepRef(value: unknown): string | undefined {
  return typeof value === "string" ? singleLine(value, PR_SWEEP_MAX_REF_LENGTH) : undefined;
}

function readRecord(value: unknown): PrSweepCursorRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<PrSweepCursorRecord>;
  const cursor = normalizePrSweepCursor(record.cursor);
  if (!cursor || typeof record.operationId !== "string" || !record.operationId.trim()) return undefined;
  if (typeof record.observedAt !== "number" || !Number.isSafeInteger(record.observedAt) || record.observedAt < 0) return undefined;
  return { cursor, operationId: record.operationId, observedAt: record.observedAt };
}

function readRecords(value: unknown): PrSweepCursorRecords {
  if (!value || typeof value !== "object") return {};
  const stored = value as Record<string, unknown>;
  const records: Record<string, PrSweepCursorRecord> = {};
  for (const prRef of Object.keys(stored)) {
    if (!Object.hasOwn(stored, prRef)) continue;
    const record = readRecord(stored[prRef]);
    if (record) records[prRef] = record;
  }
  return records;
}

/** The stored watermark for one PR ref, or undefined when no sweep completed. */
export function readPrSweepCursorRecord(value: unknown, prRef: string): PrSweepCursorRecord | undefined {
  const normalizedRef = normalizePrSweepRef(prRef);
  if (!normalizedRef) return undefined;
  return readRecords(value)[normalizedRef];
}

export interface PrSweepCursorAdvanceInput {
  readonly prRef: string;
  /**
   * The cursor snapshot read before dispatch, or null when the slot was empty.
   * Advancement only lands if the slot still holds this value — the CAS half of
   * proposal §6 Q7's "same slot, single writer, no concurrent advance".
   */
  readonly expectedStoredCursor: string | null;
  /** The token observed in this sweep's reply. */
  readonly cursor: string;
  /** Ledger operation that dispatched the sweep. */
  readonly operationId: string;
  readonly observedAt: number;
}

export type PrSweepCursorAdvanceResult =
  | { readonly ok: true; readonly records: PrSweepCursorRecords; readonly record: PrSweepCursorRecord }
  | { readonly ok: false; readonly reason: "invalid_pr_ref" | "invalid_cursor" | "cursor_conflict" };

/**
 * Advance one PR ref's watermark, compare-and-set against the pre-dispatch
 * snapshot. A conflict is a normal outcome (another sweep or tab advanced first)
 * and never overwrites: the stale writer's range is re-read next time.
 */
export function advancePrSweepCursor(value: unknown, input: PrSweepCursorAdvanceInput): PrSweepCursorAdvanceResult {
  const prRef = normalizePrSweepRef(input.prRef);
  if (!prRef) return { ok: false, reason: "invalid_pr_ref" };
  const cursor = normalizePrSweepCursor(input.cursor);
  if (!cursor) return { ok: false, reason: "invalid_cursor" };
  const operationId = typeof input.operationId === "string" ? input.operationId.trim() : "";
  if (!operationId) return { ok: false, reason: "invalid_cursor" };
  if (!Number.isSafeInteger(input.observedAt) || input.observedAt < 0) return { ok: false, reason: "invalid_cursor" };

  const records = readRecords(value);
  const current = Object.hasOwn(records, prRef) ? records[prRef] : undefined;
  const expected = input.expectedStoredCursor === null ? null : normalizePrSweepCursor(input.expectedStoredCursor);
  if (input.expectedStoredCursor !== null && !expected) return { ok: false, reason: "invalid_cursor" };
  if ((current?.cursor ?? null) !== expected) return { ok: false, reason: "cursor_conflict" };

  const record: PrSweepCursorRecord = { cursor, operationId, observedAt: input.observedAt };
  return { ok: true, records: { ...records, [prRef]: record }, record };
}
