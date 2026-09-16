# BCR Minimum Usable Loop — Implementation Report (v0)

> Working report for the Shuttle-first Bounded Continuation Run minimum usable loop. Not a contract; does not promote the BCR Working Candidate (`design/bounded-continuation-run-v0-candidate`) to V1 authority. Companion to `bounded-continuation-evidence-readiness-report.md` (PR #33, merged `235a43e`).

## 1. Current architecture inventory (exact refs @ base `origin/main` `235a43e`)

| Surface | Fact |
| --- | --- |
| Slice 1 ledger | `src/core/submission-operation.ts` + `src/core/human-go-runtime.ts` merged via `59ad928`; coordinator ledger singleton in `src/background/service-worker.ts` (`getSubmissionOperationCoordinator`, chrome.storage + `navigator.locks`) |
| Human GO execution | `dispatchHumanGo` in `src/content/index.ts`: waits READY browser-tab carrier → `HumanGoRuntime.execute` (prepare → claim → content-side composer actuation → receipt) → `activeSubmission` |
| Observation | Content-side `RuntimeObservationLedger` (`src/content/runtime-observer.ts`); `observeRuntimePage` samples per tick and calls `reconcileActiveSubmission` (PROVEN_ACCEPTED + `isStableSubmissionObservation` 2s stable window → `record COMPLETED`) |
| Background | Purely reactive `chrome.runtime.onMessage`; no timers/ports; durable stores in chrome.storage |
| Hub | `apps/noos-hub/src/harness/` renders fixture-only `HarnessConsoleSnapshot` (PR #20); **no harness-snapshot HTTP route exists** in `src-tauri/src/main.rs` and the extension ships no snapshot today |
| Evaluator runtime | None in the extension. LLM clients exist only in the separate `apps/llm-wiki` Tauri app; no cloud API is wired into the browser extension |

## 2. Selected mode: `ASSISTED` — `AUTO_BCR_BLOCKED_BY_EVALUATOR_RUNTIME`

There is no safe, reusable inference adapter inside the extension runtime, and the task contract forbids regex impostors and ad-hoc cloud APIs. The V0 loop is therefore Human-assisted per round:

```text
Start Go ×N → GO via SubmissionOperation → stable Assistant Turn
→ "Continue this run?" [Continue] / [Stop]
→ Continue → next governed GO (budget −1) … → BUDGET_EXHAUSTED
```

Every continuation still travels the full Slice 1 path; nothing auto-sends. The conservative `decideContinuation` policy and `ContinuationAssessment` schema from PR #33 remain the exact integration seam for a future evaluator: once a safe evaluator backend exists, the assisted prompt is replaced by the policy verdict (`AUTO_X5_EXPERIMENTAL`) without touching the loop machinery.

## 3. Ownership and boundaries

- **Background coordinator = run authority.** New durable store `noosContinuationRunStore` (chrome.storage.local) mutated only inside `handleContinuationRunMutation` under the `noos-continuation-run-authority` lock: `{ activeByConversation, ended[≤20], candidates[≤100] }`. Pure transitions in `src/core/continuation-run.ts` (`reduceContinuationRunStore`).
- **Content script = projection + driver.** Renders run state, drives events (dispatch issued, carrier phase, acceptance, completion, decisions), executes composer actuation only through the existing `dispatchHumanGo` → `HumanGoRuntime` path. No direct `querySelector` submit bypasses the ledger; the loop issues `N` governed GO operations, not a browser macro.
- **Hub = unchanged, `HUB_LIVE_PROJECTION_PENDING`.** Per task §21 the live chain is deferred rather than blocking the MVP. Exact gaps: (1) no `/v1/harness/snapshot` route in the Tauri server; (2) no extension-side snapshot shipping; (3) Hub console consumes fixtures only. The projection block shape is already frozen by `HarnessConsoleSnapshot` ownership rules; a `continuationRun` block must be an ephemeral coordinator projection, never a second store. No Hub code was modified in this change.

## 4. Runtime invariants implemented

| Invariant | Mechanism |
| --- | --- |
| MAX one in-flight continuation | `ContinuationRun.pendingSubmissionOperationId`; `DISPATCH_ISSUED` refused while pending or not `READY_TO_GO`; `canDispatch` gate re-checked background-side via `check_dispatch` mutation before every dispatch |
| Reuse Slice 1 per round | Each round creates a normal `GO` SubmissionOperation (`${runId}:go:${round}`) through `dispatchHumanGo`; fence, claim, receipt, reconciliation, restart recovery are Slice 1's, unchanged |
| Stable-turn gate | Next round only after `reconcileActiveSubmission` proves accepted AND `isStableSubmissionObservation` (READY + quiet + 2s window) AND `record COMPLETED` confirmed → `OPERATION_COMPLETED`; `Carrier == READY` alone never authorizes |
| Budget semantics | `consumedContinuations` increments on `OPERATION_ACCEPTED` (proven acceptance); `BUDGET_EXHAUSTED` ends the run after the final round completes; goal may still be in progress |
| UNCERTAIN fail-closed | Dispatch exception/lost response → `OPERATION_UNCERTAIN` → run `FAILED_SAFE / SUBMISSION_UNCERTAIN`; no blind retry (Slice 1 reconciliation still owns the durable op) |
| Human intervention | Watcher tick: any observed user-message count above the run's expected count (its own authored submissions) → `USER_INTERVENTION` → run CANCELLED; remaining budget never resumes. The expected count baselines from the live observation on run adoption (reload survival) and on the first tick with a live observation, and re-baselines after a BLOCKED dispatch that sent nothing; manual Shuttle GO actions are refused while a run is ACTIVE; BCR UI actions are reentrancy-guarded (`runExclusiveBcrAction`) so double-clicks cannot interleave gate-check and dispatch |
| Budget consumption exactly-once | Consumption is keyed to the operation: `OPERATION_ACCEPTED` consumes, and `OPERATION_COMPLETED` backfills consumption when the ACCEPT event was lost (completion implies proven acceptance in Slice 1). A lost ACCEPT can therefore never under-count the budget |
| Conversation/binding pin | Run pins `providerConversationRef`; conversation change → `CONVERSATION_REBASE_REQUIRED` (both watcher and page-side reset). Carrier reload rotates the authority: `REBIND` re-pins the binding generation between rounds on the same conversation; mid-round recovery stays with Slice 1 |
| Budget gating | `startContinuationRun` rejects budgets > `BCR_EXPERIMENTAL_MAX_BUDGET` (5); UI shows Go / Go ×5 enabled, ×10 / ×20 visible-disabled with the lock reason; the cap is delivered from the background (`budgetCap`), not hardcoded UI optimism |
| Stop conditions | `BUDGET_EXHAUSTED`, `USER_CANCELLED`, `USER_INTERVENTION`, `SUBMISSION_UNCERTAIN`, `CARRIER_FAILURE`, `AUTHORITY_CHANGED`, `CONVERSATION_REBASE_REQUIRED` (+ reserved `WAIT_*`/`GOAL_SATISFIED`/`SCOPE_*`/`STALLED` in the enum for assisted reporting) |
| Plain `go` payload | Continuation rounds submit the literal `go`; no large instruction payloads (soft re-anchor intentionally not implemented: no reliable runtime Goal/Focus source exists yet, and fabrication is forbidden) |

## 5. UI integration point

Reused the existing surface popover (no second panel): `renderChatGptSurface` now renders a `bcr-panel` section — start row (Go / Go ×5 / locked ×10 / ×20 with reason), active run (`Running n / N · <phase>`, `Continue this run? [Continue] [Stop]` at the decision phase, `[Send go]` retry at `READY_TO_GO`, always `[Stop]`), ended state (`Run ended n / N · Reason: <enum>` plus "Goal may still be in progress." for budget exhaustion), and a debug line (run id, last consumed turn ref). New actions `bcr-start-{1,5,10,20}`, `bcr-continue`, `bcr-stop`, `bcr-go` ride the existing `data-action` delegation in `handleAction`. Copy is bilingual (en/zh) per repo i18n rules.

## 6. Evidence capture embedded in the run path

Every decided round attaches a `CandidateContinuationFixture` via the `record_round_evidence` mutation: `{ candidateId = runId:index, conversation ref, turnRef (content-addressed `turn:<assistant-fingerprint>`), assistant turn excerpt (≤2000 chars), decision (HUMAN_CONTINUE / HUMAN_STOP / BUDGET_ENDED / RUN_ABORTED), humanAction (continued / stopped / intervened), stopReason, capturedAt }`. These accumulate in the durable candidate pool. They are **not** fixtures: no label authority, no goal/scope snapshot, and the offline gate (`fixtures/continuation-eligibility/`) still excludes everything synthetic and everything unlabeled. Promotion to gate-countable REAL fixtures remains a human labeling step per the fixture README.

## 7. Packaging constraint discovered and fixed

The first build made `content` and `service-worker` share the new `continuation-run` module — the first cross-entry runtime share in this repo — so Rollup emitted `assets/continuation-run.js`, which MV3 content scripts (classic scripts) cannot import; the UI smoke suite caught 27 bootstrap failures. Fix: the content entry holds type-only imports; all run logic (gate check, candidate construction) lives background-side (`check_dispatch`, `record_round_evidence` mutations). Build is back to exactly two entry files; `tests/content-ui-smoke.test.ts` passes 27/27.

## 8. Tests and verification

- `tests/continuation-run.test.ts` (22): budget/identity validation, decision gate truth table, 5-round assisted lifecycle → `BUDGET_EXHAUSTED`, single-in-flight enforcement, acceptance idempotency, UNCERTAIN/intervention/carrier/authority/rebase fail-closed paths, terminal immutability, store reducer (per-conversation runs, ended tail cap 20, candidate idempotency + cap 100, malformed-mutation rejection).
- `tests/background-continuation-run.test.ts` (4): durable store across a real service-worker module restart, full round drive through the message channel, intervention archive + durable candidate pool, and rejection of oversize budgets / duplicate runs / subframe / foreign-origin senders.
- Full verification: `npm run typecheck` clean; release-parity suite `npm test -- --exclude tests/content-ui-smoke.test.ts` 34 files / 429 tests green; `npm run build` two-entry output; `tests/content-ui-smoke.test.ts` 27/27.

## 9. End-to-end dogfood evidence

- **Automated loop evidence:** the background test drives `start → dispatch → accepted → completed → human continue → …` through the real message handler and durable storage; the smoke suite drives the real built `content.js` in a mock ChatGPT page.
- **Real ChatGPT dogfood: `REAL_DOGFOOD_EVIDENCE_PENDING`.** The remaining acceptance item — a live round on a real logged-in ChatGPT conversation (`Start → GO → reply → assisted decision → second GO → Stop/End`) — requires the Human at the browser. Runbook: reload the built extension (CDP 9229 flow), open a real conversation, press `Go ×5` in the Shuttle panel, answer one assisted prompt with `[Continue]`, then `[Stop]`; the run's end state and candidate pool are durable in `chrome.storage.local` under `noosContinuationRunStore` and can be quoted into this report afterwards.

## 10. Remaining blockers and gates

1. `REAL_DOGFOOD_EVIDENCE_PENDING` — one live Human-driven round (§9 runbook).
2. `AUTO_BCR_BLOCKED_BY_EVALUATOR_RUNTIME` — no safe in-extension evaluator; assisted mode stays until one exists; ×10 / ×20 remain hard-gated by `BCR_EXPERIMENTAL_MAX_BUDGET` regardless.
3. `HUB_LIVE_PROJECTION_PENDING` — bridge gaps listed in §3.
4. Soft re-anchor not implemented (no runtime Goal/Focus source; fabrication forbidden).
5. Content-addressed `turnRef` (`turn:<fingerprint>`) is the best available stable turn identity; provider-native message ids remain the preferred future upgrade (BCR candidate §15).
6. Known V0-assisted limitation: if the `OPERATION_COMPLETED` transition itself cannot be applied, the run stays at `ASSISTANT_GENERATING` (fail-safe; the only exit is `[Stop]`, and the durable op keeps its own Slice 1 recovery). Acceptable because every round requires a Human decision anyway.

## 11. Deliverables

- Branch `bcr/minimum-usable-loop-v0` (from `origin/main` `235a43e`); exact head is recorded on the PR description and review comment (a report cannot cite its own commit).
- New: `src/core/continuation-run.ts`, `tests/continuation-run.test.ts`, `tests/background-continuation-run.test.ts`, this report.
- Modified: `src/background/service-worker.ts` (coordinator + message lane), `src/content/index.ts` (loop driver + UI section + reconcile hooks), `src/content/styles.css`, `src/shared/i18n.ts`.
