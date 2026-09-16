# BCR AUTO ×5 — DeepSeek Evaluator Report (v0)

> Working report for the AUTO_X5 Experimental mode. Not a contract; does not modify the BCR Working Candidate (`design/bounded-continuation-run-v0-candidate`) or V1 authority. Companions: `bcr-minimum-usable-loop-report.md` (ASSISTED loop, merged `c7d8094`), `continuation-eligibility-eval-plan-v0.md` (experiment plan).

## 1. What this change adds

The ASSISTED loop required a Human decision every round. This change adds the missing semantic evaluator behind the already-merged conservative gate, so a Go ×5 run can advance automatically:

```text
Human starts Go ×5 with a run goal (AUTO badge)
→ GO via SubmissionOperation → stable Assistant Turn (Slice 1, unchanged)
→ background calls DeepSeek chat-completions in isolation
   (EvaluationEnvelope: frozen run goal + scope + ≤2000-char turn tail)
→ ContinuationAssessment (strict enum JSON, parseAssessment-validated)
→ deterministic stop-veto word list (tail window, tighten-only)
→ decideContinuation (IN_PROGRESS ∧ OPEN_ADVANCING/REFINED ∧ WITHIN_SCOPE ∧ NONE ∧ HIGH)
→ WOULD_CONTINUE: next governed GO (soft re-anchor after 3 plain rounds)
→ WOULD_STOP: run ENDED with the faithfully mapped reason
```

Everything already hardened in the ASSISTED loop is unchanged: single in-flight submission, budget consumed exactly once at proven acceptance, stable-turn gate, USER_INTERVENTION on any foreign user message, UNCERTAIN/carrier/authority fail-closed, ×10/×20 hard-locked at 5, Stop always available, evidence candidates per round.

## 2. Evaluator boundary (task-contract conformance)

- **Isolated**: the evaluation is a background service-worker fetch to `https://api.deepseek.com/chat/completions` (newly allowlisted in `host_permissions`). It never inserts a prompt into the user's ChatGPT conversation and holds no actuation authority — the verdict can only trigger the existing governed dispatch path.
- **Bounded envelope** (contract §8): frozen run-goal (Human-authored at start), scope (defaults to the goal), completed assistant turn tail (≤2000 chars), no fabricated checkpoint/frontier. The envelope is assembled background-side from the durable run; the wire only carries `runId` + excerpt (≤8000 chars).
- **Not a planner**: the system prompt forbids planning/inventing methods and demands faithful uncertainty; `parseAssessment` rejects any non-enum value; `next_action_hint` is not requested at all in V0.
- **Fail-closed**: HTTP error, timeout (30s), invalid JSON, unknown enum, unconfigured key — every one resolves to `WOULD_STOP / EVALUATOR_UNAVAILABLE` or the mapped stop reason. A missing/invalid config never degrades to blind auto-send.
- **Host allowlist**: `normalizeEvaluatorConfig` accepts only `https://api.deepseek.com` (exact host, https); the stored config is written only through the background lane (`NOOS_CONTINUATION_EVAL_CONFIG`), the key never echoes back to the content script, and the verdict lane re-reads the durable run so goal/scope cannot be spoofed from the wire.

## 3. Stop-veto word list (user-proposed refinement, tighten-only)

The user proposed hot-word matching as the evaluator and it was declined as a *continue* signal (open-ended paraphrase set ⇒ cannot deliver False Continue ≈ 0; most legitimate continuations contain no hot word at all). The adopted inversion is sound: a configurable-in-code veto list of stop-boundary phrases (human-choice, completion, waits, insufficient-evidence patterns, EN/ZH) matched against the turn tail (last 400 chars). A veto hit flips a would-be CONTINUE into `WOULD_STOP / WAIT_HUMAN` and is recorded (`vetoHit`) — it can only tighten the gate, never loosen it.

## 4. Soft re-anchor V0 (task §18)

Rounds 1–3 submit the plain `go`. Rounds 4–5 prepend a bounded `[NOOS Re-anchor]` block restating the frozen run goal and the scope guard (`max_plain_go_streak = 3`, policy parameter, not invariant). Provenance stays distinct: the transport payload is Harness-generated and each round's evidence candidate records `continuationMode: PLAIN_GO | REANCHOR_GO`. No Goal/Scope mutation occurs; re-anchor is context maintenance only.

## 5. Ownership, cross-entry constraint, UI

- Run/evaluation authority stays in the background coordinator (chrome.storage + lock). The evaluator module (`src/core/continuation-evaluator.ts`) is imported at runtime only by the service-worker entry; the content entry keeps type-only imports, so the build remains exactly two MV3-safe files (`content.js` 167.67 kB, `service-worker.js` 159.12 kB).
- Content UI: settings panel gains "BCR 自动评估（实验）" (DeepSeek API key — write-only, and model fields; saved via the config lane). With a configured evaluator the BCR panel shows the AUTO ×5 badge and a run-goal input; starting without a goal is refused (`bcrGoalRequired`). Active AUTO runs show `EVALUATING` phase and always-available Stop; reload mid-evaluation resumes the evaluation (adoption path); a READY_TO_GO resume after a crash surfaces the manual [Send go] button rather than silently re-dispatching.
- Evidence candidates now record `continuationMode` and the full `assessment`, making each real round a near-complete future fixture (turn + envelope + assessment + decision + outcome); they remain non-gate-countable until a named label authority freezes them.

## 6. Tests and verification

- `tests/continuation-run.test.ts` (28): AUTO_X5 start validation (goal required), COMPLETED → EVALUATING routing per mode, pass/stop advance mapping, budget-exhaustion precedence over evaluation, phase guards (no HUMAN_CONTINUE/dispatch during EVALUATING), evidence with continuationMode + assessment.
- `tests/continuation-evaluator.test.ts` (new, 8): host allowlist, veto patterns (hit + clean turns), stop-reason mapping table, strict JSON envelope, fenced-JSON parsing, veto-overrides-LLM-continue, low-confidence stop, fail-closed on invalid JSON / HTTP 401 / network error / unknown enums.
- `tests/background-continuation-run.test.ts` (6): config store without key echo, evaluate lane happy path (model + frozen goal asserted in request body), `evaluator_unconfigured` / `no_active_auto_run` refusals, HTTP-401 → `EVALUATOR_UNAVAILABLE`.
- Verification: `npm run typecheck` clean; release-parity suite 36 files / 462 tests green; `npm run build` exactly two entry files; `tests/content-ui-smoke.test.ts` 28/28.

## 7. Remaining gates and honest limits

1. `REAL_DOGFOOD_EVIDENCE_PENDING` (ASSISTED ×5): the Human's first governed run was executed on a real project conversation (rounds 1–2 observed live before this change; the run was interrupted by this feature branch's rollout) — its durable candidates remain in `noosContinuationRunStore` and are quotable post-hoc.
2. `AUTO_DOGFOOD_PENDING` (this change): the first fully automatic ×5 run — key configured, goal stated, zero per-round Human clicks — is the next live acceptance step, requiring the Human at the browser with a DeepSeek key.
3. Evaluator quality itself is now an empirical question: per-round verdicts (+veto hits) land in the candidate pool, so the offline gate (40–50 REAL fixtures) can later be filled from real AUTO/ASSISTED rounds without any manual JSON authoring.
4. DeepSeek only in V0; Gemini Flash and Hub-proxy transport (option A) remain open follow-ups. `HUB_LIVE_PROJECTION_PENDING` unchanged.
5. Veto list is code-configurable, not UI-configurable in V0 (deliberate: it is a safety tightening, not a user preference).

## 8. Deliverables

- Branch `bcr/auto-x5-deepseek-evaluator` (from `origin/main` `990037c`); exact head recorded on the PR.
- New: `src/core/continuation-evaluator.ts`, `tests/continuation-evaluator.test.ts`, this report.
- Modified: `src/core/continuation-run.ts` (AUTO_X5 mode, goal/scope, EVALUATING phase, evaluation events, evidence fields), `src/background/service-worker.ts` (evaluate + config lanes), `src/content/index.ts` (AUTO loop, settings, goal input, re-anchor), `src/shared/i18n.ts`, `src/content/styles.css`, `public/manifest.json` (DeepSeek host permission).
