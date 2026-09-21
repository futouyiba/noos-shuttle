import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_NEGATIVE_FALSE_CONTINUE_RATE,
  MIN_CLEAR_POSITIVE_RECALL,
  MIN_GATE_FIXTURES,
  SYNTHETIC_SOURCE_MARKER,
  decideContinuation,
  detectPlannerIntrusion,
  isBlockingNegative,
  parseAssessment,
  parseFixtureRecord,
  runEvaluation,
  type ContinuationAssessment,
  type FixtureCategory,
  type FixtureRecord,
} from "../src/core/continuation-eligibility";

function assessment(overrides: Partial<ContinuationAssessment> = {}): ContinuationAssessment {
  return {
    goal_status: "IN_PROGRESS",
    focus_status: "OPEN_ADVANCING",
    scope_relation: "WITHIN_SCOPE",
    dependency: "NONE",
    anchor_need: "NONE",
    confidence: "HIGH",
    ...overrides,
  };
}

function fixture(overrides: Partial<FixtureRecord> = {}): FixtureRecord {
  return {
    fixture_id: "f-1",
    fixture_kind: "REAL",
    source_ref: "real-chat@2026-09-01#turn-12",
    category: "CLEAR_CONTINUE",
    envelope: { goal: "g", scope: "s", assistant_turn: "a" },
    expected_continue: true,
    expected_reason: "focus open and advancing",
    label_rationale: "test rationale",
    label_authority: "test reviewer",
    ...overrides,
  };
}

function batch(positives: number, negatives: number): FixtureRecord[] {
  return [
    ...Array.from({ length: positives }, (_, i) => fixture({ fixture_id: `pos-${i}`, category: "CLEAR_CONTINUE", expected_continue: true })),
    ...Array.from({ length: negatives }, (_, i) => fixture({ fixture_id: `neg-${i}`, category: "GOAL_SATISFIED", expected_continue: false })),
  ];
}

function answers(records: readonly FixtureRecord[], overrides: Record<string, Partial<ContinuationAssessment>> = {}): Record<string, ContinuationAssessment> {
  return Object.fromEntries(records.map((f) => [
    f.fixture_id,
    assessment({ ...(f.expected_continue ? {} : { goal_status: "SATISFIED" as const }), ...overrides[f.fixture_id] }),
  ]));
}

describe("parseAssessment", () => {
  it("accepts a full assessment and preserves optional fields", () => {
    const parsed = parseAssessment({ goal_status: "IN_PROGRESS", focus_status: "REFINED", scope_relation: "WITHIN_SCOPE", dependency: "NONE", anchor_need: "SOFT", next_action_hint: "wire the fence", next_action_basis: "EXPLICIT", confidence: "HIGH" });
    expect(parsed).toEqual({ goal_status: "IN_PROGRESS", focus_status: "REFINED", scope_relation: "WITHIN_SCOPE", dependency: "NONE", anchor_need: "SOFT", next_action_hint: "wire the fence", next_action_basis: "EXPLICIT", confidence: "HIGH" });
  });

  it("rejects unknown enums and missing fields", () => {
    expect(() => parseAssessment({ ...assessment(), goal_status: "DONE" })).toThrow(/goal_status/);
    expect(() => parseAssessment({ ...assessment(), anchor_need: "HARD" })).toThrow(/anchor_need/);
    const { confidence, ...incomplete } = assessment();
    expect(() => parseAssessment(incomplete)).toThrow(/confidence/);
    expect(() => parseAssessment(null)).toThrow(/object required/);
  });
});

describe("parseFixtureRecord", () => {
  it("accepts a valid REAL record", () => {
    const record = parseFixtureRecord({ ...fixture(), source_revision: "abc123" });
    expect(record.fixture_kind).toBe("REAL");
    expect(record.source_revision).toBe("abc123");
    expect(record.blocking_negative).toBeUndefined();
  });

  it("enforces the synthetic marker discipline in both directions", () => {
    expect(() => parseFixtureRecord({ ...fixture(), fixture_kind: "REAL", source_ref: SYNTHETIC_SOURCE_MARKER })).toThrow(/exact source provenance/);
    expect(() => parseFixtureRecord({ ...fixture(), fixture_kind: "SYNTHETIC_FORMAT_SAMPLE", source_ref: "real-chat#12" })).toThrow(/SYNTHETIC_FORMAT_SAMPLE/);
    const synthetic = parseFixtureRecord({ ...fixture(), fixture_id: "s-1", fixture_kind: "SYNTHETIC_FORMAT_SAMPLE", source_ref: SYNTHETIC_SOURCE_MARKER });
    expect(synthetic.source_ref).toBe(SYNTHETIC_SOURCE_MARKER);
  });

  it("rejects missing envelope fields and bad optional types", () => {
    expect(() => parseFixtureRecord({ ...fixture(), envelope: { goal: "g", scope: "s" } })).toThrow(/assistant_turn/);
    expect(() => parseFixtureRecord({ ...fixture(), blocking_negative: "yes" })).toThrow(/blocking_negative/);
    expect(() => parseFixtureRecord({ ...fixture(), expected_continue: "true" })).toThrow(/expected_continue/);
  });

  it("parses nested previous_assessment and expected_anchor_need", () => {
    const record = parseFixtureRecord({ ...fixture(), expected_anchor_need: "REBASE_SUSPECTED", envelope: { goal: "g", scope: "s", assistant_turn: "a", previous_assessment: assessment() } });
    expect(record.expected_anchor_need).toBe("REBASE_SUSPECTED");
    expect(record.envelope.previous_assessment?.focus_status).toBe("OPEN_ADVANCING");
  });
});

describe("decideContinuation", () => {
  it("authorizes only the exact conservative conjunction", () => {
    expect(decideContinuation(assessment())).toBe("WOULD_CONTINUE");
    expect(decideContinuation(assessment({ focus_status: "REFINED" }))).toBe("WOULD_CONTINUE");
  });

  it("stops on every single-condition violation", () => {
    const stops: Partial<ContinuationAssessment>[] = [
      { goal_status: "SATISFIED" },
      { goal_status: "UNCERTAIN" },
      { focus_status: "SATISFIED" },
      { focus_status: "BLOCKED" },
      { focus_status: "STALLED_SUSPECTED" },
      { focus_status: "UNCERTAIN" },
      { scope_relation: "OPTIONAL_EXTENSION" },
      { scope_relation: "OUT_OF_SCOPE" },
      { scope_relation: "UNCERTAIN" },
      { dependency: "NEEDS_HUMAN" },
      { dependency: "NEEDS_REVIEW" },
      { dependency: "NEEDS_EVIDENCE" },
      { dependency: "NEEDS_EXTERNAL" },
      { dependency: "UNCERTAIN" },
      { confidence: "LOW" },
    ];
    for (const violation of stops) expect(decideContinuation(assessment(violation))).toBe("WOULD_STOP");
  });
});

describe("decideContinuation confidence gate (issue #85 ACCEPT)", () => {
  it("all four semantic fields green + MEDIUM => continue", () => {
    const allGreen = assessment({ confidence: "MEDIUM" });
    expect(decideContinuation(allGreen)).toBe("WOULD_CONTINUE");
  });

  it("all four semantic fields green + LOW => stop", () => {
    expect(decideContinuation(assessment({ confidence: "LOW" }))).toBe("WOULD_STOP");
  });

  it("MEDIUM + a semantic field at UNCERTAIN => stop, for each of the four", () => {
    const uncertainSemantics: Partial<ContinuationAssessment>[] = [
      { goal_status: "UNCERTAIN" },
      { focus_status: "UNCERTAIN" },
      { scope_relation: "UNCERTAIN" },
      { dependency: "UNCERTAIN" },
    ];
    for (const semantic of uncertainSemantics) {
      expect(decideContinuation(assessment({ ...semantic, confidence: "MEDIUM" }))).toBe("WOULD_STOP");
    }
  });

  it("MEDIUM + NEEDS_HUMAN => stop", () => {
    expect(decideContinuation(assessment({ dependency: "NEEDS_HUMAN", confidence: "MEDIUM" }))).toBe("WOULD_STOP");
  });
});

describe("continuation gate characterization over the assessment enum space (issue #85 delta 6)", () => {
  const GOALS = ["IN_PROGRESS", "SATISFIED", "UNCERTAIN"] as const;
  const FOCUSES = ["OPEN_ADVANCING", "SATISFIED", "REFINED", "BLOCKED", "STALLED_SUSPECTED", "UNCERTAIN"] as const;
  const SCOPES = ["WITHIN_SCOPE", "OPTIONAL_EXTENSION", "OUT_OF_SCOPE", "UNCERTAIN"] as const;
  const DEPENDENCIES = ["NONE", "NEEDS_HUMAN", "NEEDS_REVIEW", "NEEDS_EVIDENCE", "NEEDS_EXTERNAL", "UNCERTAIN"] as const;
  const CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;

  it("enumerates only values the real parser accepts, so this space is not a fiction", () => {
    for (const goal_status of GOALS) for (const focus_status of FOCUSES) for (const scope_relation of SCOPES) for (const dependency of DEPENDENCIES) for (const confidence of CONFIDENCES) {
      expect(() => parseAssessment({ goal_status, focus_status, scope_relation, dependency, anchor_need: "NONE", confidence })).not.toThrow();
    }
  });

  it("continues on exactly the four green semantic fields at HIGH or MEDIUM, and on nothing else", () => {
    const continuing = new Set<string>();
    let combinations = 0;
    for (const goal_status of GOALS) for (const focus_status of FOCUSES) for (const scope_relation of SCOPES) for (const dependency of DEPENDENCIES) for (const confidence of CONFIDENCES) {
      combinations += 1;
      const semanticGreen = goal_status === "IN_PROGRESS"
        && (focus_status === "OPEN_ADVANCING" || focus_status === "REFINED")
        && scope_relation === "WITHIN_SCOPE"
        && dependency === "NONE";
      const decision = decideContinuation({ goal_status, focus_status, scope_relation, dependency, anchor_need: "NONE", confidence });
      expect(decision).toBe(semanticGreen && confidence !== "LOW" ? "WOULD_CONTINUE" : "WOULD_STOP");
      if (decision === "WOULD_CONTINUE") continuing.add([goal_status, focus_status, scope_relation, dependency, confidence].join("/"));
    }
    expect(combinations).toBe(1296);
    // The whole widening surface, enumerated: adding MEDIUM to the confidence
    // conjunct can never make a semantic field pass, so these four readings are
    // the complete set of continues. Every one of the other 1292 stops.
    expect([...continuing].sort()).toEqual([
      "IN_PROGRESS/OPEN_ADVANCING/WITHIN_SCOPE/NONE/HIGH",
      "IN_PROGRESS/OPEN_ADVANCING/WITHIN_SCOPE/NONE/MEDIUM",
      "IN_PROGRESS/REFINED/WITHIN_SCOPE/NONE/HIGH",
      "IN_PROGRESS/REFINED/WITHIN_SCOPE/NONE/MEDIUM",
    ]);
  });

  it("cannot continue any blocking-negative family at any confidence, MEDIUM included", () => {
    // Each blocking-negative category is defined by a semantic violation, and the
    // confidence axis is orthogonal to all of them: this is why widening the
    // confidence conjunct cannot produce a false-continue on a correctly labeled
    // blocking negative.
    const blockingShapes: Array<{ category: FixtureCategory; semantics: Partial<ContinuationAssessment> }> = [
      { category: "GOAL_SATISFIED", semantics: { goal_status: "SATISFIED" } },
      { category: "NEEDS_HUMAN", semantics: { dependency: "NEEDS_HUMAN" } },
      { category: "NEEDS_REVIEW", semantics: { dependency: "NEEDS_REVIEW" } },
      { category: "NEEDS_EVIDENCE", semantics: { dependency: "NEEDS_EVIDENCE" } },
      { category: "NEEDS_EXTERNAL", semantics: { dependency: "NEEDS_EXTERNAL" } },
    ];
    for (const shape of blockingShapes) {
      expect(isBlockingNegative(fixture({ category: shape.category }))).toBe(true);
      for (const confidence of CONFIDENCES) {
        expect(decideContinuation(assessment({ ...shape.semantics, confidence }))).toBe("WOULD_STOP");
      }
    }
  });

  it("keeps the offline gate at zero blocking-negative false-continue when every assessment is MEDIUM", () => {
    // The strongest gate evidence available in this repo state: a batch at the
    // gate threshold whose positives are green MEDIUM — the newly accepted level,
    // and 35/35 would have been false-stopped by the old rule — and whose blocking
    // negatives carry their defining violation at MEDIUM too.
    const records = [
      ...Array.from({ length: 35 }, (_, i) => fixture({ fixture_id: `pos-${i}`, category: "CLEAR_CONTINUE", expected_continue: true })),
      ...Array.from({ length: 5 }, (_, i) => fixture({ fixture_id: `block-${i}`, category: "NEEDS_HUMAN", expected_continue: false })),
    ];
    const assessments: Record<string, ContinuationAssessment> = Object.fromEntries([
      ...Array.from({ length: 35 }, (_, i) => [`pos-${i}`, assessment({ confidence: "MEDIUM" })] as const),
      ...Array.from({ length: 5 }, (_, i) => [`block-${i}`, assessment({ dependency: "NEEDS_HUMAN" as const, confidence: "MEDIUM" })] as const),
    ]);
    const report = runEvaluation(records, assessments, { minGateFixtures: 40 });
    expect(report.gate.outcome).toBe("PASS");
    expect(report.gate.violations).toEqual([]);
    expect(report.overall.blocking_negative_false_continue).toBe(0);
    expect(report.overall.negative_false_continue).toBe(0);
    expect(report.overall.negative_false_continue_rate).toBe(0);
    expect(report.overall.clear_positive_recall).toBe(1);
  });
});

describe("detectPlannerIntrusion", () => {
  it("accepts extractive hints with an explicit or entailed basis", () => {
    expect(detectPlannerIntrusion({ ...assessment(), next_action_hint: "wait for CI", next_action_basis: "EXPLICIT" })).toBe(false);
    expect(detectPlannerIntrusion({ ...assessment(), next_action_hint: "re-run the failing check", next_action_basis: "ENTAILED" })).toBe(false);
  });

  it("flags hints without a basis and hint/basis NONE", () => {
    expect(detectPlannerIntrusion({ ...assessment(), next_action_hint: "design a fuzz harness" })).toBe(true);
    expect(detectPlannerIntrusion({ ...assessment(), next_action_hint: "design a fuzz harness", next_action_basis: "NONE" })).toBe(true);
  });

  it("does not flag an assessment without a hint", () => {
    expect(detectPlannerIntrusion(assessment())).toBe(false);
    expect(detectPlannerIntrusion({ ...assessment(), next_action_basis: "EXPLICIT" })).toBe(false);
  });
});

describe("isBlockingNegative", () => {
  it("defaults to the blocking category set and honors the labeler override", () => {
    for (const category of ["GOAL_SATISFIED", "NEEDS_HUMAN", "NEEDS_REVIEW", "NEEDS_EVIDENCE", "NEEDS_EXTERNAL"] as const) {
      expect(isBlockingNegative(fixture({ category }))).toBe(true);
    }
    expect(isBlockingNegative(fixture({ category: "SUBTLE_SCOPE_DRIFT" }))).toBe(false);
    expect(isBlockingNegative(fixture({ category: "SUBTLE_SCOPE_DRIFT", blocking_negative: true }))).toBe(true);
    expect(isBlockingNegative(fixture({ category: "GOAL_SATISFIED", blocking_negative: false }))).toBe(false);
  });
});

describe("runEvaluation", () => {
  const smallGate = { minGateFixtures: 20 };

  it("is NOT_EVALUABLE below the fixture threshold and reports REAL_FIXTURES_PENDING", () => {
    const report = runEvaluation(batch(3, 2), answers(batch(3, 2)));
    expect(report.gate.outcome).toBe("NOT_EVALUABLE");
    expect(report.real_fixtures_pending).toBe(true);
    expect(report.gate.notes.join(" ")).toMatch(/REAL_FIXTURES_PENDING/);
    expect(MIN_GATE_FIXTURES).toBe(40);
  });

  it("excludes synthetic samples from gate metrics entirely", () => {
    const synthetic = [1, 2, 3, 4].map((i) => fixture({ fixture_id: `s-${i}`, fixture_kind: "SYNTHETIC_FORMAT_SAMPLE", source_ref: SYNTHETIC_SOURCE_MARKER, expected_continue: false }));
    const report = runEvaluation(synthetic, {});
    expect(report.fixture_count).toBe(4);
    expect(report.real_fixture_count).toBe(0);
    expect(report.synthetic_sample_count).toBe(4);
    expect(report.matched_count).toBe(0);
    expect(report.gate.outcome).toBe("NOT_EVALUABLE");
    expect(report.gate.violations).toEqual([]);
  });

  it("passes when blocking negatives hold, rates are within bounds, and no intrusion occurs", () => {
    const records = batch(15, 5);
    const report = runEvaluation(records, answers(records), smallGate);
    expect(report.gate.outcome).toBe("PASS");
    expect(report.gate.violations).toEqual([]);
    expect(report.matched_count).toBe(20);
    expect(report.mismatches).toEqual([]);
  });

  it("fails on a single blocking-negative false continue", () => {
    const records = batch(15, 5);
    const report = runEvaluation(records, answers(records, { "neg-4": { goal_status: "IN_PROGRESS" } }), smallGate);
    expect(report.gate.outcome).toBe("FAIL");
    expect(report.gate.violations.join(" ")).toMatch(/blocking_negative_false_continue=1/);
  });

  it("treats exactly 5% non-blocking negative false-continue as within bounds and 10% as a violation", () => {
    const mixed = [
      ...Array.from({ length: 15 }, (_, i) => fixture({ fixture_id: `pos-${i}`, category: "CLEAR_CONTINUE", expected_continue: true })),
      ...Array.from({ length: 5 }, (_, i) => fixture({ fixture_id: `block-${i}`, category: "NEEDS_HUMAN", expected_continue: false })),
      ...Array.from({ length: 15 }, (_, i) => fixture({ fixture_id: `soft-${i}`, category: "SUBTLE_SCOPE_DRIFT", expected_continue: false })),
    ];
    const at = (n: number) => Object.fromEntries([
      ...Array.from({ length: 15 }, (_, i) => [`pos-${i}`, assessment()] as const),
      ...Array.from({ length: 5 }, (_, i) => [`block-${i}`, assessment({ dependency: "NEEDS_HUMAN" })] as const),
      ...Array.from({ length: 15 }, (_, i) => [`soft-${i}`, assessment({ scope_relation: "UNCERTAIN" })] as const),
      ...Array.from({ length: n }, (_, i) => [`soft-${i}`, assessment()] as const),
    ]);
    const boundary = runEvaluation(mixed, at(1), { minGateFixtures: 35 });
    expect(boundary.overall.negative_false_continue_rate).toBeCloseTo(MAX_NEGATIVE_FALSE_CONTINUE_RATE);
    expect(boundary.gate.outcome).toBe("PASS");
    const over = runEvaluation(mixed, at(2), { minGateFixtures: 35 });
    expect(over.gate.outcome).toBe("FAIL");
    expect(over.gate.violations.join(" ")).toMatch(/negative_false_continue_rate=0.1/);
  });

  it("fails below the 80% clear-positive recall", () => {
    // Two clear positives must stop to land on 3/5. `pos-0` uses a semantic
    // violation rather than MEDIUM confidence, because MEDIUM no longer stops on
    // an otherwise green assessment (issue #85 ACCEPT); `pos-1` pins that LOW still does.
    const records = batch(5, 5);
    const report = runEvaluation(records, answers(records, { "pos-0": { dependency: "NEEDS_EVIDENCE" }, "pos-1": { confidence: "LOW" } }), { minGateFixtures: 10 });
    expect(report.overall.clear_positive_recall).toBeLessThan(MIN_CLEAR_POSITIVE_RECALL);
    expect(report.gate.outcome).toBe("FAIL");
    expect(report.gate.violations.join(" ")).toMatch(/clear_positive_recall=0.6/);
  });

  it("fails on planner intrusion even when the decision is correct", () => {
    const records = batch(15, 5);
    const report = runEvaluation(records, answers(records, { "pos-0": { next_action_hint: "run a new experiment", next_action_basis: "NONE" } }), smallGate);
    expect(report.gate.outcome).toBe("FAIL");
    expect(report.gate.violations.join(" ")).toMatch(/planner_intrusions=1/);
    expect(report.mismatches[0]?.planner_intrusion).toBe(true);
  });

  it("lists missing and unmatched assessments", () => {
    const records = batch(2, 2);
    const report = runEvaluation(records, { "pos-0": assessment(), "ghost-1": assessment() });
    expect(report.missing_assessments).toEqual(["pos-1", "neg-0", "neg-1"]);
    expect(report.unmatched_assessments).toEqual(["ghost-1"]);
    expect(report.matched_count).toBe(1);
    expect(report.gate.outcome).toBe("NOT_EVALUABLE");
  });

  it("reports anchor mismatches without treating them as gate violations", () => {
    const records = batch(1, 0).map((f) => ({ ...f, expected_anchor_need: "SOFT" as const }));
    const report = runEvaluation(records, { "pos-0": assessment({ anchor_need: "NONE" }) }, smallGate);
    expect(report.gate.outcome).toBe("NOT_EVALUABLE");
    expect(report.mismatches).toEqual([]);
    expect(report.matched_count).toBe(1);
  });
});

describe("bundled format samples", () => {
  const samplesDir = new URL("../fixtures/continuation-eligibility/samples/", import.meta.url);

  function loadSamples(): FixtureRecord[] {
    return readdirSync(samplesDir).sort().map((name) => parseFixtureRecord(JSON.parse(readFileSync(new URL(name, samplesDir), "utf8")), name));
  }

  it("parses every bundled sample and keeps the synthetic marker", () => {
    const samples = loadSamples();
    expect(samples.length).toBeGreaterThanOrEqual(4);
    for (const sample of samples) {
      expect(sample.fixture_kind).toBe("SYNTHETIC_FORMAT_SAMPLE");
      expect(sample.source_ref).toBe(SYNTHETIC_SOURCE_MARKER);
      expect(sample.label_authority).toMatch(/UNASSIGNED/);
      expect(() => decideContinuation(assessment())).not.toThrow();
    }
  });

  it("never lets samples satisfy the gate", () => {
    const report = runEvaluation(loadSamples(), {});
    expect(report.gate.outcome).toBe("NOT_EVALUABLE");
    expect(report.real_fixtures_pending).toBe(true);
    expect(report.gate.violations).toEqual([]);
  });

  it("keeps planner-trap semantics checkable on the trap sample", () => {
    const trap = loadSamples().find((s) => s.category === "NO_PLANNER_CREEP");
    expect(trap).toBeDefined();
    expect(isBlockingNegative(trap!)).toBe(true);
    expect(trap!.expected_continue).toBe(false);
  });
});
