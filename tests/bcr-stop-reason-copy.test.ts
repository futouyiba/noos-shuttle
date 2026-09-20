import { describe, expect, it } from "vitest";
import { CONTINUATION_STOP_REASONS, bcrStopReasonLabel } from "../src/core/bcr-stop-reason-copy";
import { COPY } from "../src/shared/i18n";

describe("bcrStopReasonLabel", () => {
  // The reason a run ended is shown to the Human verbatim in the panel. The
  // evaluator used to fold every unnamed blocking term into WAIT_HUMAN, so these
  // four read identically there; the vocabulary is now split and each member has
  // its own sentence. `STOP_REASON_COPY_KEYS` is a Record over the union, so a
  // new reason without copy fails `npm run typecheck` before it reaches the UI.
  it("gives every stop reason a sentence in both locales", () => {
    expect(CONTINUATION_STOP_REASONS.length).toBeGreaterThan(0);
    for (const reason of CONTINUATION_STOP_REASONS) {
      for (const copy of Object.values(COPY)) {
        const label = bcrStopReasonLabel(reason, copy);
        expect(label, reason).not.toBe(reason);
        expect(label.trim(), reason).not.toBe("");
      }
    }
  });

  it("keeps every reason distinguishable from every other", () => {
    for (const copy of Object.values(COPY)) {
      const labels = CONTINUATION_STOP_REASONS.map(reason => bcrStopReasonLabel(reason, copy));
      expect(new Set(labels).size, JSON.stringify(labels)).toBe(labels.length);
    }
  });

  it("separates the three causes that used to all read as WAIT_HUMAN", () => {
    for (const copy of Object.values(COPY)) {
      const [waited, uncertain, confidence, noExcerpt] = ["WAIT_HUMAN", "ASSESSMENT_UNCERTAIN", "CONFIDENCE_BELOW_HIGH", "EXCERPT_UNAVAILABLE"]
        .map(reason => bcrStopReasonLabel(reason, copy));
      expect(new Set([waited, uncertain, confidence, noExcerpt]).size).toBe(4);
    }
  });

  it("reads an unknown reason as itself instead of guessing", () => {
    // A store written by another build can carry a reason this one does not know.
    for (const copy of Object.values(COPY)) {
      expect(bcrStopReasonLabel("SOMETHING_NEW", copy)).toBe("SOMETHING_NEW");
    }
  });
});
