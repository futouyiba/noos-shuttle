# NOOS Deliberation Harness V1 — Acceptance Audit

> Final acceptance mapping of the design documents' scope to the implemented,
  independently reviewed system. Audit basis: `v1-end-to-end-walkthrough-v1.md`
  (§2 happy path, §3 recovery traces, §4 seam checklist), the
  `v1-final-e2e-readiness-confirmation.md` NOT_IMPLEMENTED inventory, and the
  three adjudications (delivery lane, reducer model, W11 fence / FORKED axes,
  control-lane re-arm). Audited tree: `origin/main` @ `081c6f7`.
>
> Verdict scale: **ACCEPTED** (implemented, independently reviewed, tested),
  **PARTIAL** (core implemented; a named residual remains), **NOT_ACCEPTED**
  (out of V1 scope by adjudication or unimplemented).

## 1. How to read the evidence column

Every ACCEPTED/PARTIAL row cites the module(s) and the independent-review
trail (all slices carry fable-reviewer APPROVE verdicts with
mutation-verified test locks; the full table is in
`v1-integration-verification-status.md`). Test totals at the audited commit:
**30 files / 348 tests**, typecheck clean, release-workflow parity green
(29 files / 321 tests excluding the playwright smoke per the workflow, all
eight release scripts, packaging OK).

## 2. Seam checklist (walkthrough §4, 19 rows)

| Seam | Walkthrough said | Audit verdict | Evidence |
| --- | --- | --- | --- |
| Actor / Logical Thread | SUPPORTED (design) | **ACCEPTED** | Child ledger enforces one parent, explicit role/goal/scope per child (`child-worker.ts`, exhaustive transition table + W1 review). PDLT spine modeled by Work Item `primaryLogicalThreadId` driving every runtime loop. |
| Work Item identity | SUPPORTED | **ACCEPTED** | `work-item-inbox.ts` (reviewed upstream); every probe resolves parent via the active Work Item binding; child intents and submission operations all carry `workItemId`. |
| Provider Conversation identity | SUPPORTED | **ACCEPTED** | Distinct from thread and tab throughout: binding ledger (`operational-state-reducer.ts`), delivery routing, `provider-identity.ts` extraction; provisional WEB identity withheld until confirmed (PR #4, reviewed). |
| Browser Carrier | SUPPORTED | **ACCEPTED** | `runtime-observer.ts` deterministic state machine (ATTACHING→READY→…→BROKEN), 11 tests; carriers are disposable refs (`browser-tab:{id}`) on every ledger. |
| Binding epoch | rule SUPPORTED, impl NOT_IMPLEMENTED | **ACCEPTED** | `commitCurrentConversationBinding` monotonic generations, expectation fences, reverse-uniqueness; execution-owning states block rollover; restore guards (W11a/W14 review matrices). |
| Actuation lease | SUPPORTED, impl NOT_IMPLEMENTED | **ACCEPTED** | `transferActuationLease` independent generations; single lease holder per conversation; `DISPATCH_ALREADY_OWNED`/`REARM_EXECUTION_CONFLICT` exclusivity. |
| Carrier Runtime State | SUPPORTED | **ACCEPTED** | Observation contract implemented with conservative READY conjunction and quiet-window STABILIZING (`runtime-observer.test.ts`). |
| Logical Control State | SUPPORTED | **PARTIAL** | Mechanical `WAIT_REVIEW/WAIT_WORKER` implemented with wait-clearing on delivery completion (`result-delivery.ts`); the full orthogonal CONTINUE/WAIT_*/BOUNDARY_REACHED semantic-control surface belongs to the semantic run-state handlers — adjudicated **V1-later**. |
| Submission Operation | SUPPORTED | **ACCEPTED** | Persist-before-actuate, pre-submit baselines, one blind dispatch, UNCERTAIN reconciliation (`submission-operation.ts`, 47+ tests); create-or-get identity; durable acceptance stamp. |
| Operation persistence | SUPPORTED, runtime NOT_IMPLEMENTED | **ACCEPTED** | Durable chrome.storage ledgers; worker-restart non-duplication proven in browser smokes (Human GO reload test; reanchor worker-reload test). |
| UNCERTAIN reconcile | SUPPORTED | **ACCEPTED** | Proven-not-accepted → re-arm (W9/W14), proven-accepted → INSERTED (W7 stamp), ambiguity parks; runtime recovery probes drive both directions. |
| Goal / Scope inheritance | SUPPORTED | **ACCEPTED** | Intent fields durable per child; inheritance wired through Work Item goal/scope into probes (goal-reanchor runtime) and child records. |
| Human authority | SUPPORTED | **ACCEPTED** | Freeze/Promote human-gated (`review-freeze.ts` authority records); re-anchor and delivery are not approval gates anywhere in the runtime. |
| Child creation mode | SUPPORTED | **ACCEPTED** | FORKED/FRESH durable with the adjudicated context axes (source × fidelity, W12); no relabel path exists; non-conforming strategy = `spawn_needs_human` with intent left PLANNED. |
| Result identity / route | SUPPORTED | **ACCEPTED** | `ResultDeliveryKey` + `WorkerResult` refs route by parent Logical Thread; raw-tabId return routes structurally rejected; destination resolved at delivery time. |
| Parent rollover routing | GAP (binding authority) | **ACCEPTED** | The former GAP-1/3/4 closed by the binding reducer: delivery-time resolution, retarget before claim (W3), rollover re-arm with control binding roll first (W14), stale-epoch fences. |
| Restart non-duplication | SUPPORTED, runtime NOT_IMPLEMENTED | **ACCEPTED** | Durable intents precede spawn; reconcile-before-retry enforced (no re-spawn from SPAWNING/SPAWN_UNCERTAIN — W4/D5 review mutations); worker reload smokes assert single dispatch. |
| Duplicate-tab safety | SUPPORTED, runtime NOT_IMPLEMENTED | **ACCEPTED** | Lease exclusivity + carrier matching in every claim path; duplicate carriers tolerated as observers only. |
| Provenance / retirement | SUPPORTED | **ACCEPTED** | RETIRED preserves history (W1 test); retirement releases execution; superseded conversation refs retained on rebinding. |

## 3. Recovery traces (walkthrough §3)

| Trace | Audit verdict | Evidence |
| --- | --- | --- |
| 3.1 Service-worker restart | **ACCEPTED** | Durable operation identity + persist-before-actuate; restart reconciles DISPATCHING/UNCERTAIN first (recovery probes), never creates a new operation for a lost callback (deterministic ids + create-or-get). Browser smoke: worker reloaded mid-flight, exactly one dispatch. |
| 3.2 Duplicate tab | **ACCEPTED** | One lease per conversation; observed duplicates cannot actuate. |
| 3.3 Uncertain GO | **ACCEPTED** | Full lifecycle incl. manual-pause semantics: ambiguity parks UNCERTAIN indefinitely; only proven-not-accepted re-arms. |
| 3.4 Uncertain fork | **ACCEPTED** | `SPAWN_UNCERTAIN` parks; recovery = rebind recovered conversation or proveNonCreation; never a blind second spawn (W13 adoption lane honors the same rule). |
| 3.5 Rollover while Reviewer active | **ACCEPTED** | Late-bound routing + control binding roll before re-arm; stale epochs fenced (W14 rollover lockstep test). |
| 3.6 Restart while RETURNING | **ACCEPTED** | Delivery index + transport are durable and idempotent (create-or-get, deterministic ids); GAP-5 closed by the adjudicated ResultDeliveryKey/INSERTED/COMPLETED receipts with parent wait clearing. |

## 4. Readiness §5 NOT_IMPLEMENTED inventory → closure

| Inventory item | Verdict | Closure |
| --- | --- | --- |
| Durable Work Item / PDLT / child / binding records | **ACCEPTED** | work-item-inbox, child-worker, binding ledger — all durable + reviewed. |
| Reducer ops + crash-consistent ApplyResults | **ACCEPTED** | `commit_current_conversation_binding`/`transfer_actuation_lease`/`claim_submission_dispatch`/`settle_submission_dispatch`/`rearm_submission_dispatch` on the durable delta kernel (ApplyResult/audit/idempotent replay, one durable transaction). |
| Carrier observer state machine + conformance receipts | **PARTIAL** | State machine accepted; formal *provider adapter conformance receipts* are folded into the capability-reporting model (W12/W13) rather than a separate receipt artifact — an adjudicated simplification, residual recorded. |
| Canonical attachment/lease transfer + restart recovery | **ACCEPTED** | Lease generations + restore guards + crash-window backfills (W11b/W14). |
| SubmissionOperation ledger + baselines + reconciliation | **ACCEPTED** | 649-line ledger, 47+ tests. |
| Step Mode GO + sparse re-anchor hooks/counter | **ACCEPTED** | Goal-reanchor runtime (B line, 3× APPROVE) incl. rollover trigger + durable recovery. |
| Idempotent Sedimentation fork + Fresh Reviewer creation | **PARTIAL** | FRESH creation fully wired browser-real (W13: activation-safe adoption). FORKED is *deliberately* not automated: the adapter honestly reports `supportsNativeFork: false` and the harness refuses with `spawn_needs_human` — the fork-adapter adjudication (D2) holds; native fork remains provider-blocked, tracked as the standing gap. |
| Freeze Snapshot + immutable Review Report/WorkerResult | **ACCEPTED** | `review-freeze.ts` (immutable snapshots, authority provenance; 10 tests). |
| `DELIVER_CHILD_RESULT` create-or-get / key lookup / receipts / wait clearing | **ACCEPTED** | The adjudicated projection model + transport composer + runtime lockstep (W2–W14). |

## 5. Final verdict

- **17 of 19 seams ACCEPTED**; 2 PARTIAL for adjudicated reasons (semantic
  control surface and provider conformance receipts → V1-later simplifications),
  0 NOT_ACCEPTED.
- **All 6 recovery traces ACCEPTED**, including the two former GAP traces
  (rollover routing, returning-result restart).
- Standing, explicitly out-of-V1 items: semantic run-state handlers
  (commit_decision / open_question / … — adjudication item 5), native FORKED
  spawn (provider capability), provider adapter conformance receipts as a
  separate artifact.

**Acceptance statement: the V1 Deliberation Harness design scope as amended
by the four adjudications is implemented to acceptance — every implemented
slice independently reviewed with mutation-verified tests, and the residuals
are adjudicated deferrals rather than open engineering.**
