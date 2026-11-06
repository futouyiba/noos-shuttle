import { describe, expect, it } from "vitest";
import {
  PR_SWEEP_CURSOR_ECHO_PREFIX,
  advancePrSweepCursor,
  parsePrSweepCursorEcho,
  prSweepReportsNoNewComments,
  readPrSweepCursorRecord
} from "../src/core/pr-sweep-cursor";

const PR = "futouyiba/noos-shuttle#61";

function observed(cursor: string, expectedStoredCursor: string | null = null, operationId = "sweep-1", observedAt = 1_000) {
  return advancePrSweepCursor({}, { prRef: PR, expectedStoredCursor, cursor, operationId, observedAt });
}

describe("parsePrSweepCursorEcho (issue #61 slice 5, Q8)", () => {
  it("reads the machine-readable echo line", () => {
    const reply = `已分类并列出。\n\n${PR_SWEEP_CURSOR_ECHO_PREFIX}c-42`;
    expect(parsePrSweepCursorEcho(reply)).toBe("c-42");
  });

  it("stays opaque: it neither parses nor orders the token", () => {
    const token = "boundary:2026-11-01T10:00:00Z|ids=1,2,3";
    expect(parsePrSweepCursorEcho(`${PR_SWEEP_CURSOR_ECHO_PREFIX}${token}`)).toBe(token);
  });

  it("tolerates markdown list markers, backticks and the placeholder brackets", () => {
    expect(parsePrSweepCursorEcho(`- \`${PR_SWEEP_CURSOR_ECHO_PREFIX}<c-7>\``)).toBe("c-7");
    expect(parsePrSweepCursorEcho(`1. ${PR_SWEEP_CURSOR_ECHO_PREFIX}\`c-8\``)).toBe("c-8");
  });

  it("rejects the payload's own placeholder so the instruction cannot advance the slot", () => {
    expect(parsePrSweepCursorEcho(`${PR_SWEEP_CURSOR_ECHO_PREFIX}<...>`)).toBeUndefined();
    expect(parsePrSweepCursorEcho(`${PR_SWEEP_CURSOR_ECHO_PREFIX}...`)).toBeUndefined();
    expect(parsePrSweepCursorEcho(`${PR_SWEEP_CURSOR_ECHO_PREFIX}   `)).toBeUndefined();
  });

  it("takes the last valid echo when a reply repeats the line", () => {
    expect(parsePrSweepCursorEcho(
      `${PR_SWEEP_CURSOR_ECHO_PREFIX}<...>\n${PR_SWEEP_CURSOR_ECHO_PREFIX}c-1\n${PR_SWEEP_CURSOR_ECHO_PREFIX}c-2`
    )).toBe("c-2");
  });

  it("recognizes the payload's explicit no-silence branch without treating it as a cursor", () => {
    expect(prSweepReportsNoNewComments("无新评论")).toBe(true);
    expect(prSweepReportsNoNewComments("No new comments.")).toBe(true);
    expect(prSweepReportsNoNewComments("已分类 3 条新评论")).toBe(false);
  });
});

describe("advancePrSweepCursor (Q7 single-writer compare-and-set)", () => {
  it("stores the first observed echo in a per-PR slot", () => {
    const result = observed("c-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toEqual({ cursor: "c-1", operationId: "sweep-1", observedAt: 1_000 });
    expect(readPrSweepCursorRecord(result.records, PR)?.cursor).toBe("c-1");
  });

  it("advances only when the stored slot still equals the pre-dispatch snapshot", () => {
    const first = observed("c-1");
    if (!first.ok) throw new Error("setup");
    const second = advancePrSweepCursor(first.records, {
      prRef: PR,
      expectedStoredCursor: "c-1",
      cursor: "c-2",
      operationId: "sweep-2",
      observedAt: 2_000
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(readPrSweepCursorRecord(second.records, PR)?.cursor).toBe("c-2");
  });

  it("refuses a stale writer instead of overwriting a newer watermark", () => {
    const first = observed("c-1");
    if (!first.ok) throw new Error("setup");
    const second = advancePrSweepCursor(first.records, {
      prRef: PR,
      expectedStoredCursor: "c-1",
      cursor: "c-2",
      operationId: "sweep-2",
      observedAt: 2_000
    });
    if (!second.ok) throw new Error("setup");
    const stale = advancePrSweepCursor(second.records, {
      prRef: PR,
      expectedStoredCursor: "c-1",
      cursor: "c-3",
      operationId: "sweep-stale",
      observedAt: 3_000
    });
    expect(stale).toEqual({ ok: false, reason: "cursor_conflict" });
    expect(readPrSweepCursorRecord(second.records, PR)?.cursor).toBe("c-2");
  });

  it("keeps PR refs in independent slots", () => {
    const first = observed("c-1");
    if (!first.ok) throw new Error("setup");
    const other = advancePrSweepCursor(first.records, {
      prRef: "futouyiba/noos-shuttle#99",
      expectedStoredCursor: null,
      cursor: "other-1",
      operationId: "sweep-other",
      observedAt: 2_000
    });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(readPrSweepCursorRecord(other.records, PR)?.cursor).toBe("c-1");
    expect(readPrSweepCursorRecord(other.records, "futouyiba/noos-shuttle#99")?.cursor).toBe("other-1");
  });

  it("refuses empty, multiline and over-long transport values", () => {
    expect(advancePrSweepCursor({}, { prRef: " ", expectedStoredCursor: null, cursor: "c", operationId: "o", observedAt: 1 }))
      .toEqual({ ok: false, reason: "invalid_pr_ref" });
    expect(advancePrSweepCursor({}, { prRef: PR, expectedStoredCursor: null, cursor: "a\nb", operationId: "o", observedAt: 1 }))
      .toEqual({ ok: false, reason: "invalid_cursor" });
    expect(advancePrSweepCursor({}, { prRef: PR, expectedStoredCursor: null, cursor: "x".repeat(513), operationId: "o", observedAt: 1 }))
      .toEqual({ ok: false, reason: "invalid_cursor" });
  });

  it("never treats wall-clock observedAt as the cursor or as a comparable ordering key", () => {
    const first = observed("c-1", null, "sweep-1", 9_999_999);
    if (!first.ok) throw new Error("setup");
    // A later timestamp with a stale snapshot still conflicts.
    const stale = advancePrSweepCursor(first.records, {
      prRef: PR,
      expectedStoredCursor: null,
      cursor: "c-2",
      operationId: "sweep-2",
      observedAt: 10_000_000
    });
    expect(stale).toEqual({ ok: false, reason: "cursor_conflict" });
  });

  it("ignores corrupted persisted records instead of resurrecting a slot", () => {
    expect(readPrSweepCursorRecord({ [PR]: { cursor: "", operationId: "x", observedAt: 1 } }, PR)).toBeUndefined();
    expect(readPrSweepCursorRecord({ [PR]: { cursor: "c", operationId: "", observedAt: 1 } }, PR)).toBeUndefined();
    expect(readPrSweepCursorRecord({ [PR]: { cursor: "c", operationId: "o", observedAt: -1 } }, PR)).toBeUndefined();
  });
});

describe("replay / concurrency judgement (Q8 evidence surface)", () => {
  it("lets exactly one of two concurrent advances from the same snapshot land", () => {
    const start = observed("c-1");
    if (!start.ok) throw new Error("setup");
    // Both writers dispatched after reading the same snapshot (c-1). The first
    // one to reach the coordinator advances; the second is applied to the state
    // the first produced, so its stale expectation conflicts.
    const writerA = advancePrSweepCursor(start.records, {
      prRef: PR,
      expectedStoredCursor: "c-1",
      cursor: "c-2",
      operationId: "sweep-a",
      observedAt: 2_000
    });
    if (!writerA.ok) throw new Error("setup");
    const writerB = advancePrSweepCursor(writerA.records, {
      prRef: PR,
      expectedStoredCursor: "c-1",
      cursor: "c-3",
      operationId: "sweep-b",
      observedAt: 2_001
    });

    expect(writerA.ok).toBe(true);
    expect(writerB).toEqual({ ok: false, reason: "cursor_conflict" });
    expect(readPrSweepCursorRecord(writerA.records, PR)?.cursor).toBe("c-2");
  });

  it("rejects a delayed replay of an older echo when its dispatch snapshot is stale", () => {
    // A sweep advanced the slot to c-10; a delayed writer that had read c-1
    // still carries an older echo (c-2). CAS refuses it instead of moving the
    // watermark backwards.
    const start = observed("c-1");
    if (!start.ok) throw new Error("setup");
    const advanced = advancePrSweepCursor(start.records, {
      prRef: PR,
      expectedStoredCursor: "c-1",
      cursor: "c-10",
      operationId: "sweep-new",
      observedAt: 2_000
    });
    if (!advanced.ok) throw new Error("setup");
    const replay = advancePrSweepCursor(advanced.records, {
      prRef: PR,
      expectedStoredCursor: "c-1",
      cursor: "c-2",
      operationId: "sweep-replayed",
      observedAt: 3_000
    });

    expect(replay).toEqual({ ok: false, reason: "cursor_conflict" });
    expect(readPrSweepCursorRecord(advanced.records, PR)?.cursor).toBe("c-10");
  });

  it("does not order opaque tokens: ordering cannot be a cursor property", () => {
    // Honest boundary: with the *current* snapshot a smaller token is accepted.
    // This is deliberate — the token has no frozen shape (Q8 did not settle
    // one). Rejecting an old/out-of-order echo is the reply-binding predicate's
    // job (`findPrSweepReply`); CAS only prevents stale writers from overwriting.
    const start = observed("c-10");
    if (!start.ok) throw new Error("setup");
    const smaller = advancePrSweepCursor(start.records, {
      prRef: PR,
      expectedStoredCursor: "c-10",
      cursor: "c-2",
      operationId: "sweep-opaque",
      observedAt: 2_000
    });

    expect(smaller.ok).toBe(true);
    if (!smaller.ok) return;
    expect(readPrSweepCursorRecord(smaller.records, PR)?.cursor).toBe("c-2");
  });

  it("does not create a second slot when the same PR echoes the same token again", () => {
    const first = observed("c-1");
    if (!first.ok) throw new Error("setup");
    const duplicate = advancePrSweepCursor(first.records, {
      prRef: PR,
      expectedStoredCursor: "c-1",
      cursor: "c-1",
      operationId: "sweep-duplicate",
      observedAt: 2_000
    });

    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok) return;
    expect(Object.keys(duplicate.records)).toEqual([PR]);
    expect(readPrSweepCursorRecord(duplicate.records, PR)).toEqual({
      cursor: "c-1",
      operationId: "sweep-duplicate",
      observedAt: 2_000
    });
  });
});
