import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTINUATION_PAYLOADS,
  buildContinuationPayload,
  claimedPayload,
  continuationPayloadDefinition,
  recordDispatchedPayload
} from "../src/core/continuation-payload";
import { createFixtureCandidate, emptyContinuationRunStore, reduceContinuationRunStore, startContinuationRun } from "../src/core/continuation-run";
import { fingerprintSubmissionPayload } from "../src/core/submission-operation";

describe("canonical continuation payload registry", () => {
  it("pins the provider-facing literal for each locale", () => {
    expect(continuationPayloadDefinition("zh").continuationToken).toBe("继续");
    expect(continuationPayloadDefinition("en").continuationToken).toBe("go on");
  });

  it("keeps a plain round to the bare token for its locale", () => {
    expect(buildContinuationPayload("zh", "PLAIN_GO")).toBe("继续");
    expect(buildContinuationPayload("en", "PLAIN_GO")).toBe("go on");
  });

  it("does not rename the internal identities the ledger and evaluator share", () => {
    // The literal varies; the operation kind and continuation modes must not.
    expect(CONTINUATION_PAYLOADS.zh.continuationToken).not.toBe("GO");
    expect(buildContinuationPayload("en", "PLAIN_GO")).not.toBe("go");
  });

  describe("re-anchor parity", () => {
    const zh = buildContinuationPayload("zh", "REANCHOR_GO", "冻结的目标");
    const en = buildContinuationPayload("en", "REANCHOR_GO", "frozen goal");

    it("opens with the locale token and wraps in the same sentinels", () => {
      expect(zh.split("\n")[0]).toBe("继续");
      expect(en.split("\n")[0]).toBe("go on");
      for (const payload of [zh, en]) {
        expect(payload).toContain("[NOOS Re-anchor]");
        expect(payload.trimEnd().endsWith("[/NOOS Re-anchor]")).toBe(true);
      }
    });

    it("has the same structure in both locales — wording differs, contract does not", () => {
      const zhLines = zh.split("\n");
      const enLines = en.split("\n");
      expect(zhLines).toHaveLength(6);
      expect(enLines).toHaveLength(6);
      // Only the token line and the instruction line may differ in wording;
      // the sentinels, the goal label and the slot layout are shared.
      expect(zhLines[0]).toBe("继续");
      expect(enLines[0]).toBe("go on");
      expect(zhLines.slice(2, 3)).toEqual(enLines.slice(2, 3));
      expect(zhLines[3].split(":")[0]).toBe(enLines[3].split(":")[0]);
      expect(zhLines[5]).toBe(enLines[5]);
      expect(zhLines[4]).not.toBe("");
      expect(enLines[4]).not.toBe("");
      expect(zh).toContain("冻结的目标");
      expect(en).toContain("frozen goal");
    });

    it("falls back to the locale's own goal text only when the run carries none", () => {
      expect(buildContinuationPayload("zh", "REANCHOR_GO", "   ")).toContain(CONTINUATION_PAYLOADS.zh.defaultGoal);
      expect(buildContinuationPayload("en", "REANCHOR_GO")).toContain(CONTINUATION_PAYLOADS.en.defaultGoal);
      expect(buildContinuationPayload("zh", "REANCHOR_GO", "显式目标")).toContain("显式目标");
      expect(buildContinuationPayload("zh", "REANCHOR_GO", "显式目标")).not.toContain(CONTINUATION_PAYLOADS.zh.defaultGoal);
    });
  });

  describe("fingerprint matching", () => {
    it("fingerprints each variant distinctly, so acceptance cannot be satisfied cross-locale", () => {
      const zh = buildContinuationPayload("zh", "PLAIN_GO");
      const en = buildContinuationPayload("en", "PLAIN_GO");
      expect(fingerprintSubmissionPayload(zh)).not.toBe(fingerprintSubmissionPayload(en));
      // The ledger matches the exact dispatched bytes: the other locale's
      // payload must never prove acceptance for this round.
      expect(fingerprintSubmissionPayload(zh)).toBe(fingerprintSubmissionPayload("继续"));
      expect(fingerprintSubmissionPayload(en)).not.toBe(fingerprintSubmissionPayload("继续"));
    });

    it("distinguishes a plain round from a re-anchored one", () => {
      expect(fingerprintSubmissionPayload(buildContinuationPayload("en", "PLAIN_GO")))
        .not.toBe(fingerprintSubmissionPayload(buildContinuationPayload("en", "REANCHOR_GO", "g")));
    });
  });

  it("is the only production site that defines the continuation literal", () => {
    const registry = "src/core/continuation-payload.ts";
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    // fileURLToPath, not .pathname: this repo path contains spaces.
    walk(fileURLToPath(new URL("../src", import.meta.url)));
    expect(files.length).toBeGreaterThan(20);

    // Standalone quoted literals only — `继续` also occurs inside unrelated
    // Chinese sentences, and the disposition explicitly does not require
    // repository-wide string uniqueness.
    const hits: string[] = [];
    for (const file of files) {
      const relative = file.replace(/^.*\/src\//, "src/");
      if (relative === registry) continue;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (/"继续"|"go on"/.test(line)) hits.push(`${relative}: ${line.trim()}`);
      }
    }
    // The panel's own button label is a different surface and stays in COPY;
    // any other standalone occurrence means a second payload definition site.
    expect(hits).toEqual(['src/shared/i18n.ts: bcrContinue: "继续",']);

    // The dispatch path must take its payload from the registry, not a literal.
    const index = readFileSync(new URL("../src/content/index.ts", import.meta.url), "utf8");
    expect(index).toContain('buildContinuationPayload(payloadLocale, payloadMode, bcrRun.goal)');
    expect(index).toContain("await dispatchHumanGo(payload, getPageContext()");
    expect(index).not.toContain('return "go";');
  });
});

describe("round evidence records the dispatched variant", () => {
  function activeRun() {
    const started = startContinuationRun({
      runId: "bcr-60",
      workItemId: "shuttle-bcr-run",
      logicalThreadId: "thread:conv-a",
      providerConversationRef: "conv-a",
      bindingEpoch: 3,
      maxContinuations: 5,
      mode: "AUTO_X5",
      now: 100
    });
    return started;
  }

  it("carries payload locale, mode and exact text onto the candidate", () => {
    const store = { ...emptyContinuationRunStore(), activeByConversation: { "conv-a": activeRun() } };
    const text = buildContinuationPayload("en", "PLAIN_GO");
    const result = reduceContinuationRunStore(store, {
      type: "record_round_evidence",
      runId: "bcr-60",
      continuationIndex: 1,
      decision: "AUTO_CONTINUE",
      humanAction: "pending",
      continuationMode: "PLAIN_GO",
      payloadLocale: "en",
      payloadMode: "PLAIN_GO",
      payloadText: text,
      capturedAt: 200
    });
    expect(result.ok).toBe(true);
    const candidate = result.ok ? result.store.candidates[0] : undefined;
    expect(candidate?.payloadLocale).toBe("en");
    expect(candidate?.payloadMode).toBe("PLAIN_GO");
    expect(candidate?.payloadText).toBe("go on");
  });

  it("never claims a payload for a blocked first round", () => {
    // Nothing reached the provider, and the first round's candidate index is
    // clamped to 1 — the same number `round` carries — so a later Stop used to
    // attach a payload that was never sent.
    const blocked = recordDispatchedPayload("BLOCKED", 1, "zh", "PLAIN_GO", buildContinuationPayload("zh", "PLAIN_GO"));
    expect(blocked).toBeNull();
    expect(claimedPayload(blocked, 1)).toBeNull();
    // UNCERTAIN did hand the payload to the dispatcher, so it may have gone out.
    const uncertain = recordDispatchedPayload("UNCERTAIN", 1, "zh", "PLAIN_GO", buildContinuationPayload("zh", "PLAIN_GO"));
    expect(claimedPayload(uncertain, 1)?.text).toBe("继续");
    // Later rounds never collided; keep that pinned.
    const laterBlocked = recordDispatchedPayload("BLOCKED", 3, "en", "PLAIN_GO", buildContinuationPayload("en", "PLAIN_GO"));
    expect(claimedPayload(laterBlocked, 2)).toBeNull();
  });

  it("omits the payload claim when the round dispatched nothing", () => {
    const store = { ...emptyContinuationRunStore(), activeByConversation: { "conv-a": activeRun() } };
    const result = reduceContinuationRunStore(store, {
      type: "record_round_evidence",
      runId: "bcr-60",
      continuationIndex: 1,
      decision: "HUMAN_STOP",
      humanAction: "stopped",
      capturedAt: 200
    });
    const candidate = result.ok ? result.store.candidates[0] : undefined;
    expect(candidate?.payloadText).toBeUndefined();
    expect(candidate?.payloadLocale).toBeUndefined();
  });

  it("keeps a pre-#60 candidate readable when the new fields are absent", () => {
    const candidate = createFixtureCandidate(activeRun(), {
      continuationIndex: 2,
      decision: "AUTO_STOP",
      humanAction: "pending",
      capturedAt: 300
    });
    expect(candidate.continuationIndex).toBe(2);
    expect(candidate.payloadText).toBeUndefined();
  });
});
