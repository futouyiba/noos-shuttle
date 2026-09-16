# Continuation Eligibility Fixtures (v0)

Offline fixture set for the Continuation Eligibility experiment, per
`docs/deliberation-harness/continuation-eligibility-eval-plan-v0.md` (EXPERIMENT PLAN / NOT AUTHORITY).

Status: **REAL_FIXTURES_PENDING**. This directory currently contains format samples only.
The offline gate requires 40–50 reviewed REAL fixtures; by construction synthetic data can
never make the gate pass (`src/core/continuation-eligibility.ts` excludes synthetic records
from all gate metrics).

## Layout

- `samples/` — `SYNTHETIC_FORMAT_SAMPLE` records. They exercise the parser/runner/report
  pipeline only. The schema enforces `source_ref == "SYNTHETIC_FORMAT_SAMPLE"` for synthetic
  records and rejects the marker on REAL records.

## Fixture record schema

Mirrors `FixtureRecord` in `src/core/continuation-eligibility.ts`:

```text
fixture_id                      stable id
fixture_kind                    REAL | SYNTHETIC_FORMAT_SAMPLE
source_ref                      REAL: exact checkable conversation/turn provenance
source_revision?                exact revision/blob of the source when applicable
category                        CLEAR_CONTINUE | GOAL_SATISFIED | NEEDS_HUMAN | NEEDS_REVIEW |
                                NEEDS_EVIDENCE | NEEDS_EXTERNAL | OPTIONAL_EXTENSION |
                                SUBTLE_SCOPE_DRIFT | STALLED | AMBIGUOUS | NO_PLANNER_CREEP
envelope.goal / .scope          frozen run-local basis for this fixture
envelope.checkpoint? / .closure_frontier? / .current_focus?
envelope.assistant_turn         the completed assistant turn, preserved verbatim
envelope.previous_assessment?   at most one
expected_continue               true | false
expected_reason                 why the label holds
expected_anchor_need?           NONE | SOFT | REBASE_SUSPECTED
blocking_negative?              labeler override; defaults below
label_rationale
label_authority                 who reviewed and froze the label
```

## Provenance and labeling rules

- Preserve the source turn verbatim. Never rewrite it into cleaner synthetic prose.
- A human-followup `go` is positive-candidate evidence only, not automatic ground truth;
  a correction/redirect is negative-candidate evidence only. Every label needs a named
  `label_authority` before the fixture is frozen.
- Blocking-negative defaults: `GOAL_SATISFIED`, `NEEDS_HUMAN`, `NEEDS_REVIEW`,
  `NEEDS_EVIDENCE`, `NEEDS_EXTERNAL`. Mark clear out-of-scope drift and planner-trap
  evidence-waits explicitly with `blocking_negative: true`.
- Goal/Scope snapshots for legacy chats are frozen per fixture; the evaluator never
  mutates them.

## Offline gate (experiment gate, not a product SLA)

- at least 40 REAL fixtures (blocking-negative and clear-positive families both present);
- blocking negatives: 0 false-continue;
- all negatives: <= 5% false-continue;
- `CLEAR_CONTINUE` recall >= 80%;
- planner intrusions (hint present without `EXPLICIT`/`ENTAILED` basis): 0.

Run the report through `runEvaluation` from `src/core/continuation-eligibility.ts`;
`gate.outcome` is `NOT_EVALUABLE` until the fixture threshold and family minimums are met.
