# Bounded Continuation Run — Evidence Readiness Report (v0)

> Point-in-time evidence report for the step after the BCR Working Candidate. Working paper, not a contract; it does not promote `bounded-continuation-run-v0-working-candidate.md` to V1 authority and does not modify `v1-primary-design-current.md`.

## 1. Inputs (exact refs)

| Input | Ref |
| --- | --- |
| Repository | `futouyiba/noos-shuttle`, base `main` @ `aff73f7d3d2a36896724054adf513b5c5718d2fe` (2026-09-16 state) |
| V1 authority | `futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1`; V1 phase `READY_FOR_BOUNDED_V1_IMPLEMENTATION_EXPERIMENT`, implementation-led learning |
| BCR working candidate | branch `design/bounded-continuation-run-v0-candidate`; `bounded-continuation-run-v0-working-candidate.md` first sedimented @ `c6f2067304cc9431642122d025f9073c0b14bed1`, branch tip `1f03a8072dbf6e89724547265e59207955fda266` (eval plan) — `WORKING DESIGN CANDIDATE / EXPERIMENT PLAN`, NOT V1 authority |
| Gate issue | `futouyiba/noos-shuttle#5` — `[NOOS Harness V1] Slice 1 — Human GO and durable submission reconciliation`, state OPEN at inventory time |

## 2. SLICE_1_STATUS: `implemented` (with residuals)

Human GO and the durable submission ledger are implemented and merged on `main`; the direct runtime prerequisites of the BCR continuation-eligibility step are satisfied at contract/test level.

Durable evidence:

- `src/core/submission-operation.ts`, `src/core/human-go-runtime.ts` on `main` (transport-only `SubmissionOperation` ledger: persist-before-actuate, atomic one-blind-dispatch claim, duplicate-GO prevention, `UNCERTAIN` fail-closed reconciliation, restart/authority-rotation recovery, payload-fingerprint assistant-turn correlation). Merged via `59ad928` "Merge codex/child-lifecycle-next: NOOS Deliberation Harness V1 implementation"; lineage includes `codex/issue-5-slice-1` @ `1ceb401`.
- Focused suites `tests/submission-operation.test.ts` (47) and `tests/human-go-runtime.test.ts` (8) — 55/55 green at base `aff73f7`; full release-parity suite 32 files / 403 tests green.
- Real wiring: the ChatGPT content adapter routes generate/handoff/crystal actions through `HumanGoRuntime` → background coordinator → Chrome storage under the `noos-submission-operation-authority` `navigator.locks` lock; report `docs/deliberation-harness/implementation-slice-1-submission-ledger-report.md` on `main` (authority/verdict header added by this change).
- No BCR leakage on `main`: no `ContinuationRun`, no automated continuation, no Go×N actuation anywhere in `src/`, `tests/`, or the Hub app; Issue #5's non-goal "No automated continuation" is respected.

Residuals:

1. Issue #5 is still OPEN. Its deliverable asked for the Slice 1 report to carry exact authority refs and a verdict — both were missing; the header is added by this change. Closing the issue is an owner decision and additionally warrants one real end-to-end dogfood round (below).
2. Process deviation on record: PR #6 ("Issue #5 Slice 1: durable submission operation ledger", head `codex/issue-5-slice-1-ledger` @ `d4cb00f`) was closed unmerged and superseded by the direct integration merge `59ad928` of a different branch. The code on `main` does not descend from the reviewed PR #6 head. Recorded, not reopened retroactively.
3. Live provider evidence is not yet deposited in-repo: Hub Dogfood Console v0 (`2e37cac`) renders a fixture snapshot because "the Hub has no harness data source yet"; the first real dogfood round it was built for has not produced durable evidence files yet.

## 3. Prerequisites for the continuation-eligibility step

Eval-plan §11 runtime/provider gate, mapped to evidence:

| # | Requirement | Status |
| --- | --- | --- |
| 1 | Stable READY/GENERATING/STABILIZING observation | Satisfied (Slice 0 + Slice 1 suites; observation lifecycle in ledger tests) |
| 2 | Durable SubmissionOperation behavior | Satisfied (ledger, 47 tests) |
| 3 | Conservative uncertain-submission reconciliation | Satisfied (fail-closed `UNCERTAIN` semantics, tests) |
| 4 | Accepted-submission → stable Assistant-turn correlation | Satisfied at contract/test level (payload fingerprint stamping, concurrent-human-message discrimination, monotonic evidence) |
| 5 | Reload/reattach duplicate-dispatch avoidance | Satisfied at contract/test level (authority rotation, cross-context claims) |
| 6 | Human vs Harness provenance distinction | Not needed for offline fixtures; required before Shadow Mode interpretation and any actuation |
| — | Live end-to-end dogfood correlation evidence | Pending (residual 3); defers Shadow Mode, not the offline stage |

## 4. Path selected: B (offline continuation-eligibility evidence)

Slice 1's direct prerequisites are durable, so the task's Branch B applies: build the offline fixture harness and stop there. No `Go ×N`, no `ContinuationRun`, no actuation, no Shadow Mode was implemented. Branch A residuals were limited to the report header fix (scope-matched, docs-only).

## 5. Work performed

- `src/core/continuation-eligibility.ts` — offline evaluation harness, computation only (no runtime authority, no dispatch, no `ThreadControl`/`SubmissionOperation` mutation):
  - schema with strict validation: `EvaluationEnvelope`, `ContinuationAssessment` (exact eval-plan enums), `FixtureRecord` with synthetic-marker discipline (`REAL` records must carry exact provenance; `SYNTHETIC_FORMAT_SAMPLE` records must carry the marker and are excluded from every gate metric);
  - conservative authorization policy `decideContinuation` (eval-plan §4 conjunction; anything `UNCERTAIN`/`MEDIUM`/`LOW` stops) and `detectPlannerIntrusion` (hint without `EXPLICIT`/`ENTAILED` basis is an intrusion);
  - runner + report: False Continue Rate, False Stop Rate, Planner Intrusion Rate, per-family metrics, mismatch list, gate evaluation (≥40 REAL fixtures; 0 blocking-negative false-continue; ≤5% negative false-continue; ≥80% clear-positive recall; 0 planner intrusions). `NOT_EVALUABLE` by construction until thresholds and both family minimums are met. Thresholds are the eval-plan Experiment Gate, not a product SLA.
- `fixtures/continuation-eligibility/` — `README.md` (schema, provenance/labeling rules, gate) plus four `SYNTHETIC_FORMAT_SAMPLE` records (no-explicit-next-action positive, completed-with-optional-future-work, open human choice, evidence-insufficient planner trap). They validate the pipeline shape only; they are not conversation evidence and can never satisfy the gate.
- `tests/continuation-eligibility.test.ts` — 24 tests: schema rejection paths, decision truth table (every single-condition violation stops), planner-intrusion semantics, gate PASS/FAIL including the exact 5% boundary, missing/unmatched assessments, and bundled-sample invariants ("samples never satisfy the gate").
- `docs/deliberation-harness/implementation-slice-1-submission-ledger-report.md` — authority refs + verdict header added (Issue #5 deliverable residual).

## 6. Evidence and limits

- Verification: `npm run typecheck` clean; `npx vitest run tests/continuation-eligibility.test.ts` 24/24; full release-parity suite (`npm test -- --exclude tests/content-ui-smoke.test.ts`) 32 files / 403 tests green.
- **REAL_FIXTURES_PENDING.** No real NOOS/FCF conversation endings exist in this repository, and none were fabricated. The evaluator itself (an LLM classifier over real fixtures) is not implemented or run here; this change delivers the auditable harness the eval plan requires before that run. Any first gate report must cite exact fixture provenance and label authority.

## 7. Mismatches found

- PR #6 closed unmerged while its scope landed via a different, directly merged branch (`59ad928`): the review-before-merge trail for the exact merged Slice 1 head is not a PR record. Flagged for the workflow; no code action.
- Slice 1 report lacked the issue-required authority refs/verdict: fixed by this change.
- Hub currently has no live harness data source (Dogfood Console is fixture-fed): noted as the live-evidence gap, not a defect.

## 8. Primary Design assumptions: none falsified

No implementation evidence contradicted the BCR candidate's reuse seams, the pure-`go` continuation payload hypothesis, the evaluator boundary, or the Closure Frontier model. They remain untested until real fixtures and shadow evidence exist; nothing in this inventory triggered a `NEEDS_DESIGN` escalation condition.

## 9. Recommended next actions

1. Curate 40–50 REAL fixtures from real NOOS/FCF long-conversation endings (exact source refs, named label authority, adversarial families per eval-plan §7), then run the evaluator classifications through `runEvaluation` for the first gate report.
2. In parallel, run the first real Human-GO dogfood round (Slice 1 residual 3) to produce the accepted-submission → stable-turn correlation evidence that Shadow Mode interpretation requires.
3. Only after an offline gate PASS and that correlation evidence: Live Shadow Mode (evaluate, record, never actuate).
4. Do not implement `Go ×5` actuation in this phase; BCR stays a Working Candidate until evidence says otherwise.
