# BCR background-tab / foreground-dependence recovery failure — diagnosis and proposal (v0)

- **Base SHA**: `570331278f54d5c54d00771c03d5f1302aa6bb72` (`main`, = `origin/main`)
- **Worktree / branch**: `.claude/worktrees/bcr-fg-dependence`, branch `worktree-bcr-fg-dependence`
- **Scope**: diagnose the reported AUTO BCR "stops when the Human switches tabs, does not resume on switch-back, sits in an intermediate phase instead of FAILED_SAFE" failure. **No extension code was changed.**
- **Evidence grades** used below: `CODE` (read at the base SHA) / `LIVE` (measured in the running Chrome + extension via CDP) / `STORE` (read from `chrome.storage.local`) / `INFER` (reasoned from CODE+STORE) / `PENDING_VALIDATION` (not verified; reason stated).

## 0. Bottom line

The reported symptom is **not** a Chrome timer-throttling problem, and the designer's leading hypothesis (a lost volatile continuation after `EVALUATION_PASSED`) is **not** what the live dogfood instance shows. The live instance is a **durable-strand caused by the single global submission authority**:

> A run's in-flight `SubmissionOperation` is reconciled only while the holder of `noosSubmissionAuthority` has the *same* `logicalThreadId` as the operation. `reconcile` **never re-establishes authority**. As soon as another conversation claims the authority, the earlier run's `reconcile` returns `STILL_AMBIGUOUS` forever, the run stays `ACTIVE` in an intermediate phase with a pending operation, and **restoring visibility changes nothing** because the steady-state path that runs on a visible tab is `reconcile`, which is exactly the path that cannot re-claim.

Authority is not held by mere activity or visibility: takeover requires an *active* `ensureAuthority`/`recover` on the competing conversation — i.e. that conversation dispatching or recovering an operation. So the wedge needs a second conversation that actually claims, not merely one that is open.

Measured directly: after the stranded run's tab was returned to the foreground and its observation cadence was fully restored to 1 Hz for 90 s, the ledger revision advanced **+1 per second** (one `reconcile` attempt per second) while phase, consumed count, operation state and authority generation **did not change at all**.

**What is measured and what is inferred.** The *liveness* half is measured: on a run found already wedged, returning to the foreground and restoring the full observation cadence does not resume it (`LIVE`, §3 rows C and F). The *trigger* half — that switching tabs is what put the run into that state — is **not** reproduced; it is `CODE` + `INFER` + `STORE`, and §3 says so. M1 is therefore established as the mechanism that makes the wedge **permanent and invisible**; whether tab-switching is the only, or even the usual, way to reach it is `PENDING_VALIDATION`.

Three strands are described below. Only **M1** is live-reproduced; **M2** and **M3** are code-level structural findings. A fourth, independent defect (**M4**, §7) was found while running the required verification commands: the test suite is **red at the base SHA** — 27 failed / 459 passed — because four test files never inject the Web Locks capability the authority lock requires. M4 is unrelated to the background-dependence failure but blocks regression protection for any fix in this area.

---

## 1. Phase A.1 — Continuation chain trace

Chain traced at the base SHA: `assistant generation → stable completion → SubmissionOperation COMPLETED → OPERATION_COMPLETED → EVALUATING → evaluator result → EVALUATION_PASSED → READY_TO_GO → next issueRunGo → DISPATCHING / ASSISTANT_GENERATING`.

| # | Step | Durable owner | Volatile owner | Execution context | Timer / callback / Promise dependent? | Reconcile after reload or content-script reconstruction |
|---|---|---|---|---|---|---|
| 1 | assistant generation observed | — (provider) | `RuntimeObservationLedger` | content script | **timer** — 1 s poll (`PAGE_CONTEXT_POLL_MS`, [index.ts:2622-2633](src/content/index.ts)) + 1.2 s BCR watcher ([index.ts:1854-1857](src/content/index.ts)) | observation is re-derived from DOM; no memory needed `CODE` |
| 2 | stable observation of the accepted turn | — | `activeSubmission` (volatile) | content script | **timer** — same poll | `restoreActiveSubmission` re-derives it **only if `activeSubmission` is null** ([index.ts:3310](src/content/index.ts)) `CODE` |
| 3 | op → `COMPLETED` | `noosSubmissionOperations` | — | service worker (via message) | Promise chain off the poll | `restoreActiveSubmission`'s candidate filter **excludes `COMPLETED`** ([index.ts:3323](src/content/index.ts)) — a COMPLETED op cannot be re-driven `CODE` |
| 4 | `OPERATION_COMPLETED` → run | `noosContinuationRunStore` | — | content script reducer ([continuation-run.ts:162-183](src/core/continuation-run.ts)) | same Promise chain as step 3 | no reconciler maps a durable `COMPLETED` op to a missing run event `CODE` |
| 5 | → `EVALUATING` (AUTO_X5) | run store | — | reducer | same chain | `adoptRunState` re-enters evaluation on load, but **only** for `phase === "EVALUATING"` ([index.ts:1593-1595](src/content/index.ts)) `CODE` |
| 6 | evaluator request | — | — | content script → SW | **awaited Promise** (`NOOS_CONTINUATION_EVALUATE`) ([index.ts:1808](src/content/index.ts)) | not durable; re-running it is only possible from `EVALUATING` |
| 7 | `EVALUATION_PASSED` → `READY_TO_GO` | run store ([continuation-run.ts:198-202](src/core/continuation-run.ts)) | — | reducer | same chain | — |
| 8 | next `issueRunGo` | run store (via dispatch claim) | `bcrBusy`, `bcrRun` | content script | **plain async call, no timer** ([index.ts:1833](src/content/index.ts)) | **no durable-state-driven driver exists for `READY_TO_GO`** `CODE` |
| 9 | dispatch claim / `DISPATCH_ISSUED` | ops store + run store | — | content script → SW | awaited Promise | `check_dispatch` refuses unless `phase === READY_TO_GO` and no pending op ([continuation-run.ts:114-122](src/core/continuation-run.ts)) |
| — | recovery of an in-flight op | — | `activeSubmission` | content script | **timer** — 1 s poll | `restoreActiveSubmission` → `recover` → `reconcile` `CODE` |

**Structural findings from the trace**

- **`issueRunGo` has exactly four call sites**: panel `[Send go]` ([index.ts:1347](src/content/index.ts)), `startBoundedRun` ([index.ts:1709](src/content/index.ts)), the tail of `autoAdvanceRound` ([index.ts:1833](src/content/index.ts)), and `continueBoundedRun` ([index.ts:1851](src/content/index.ts)). Three are human-initiated; the fourth is the tail of the *same* async invocation that produced `EVALUATION_PASSED`. **Nothing re-drives a durable `READY_TO_GO`.**
- The 1.2 s watcher ([`bcrWatcherTick`, index.ts:1866-1899](src/content/index.ts)) has **no `READY_TO_GO` branch** — it only emits conversation-change, user-intervention, `CARRIER_PHASE` and `CARRIER_FAILURE` events.
- `CARRIER_PHASE` escalates to `FAILED_SAFE`/`CARRIER_FAILURE` only for `carrierState === "BROKEN"` ([continuation-run.ts:137-146](src/core/continuation-run.ts)); a stranded-but-healthy carrier is never escalated. Hence *"sits in an intermediate phase rather than a clear FAILED_SAFE"* is the designed behaviour of that branch `CODE`.
- The forward chain (steps 4→8) is **Promise/awaited-message driven, not timer driven**, so ordinary hidden-tab timer throttling does **not** break it. Throttling removes the *recovery* drivers (1 s poll, 1.2 s watcher) — it does not stop forward progress.
- `reconcile` requires an exact authority match and **has no `ensureAuthority`** on its path ([submission-operation.ts:261-284](src/core/submission-operation.ts)); `recover` **does** take authority over, but by `sourceObservedAt`/`sourceEpoch` recency only ([submission-operation.ts:709-712](src/core/submission-operation.ts)).

---

## 2. Phase A.2 — Instrumentation

New read-only harness: [`scripts/bcr-bg-timeline.mjs`](scripts/bcr-bg-timeline.mjs).

It attaches to the ChatGPT page targets (never to the service worker unless `--durable sw` is selected), installs a page-world recorder, drains it, and reads the durable ledger. It sends **no provider message**, clicks nothing, reloads nothing, and records **no conversation content** — message counts, refs and opaque ids only.

```bash
node scripts/bcr-bg-timeline.mjs --tab 6aa8bd9a --tab 6aab8aaa --seconds 210 --out /tmp/bcr-cdp/timeline-6.jsonl
```

### Field coverage

| Required field | How it is obtained | Grade |
|---|---|---|
| timestamp | harness clock + the extension's own `observedAt` | `LIVE` |
| runId | `noosContinuationRunStore.activeByConversation[].runId` | `STORE` |
| continuation index | `consumedContinuations` / `maxContinuations` | `STORE` |
| durable run phase + status | same record | `STORE` |
| `pendingSubmissionOperationId` | same record | `STORE` |
| submission operation state | `noosSubmissionOperations[].state` | `STORE` |
| evaluator request start/end | **not directly observable**; only bracketed by the `EVALUATING` interval | `PENDING_VALIDATION` (gap) |
| `EVALUATION_PASSED` | derivable as the `EVALUATING → READY_TO_GO` durable edge | `STORE` |
| `READY_TO_GO` | durable phase | `STORE` |
| `issueRunGo()` invocation | only when it leaves a trace (dispatch claim / op row); a bail inside `issueRunGo` ([index.ts:1715-1720](src/content/index.ts)) leaves none | `PENDING_VALIDATION` (gap) |
| dispatch claim | op `dispatchFence` (`bindingEpoch`, `leaseGeneration`, `leaseOwnerRef`, `targetCarrierRef`) | `STORE` |
| provider observation state | the extension's existing `noos:runtime-observation` event | `LIVE` |
| `document.visibilityState` | page-world recorder | `LIVE` |
| `pageshow` / `pagehide` | page-world recorder | `LIVE` |
| `visibilitychange` | page-world recorder | `LIVE` |
| `freeze` / `resume` | recorded **if emitted** — none were emitted in this capture | `LIVE` (negative) |
| content execution-instance identity | `observation.executionInstanceRef` | `LIVE` |
| SW / background wake-restart identity | `/json/list` service-worker target id (attach-free) | `LIVE` |
| global authority holder | `noosSubmissionAuthority` | `STORE` |
| ledger write activity | `noosSubmissionOperationsRevision` | `STORE` |

**Declared gaps.** (1) The evaluator request start/end is not emitted by the extension; it is only inferable from the durable `EVALUATING` interval. (2) A failed `issueRunGo` leaves no durable or event trace. (3) `freeze`/`resume` are only observable if the browser emits them; none were emitted here. (4) Reading the durable ledger via the SW target keeps the MV3 worker alive (a declared perturbation of *worker* wake/restart behaviour); SW identity is therefore taken from attach-free `/json/list` polling instead. A `--durable page` mode avoids the perturbation at the cost of throttled read latency.

### Evidence excerpt (one real capture, 210 s)

Hidden baseline, then the visibility transition, then 90 s foreground:

```
+   0.7s [durable] event=baseline run=bcr-mu5ogo6o-9rui1p conv=6aa8bd9a mode=AUTO_X5 status=ACTIVE phase=STABILIZING consumed=1/5 pendingOp=bcr-mu5ogo6o-9rui1p:go:1-mu5ogo7b
+   0.7s [durable] event=baseline run=bcr-mu5860hg-g61kyd conv=6aab8aaa mode=AUTO_X5 status=ACTIVE phase=STABILIZING consumed=1/5 pendingOp=bcr-mu5860hg-g61kyd:go:1-mu5860hv
+   0.7s [durable] event=open_op op=bcr-mu5ogo6o-9rui1p:go:1-mu5ogo7b state=OBSERVED_ACCEPTED conv=6aa8bd9a carrier=browser-tab:557761583
+   0.7s [durable] event=authority thread=thread:6aaafaa9-3200-83ee-abe4-edd169e7ddd7 conv=6aaafaa9 carrier=browser-tab:557761595 gen=17
+  46.0s [heartbeat] durable_reads=89 durable_failures=0  runs=2 ops=28  phases=bcr-mu5o=STABILIZING/ACTIVE/1 bcr-mu58=STABILIZING/ACTIVE/1
+  60.4s [page] tab=C6309D24 kind=observation visibility=hidden  state=READY carrier=browser-tab:557761583 exec=observer-a5a42e61-… epoch=0 conv=6aa8bd9a
      <Page.bringToFront on tab C6309D24 at +63.7s>
+  63.7s [page] tab=C6309D24 kind=visibilitychange visibility=visible hidden=false
+  63.7s [page] tab=C6309D24 kind=focus visibility=hidden
+  64.2s [page] tab=C6309D24 kind=observation visibility=visible state=GENERATING mutating=true quietSince=null
+  64.3s [durable] run=bcr-mu5ogo6o-9rui1p changed=phase STABILIZING->ASSISTANT_GENERATING consumed=1/5 pendingOp=bcr-mu5ogo6o-9rui1p:go:1-mu5ogo7b acceptedOp=bcr-mu5ogo6o-9rui1p:go:1-mu5ogo7b
+  65.8s [durable] run=bcr-mu5ogo6o-9rui1p changed=phase ASSISTANT_GENERATING->STABILIZING consumed=1/5
+  67.3s … 153.3s [page] tab=C6309D24 kind=observation visibility=visible state=READY mutating=false  (1 Hz, ~86 consecutive samples)
      <no further durable row of any kind>
```

Ledger write activity for the same window, sampled separately:

```
2026-09-17T15:59:04.314Z opsRev=43513 phase=STABILIZING consumed=1 opState=OBSERVED_ACCEPTED auth=thread:6aaafaa9-… gen=17 authObservedAt=1789658603768
2026-09-17T15:59:05.324Z opsRev=43514 (+1)  … identical …
2026-09-17T15:59:06.333Z opsRev=43515 (+1)  … identical …
   … +1 per second for the whole sample …
TOTAL opsRev delta over 25s: 24
```

The stranded operation's own identity, next to the authority holder:

```
authority: { thread: "thread:6aaafaa9-3200-83ee-abe4-edd169e7ddd7", conv: "6aaafaa9-…", carrier: "browser-tab:557761595", gen: 17, sourceObservedAt: 1789658603768, sourceEpoch: 7 }
op:        { op: "bcr-mu5ogo6o-9rui1p:go:1-mu5ogo7b", state: "OBSERVED_ACCEPTED",
             thread: "thread:6aa8bd9a-46f0-83e8-a35d-f316b75712f4", conv: "6aa8bd9a-…",
             fence: { bindingEpoch: 0, leaseGeneration: 0, leaseOwnerRef: "observer-a5a42e61-…", targetCarrierRef: "browser-tab:557761583", sourceObservedAt: 1789658499718 },
             lastObservedAt: 1789658580811,
             evidence: { generationActive: true, observedAt: 1789658580811 } }
```

**Which durable transition committed, and which volatile continuation did not happen.** From the durable timeline: `DISPATCH_ISSUED` → `OPERATION_ACCEPTED` (consumed 0→1, `acceptedOperationId` set) → op `OBSERVED_ACCEPTED` → run `STABILIZING`. The next transition the chain needs is op `COMPLETED` → `OPERATION_COMPLETED` → `EVALUATING`. **That transition never commits**, and the reason is visible: every second the content script attempts the ledger mutation (`opsRev` +1), the mutation is refused by the authority gate, and no evidence is ever examined — so no `COMPLETED` row is written, no `FAILED_SAFE` is written, and the run has no reason to move.

Timeline correlation worth noting: this op was claimed at `1789658499718` and last observed at `1789658580811`; the authority was taken over by conversation `6aaafaa9` at `1789658603768` — **≈23 s after this run's own claim**. The run wedged immediately after the takeover.

---

## 3. Phase A.3 — Reproduction matrix

Constraint honoured throughout: **no provider message was sent, no `Retry` clicked, no provider page reloaded, no manufactured rate limiting.** That bounds which scenarios can be driven end-to-end and is stated per row.

| # | Scenario | Status | Last durable state | Last volatile event |
|---|---|---|---|---|
| A | foreground throughout | `PASS` (partial) | two AUTO_X5 runs `ACTIVE/STABILIZING` 1/5, ops `OBSERVED_ACCEPTED` | 1 Hz `observation` samples, `state=READY`, `exec=observer-a5a42e61-…` stable |
| B | switch away during `ASSISTANT_GENERATING` | `NOT_VERIFIED` | — | — |
| C | switch away during `STABILIZING` | `FAIL_REPRODUCED` (recovery half) | run stays `ACTIVE/STABILIZING` 1/5, `pendingOp` unchanged, op `OBSERVED_ACCEPTED`, authority `gen=17` unchanged | hidden: single `observation` at 1/min tier; visible: 1 Hz `observation`, `opsRev` +1/s, nothing else |
| D | switch away during `EVALUATING` | `NOT_VERIFIED` | — | — |
| E | near evaluator-passed / `READY_TO_GO` | `NOT_VERIFIED` | — | — |
| F | switch away 10–30 s then return | `FAIL_REPRODUCED` | identical durable state before and after the return (+90 s of foreground) | `visibilitychange` visible at +63.7 s, observations back to 1 Hz at +64.2 s |
| G | cycle among 2–4 tabs | `PASS` (partial) | both frozen runs remained frozen; the second tab's run did not react to becoming hidden | tab 9C8565DB `visibility=hidden` and tab C6309D24 `visibility=visible` sampled simultaneously |
| H | tab discard / execution reconstruction | `NOT_VERIFIED` for discard-driven reconstruction; related evidence `LIVE` | — | on the same frame, isolated world `ctx 24` answered `storage=NO` in 2 ms while `ctx 23` answered `storage=YES` in 45 ms with live data — a reconstructed world alongside an invalidated one (captured earlier in this investigation) |

**Why B, D, E and H are `NOT_VERIFIED`.** Driving them requires *creating* a live AUTO run in a specific phase, which means sending the provider a "go" message. That is explicitly outside this task's authorization ("不得自动发送「继续」"). I did not substitute a synthetic driver for it: writing to `noosContinuationRunStore` directly would be manufacturing state, not reproducing behaviour. C and F are nevertheless `FAIL_REPRODUCED` because the recovery half — *does the run resume when visibility returns* — was measured directly on a real stranded run, and the answer is no.

**Statuses were not inflated.** The one thing this matrix does **not** establish is that tab-switching *causes* the initial wedge; the observer found the run already wedged and measured its non-recovery. The causal step is `CODE`+`INFER`+`STORE` (§5, Q1).

---

## 4. Phase A.4 — Failure class and the five questions

### Classification

**Primary: `IMPLEMENTATION_BUG`.** Reconciliation of an in-flight `SubmissionOperation` is gated on the global submission authority holding an *identical* `logicalThreadId`, and `reconcile` has no path to re-establish authority. Whichever conversation most recently claimed authority therefore permanently blocks every other conversation's in-flight operations from being reconciled, while those operations remain non-terminal (`OBSERVED_ACCEPTED`) and their runs remain `ACTIVE` in an intermediate phase. Recovery exists (`recover`, which *does* take over by recency) but is reachable only when the content script's **volatile** `activeSubmission` is `null` — i.e. only after a reload/execution-context reconstruction — so a live tab cannot self-heal. The reducer already carries the matching escalation event (`AUTHORITY_CHANGED`, M1b) but nothing emits it.

**Secondary (structural, needs designer decision): the `READY_TO_GO`-has-no-driver gap** — `IMPLEMENTATION_DETAIL` layered on a contract question, not a standalone bug. It is not the cause of the observed symptom.

**Explicitly not** `PROVIDER_FACT`: nothing here depends on ChatGPT behaviour. **Not** `PRODUCT_TRADEOFF`: the wedged state is silent and indistinguishable from a healthy pause.

### Q1 — Is background-tab timer throttling only a trigger?

**Yes — it is an amplifier, not the root cause.** `LIVE`: with the tab returned to the foreground and observations restored to exactly 1 Hz for 90 s, the run did not advance. Throttling also cannot explain the wedge *mechanically*: the forward chain (steps 4→8 in §1) is `await`-driven and therefore immune to timer throttling, while the throttled drivers (1 s poll, 1.2 s watcher) are *recovery* drivers. Hiding therefore removes the ability to recover, and the recovery itself is broken regardless. `LIVE` negative control: `freeze`/`resume` were never emitted during the hidden interval, so the observed hidden behaviour was throttling, not freezing.

### Q2 — Is there a durable `READY_TO_GO` + no-future-driver stranded state?

**Yes, structurally — `CODE`.** `READY_TO_GO` has exactly one durable-state-driven resumer for AUTO runs, and it is scoped to `EVALUATING` only ([index.ts:1593-1595](src/content/index.ts)); a durable `READY_TO_GO` is surfaced to the Human as `[Send go]` ([index.ts:540-565](src/content/index.ts)) and nothing else drives it. **`NOT_VERIFIED` as an observed instance**: no live run was seen stranded at `READY_TO_GO`, and producing one would require driving a run (see §3).

### Q3 — After visibility returns, does the current code run BCR reconcile, or only refresh observation?

**It attempts reconcile once per second and cannot succeed.** `LIVE`: `opsRev` advanced +1/s for the whole foreground window (a `reconcile` call always writes, even when the outcome is `STILL_AMBIGUOUS` — [submission-operation.ts:345-353](src/core/submission-operation.ts)), while phase, consumed count, op state and authority generation were unchanged. The only things that visibly changed on return were the observation stream and two watcher-driven `CARRIER_PHASE` labels (`STABILIZING → ASSISTANT_GENERATING → STABILIZING`). `INFER`: the gate that refuses is [submission-operation.ts:273](src/core/submission-operation.ts) — `authority.logicalThreadId (6aaafaa9…) ≠ operation.logicalThreadId (6aa8bd9a…)` — which is evaluated **before** any evidence check, so the run's own evidence is never even read.

### Q4 — When content execution is reconstructed, can the AUTO run's continuation intent be recovered from durable state?

**The durable state is sufficient to derive the next action; the implemented reconstruction is not sufficient to act on it.** `CODE`: `Run(phase, consumed, pendingSubmissionOperationId, acceptedOperationId)` + `SubmissionOperation(state, dispatchFence, evidence)` + a fresh `CarrierObservation` fully determine what should happen next. But the only reconstruction path, `restoreActiveSubmission` ([index.ts:3309-3376](src/content/index.ts)), (a) runs only while `activeSubmission === null`, and (b) filters for `DISPATCHING | UNCERTAIN | OBSERVED_ACCEPTED` — so an op that already reached `COMPLETED` but whose run event was lost is unreachable (M2), and (c) even when it does run, hands off to the same authority-gated `reconcile`. A **reload** would clear `activeSubmission` and thus let `recover` take authority by recency — a falsifiable prediction, deliberately **not** tested because reloading the provider page is forbidden in this task. `PENDING_VALIDATION`.

### Q5 — Does the CDP target/session actually detach, or is the page still connected with execution throttled/frozen?

**The page target never detaches; execution is throttled, and reconstruction happens independently of detach.** `LIVE`: the harness held a CDP session to each page across the entire hidden interval and its `Runtime.evaluate` calls were served throughout — slowly (one 210 s control run showed consecutive drains ~60 s apart), never with a detached target. The content-script execution-instance identity was stable across hidden→visible (`exec=observer-a5a42e61-…`, `epoch=0`), so no reconstruction occurred during the observed window. `LIVE` (earlier capture in this investigation): on a single frame, isolated world `ctx 24` answered `chrome.storage` `NO` in 2 ms while `ctx 23` answered `YES` in 45 ms with live data — a new isolated world created while the previous one lingered invalidated, i.e. **execution-context reconstruction occurs while the target stays attached.**

---

## 5. Mechanisms

**M1 — authority contention strands the operation (live-reproduced; the mechanism that makes the reported wedge permanent).**
The global single-claim authority is held by whichever conversation claimed most recently (`ensureAuthority` replaces it when `sourceObservedAt` is newer — [submission-operation.ts:366-389](src/core/submission-operation.ts)). `reconcile` requires an exact match and never re-claims ([submission-operation.ts:272-284](src/core/submission-operation.ts)). `recover` *could* take over, but in the content script it is sent only from `restoreActiveSubmission`, which is skipped whenever `activeSubmission` is already set ([index.ts:3310](src/content/index.ts)) — and `reconcileActiveSubmission` never clears it on a `STILL_AMBIGUOUS` outcome ([index.ts:3378-3446](src/content/index.ts)). Net effect: a live tab whose run was reconciled by another conversation can never advance again, and switching back does not help. `LIVE` + `CODE` + `STORE`. **This is the same defect family as `futouyiba/noos-shuttle#56` / PR #57 (F1)**; this task adds that it also makes the run unrecoverable on return to the foreground, and that it is invisible to the Human rather than failing safe.

**M1b — the escalation event for exactly this condition already exists and is never emitted.**
The reducer defines `AUTHORITY_CHANGED` → `status = FAILED_SAFE`, `stopReason = "AUTHORITY_CHANGED"` ([continuation-run.ts:223-228](src/core/continuation-run.ts)), and it is unit-tested ([continuation-run.test.ts:162-163](tests/continuation-run.test.ts)). `grep -rn AUTHORITY_CHANGED src/` finds only the type union ([continuation-run.ts:17](src/core/continuation-run.ts)), the event type ([continuation-run.ts:63](src/core/continuation-run.ts)) and the reducer case — **no production path emits it**, and no path emits it for the authority-mismatch condition at all (`CODE`). So "the run has no escalation path" is imprecise: the contract already intends this escalation, and the gap is that nothing feeds it. This is the most contract-aligned minimal candidate fix, and it is why Phase B lists it first.

**M2 — `COMPLETED` op with a lost run event has no reconciler (code-level; not observed).**
If execution is interrupted between the durable op `COMPLETED` write ([index.ts:3418-3429](src/content/index.ts)) and the run `OPERATION_COMPLETED` apply ([index.ts:3434-3440](src/content/index.ts)), the run keeps `pendingSubmissionOperationId` pointing at an operation that is terminal, and `restoreActiveSubmission`'s state filter excludes `COMPLETED` ([index.ts:3323](src/content/index.ts)). No durable mapping from "op COMPLETED, run still pending" back to the run event exists. `CODE`. Its live manifestation was **not** verified.

**M3 — the designer's hypothesis: `EVALUATION_PASSED` → `READY_TO_GO`, then the volatile continuation to `issueRunGo` is lost (code-level; not observed).**
`EVALUATION_PASSED` is durable ([continuation-run.ts:198-202](src/core/continuation-run.ts)); the `issueRunGo` that follows is the tail of the *same* async call ([index.ts:1832-1834](src/content/index.ts)). If that call is destroyed between the two, the run is durably `READY_TO_GO` with no driver until a Human clicks `[Send go]` — which renders as a normal-looking "Ready" panel, not `FAILED_SAFE`. `CODE`. **Two corrections to the hypothesis as stated:** (a) because the chain is `await`-driven and not timer-driven, *ordinary* hidden-tab throttling does not interrupt it — only execution destruction (freeze/discard/reload) would; (b) in the live instance the run was **not** at `READY_TO_GO`, it was at `STABILIZING`, so M3 is not the cause of the observed symptom.

---

## 6. Phase B — Fix: stop condition reached, proposal only

**No extension code was modified in this task.** The candidate fixes change Authority/contract semantics or fail-safe policy, which the task brief puts behind an explicit stop condition; the remaining ones are partial or test-only. The decision belongs to the epic designer.

### M1b — emit the escalation event the contract already defines (strongest candidate, but sets policy)

1. **Emit `AUTHORITY_CHANGED` when reconcile is refused on a foreign authority.** The reducer already maps it to `FAILED_SAFE` with `stopReason = "AUTHORITY_CHANGED"` ([continuation-run.ts:223-228](src/core/continuation-run.ts)) and it is already unit-tested; nothing emits it today (M1b). This is the *least invented* option: it uses an existing, reviewed contract element rather than adding one, and it directly fixes the loudest part of the report — the run stops **visibly** instead of sitting in an intermediate phase forever. *Effect*: honest fail-safe. *Cost*: it does not restore liveness, and it makes a currently-silent state into a user-visible failure, so the threshold for "foreign authority" must be right or legitimately-active runs would fail safe spuriously.

### M1 — restoring liveness, but it changes Authority semantics → proposal

2. **Re-claim on reconcile (restores liveness).** Let the steady-state path re-establish authority when reconcile reports an authority mismatch, reusing the existing `recover` semantics (recency-based takeover) rather than requiring an exact match. *Effect*: a run whose conversation is revisited resumes and completes its round. *Cost*: authority changes hands more often, which is precisely the single-claimant question the designer is already adjudicating as **Q1 of #56** — implementing it here would pre-empt that ruling.
3. **Make the loss explicit instead of silent (`FAILED_SAFE`).** Conservative: the run stops visibly, nothing resumes. *Effect*: fixes the invisibility, not the liveness. *Cost*: fail-safe policy. (M1b above is the same idea, done through the contract's own existing event, and is preferable to inventing a new stop reason.)

Narrowest variant worth considering: clear the **volatile** `activeSubmission` when reconcile reports an authority mismatch, so the *existing, unchanged* `restoreActiveSubmission → recover` path can run on the next poll. It changes no stored semantics — but it changes *when* authority is taken over, so it is still a Q1/#56 dependency.

1 and 2 are close to complementary: 2 restores liveness and 1 makes any residual loss honest. The designer may reasonably want both.

### M2 — minimal, semantics-preserving, but partial

Extend `restoreActiveSubmission` to also consider an operation in `COMPLETED` whose run still has it pending, and re-apply `OPERATION_COMPLETED` to the run. This is additive reconciliation over already-durable facts and does not change what any state *means*. It is **partial**: it does not by itself deliver "AUTO liveness independent of the foreground", and it is entangled with M1 (the same authority gate). Recommend specifying it in the designer's decision rather than landing it alone.

### M3 — stop condition met: do not implement

Making `READY_TO_GO` auto-dispatch changes what state represents automatic authorization. **Concrete counterexample.** Suppose `READY_TO_GO` acquires an auto-dispatch driver:

- Round 1 is dispatched by `startBoundedRun`'s own async chain: it creates the run and then calls `await issueRunGo(app)` itself ([index.ts:1709](src/content/index.ts)). So round 1 is **not** Human-gated by a separate `[Send go]` click — it is gated by the Human pressing start and the chain reaching :1709. Today, if that chain is interrupted in that window, the run sits at `READY_TO_GO` and the Human can still see it and deliberately abandon it; `[Send go]` ([index.ts:1347](src/content/index.ts)) is the recovery. An auto-dispatch driver would instead **send** in that window — converting a silent, abandonable state into an unintended provider message and a consumed budget unit.
- `HUMAN_CONTINUE` also lands in `READY_TO_GO` ([continuation-run.ts:191-197](src/core/continuation-run.ts)) — the ASSISTED surface. Auto-dispatch erases the ASSISTED/AUTO distinction at the durable layer.
- A run interrupted between `EVALUATION_PASSED` and the dispatch claim would, on the next reconstruction, auto-send a second "go" for a round whose previous generation may still be streaming — a duplicate GO, violating single-in-flight, with the losing side consuming a budget unit it cannot refund.

Distinguishing *"AUTO has already durably authorized the next round"* from *"the Human must decide"* therefore requires a **new durable marker** (e.g. an authorization recorded together with the evaluator pass, with its own epoch, so a re-driven dispatch can prove it has not already been claimed). That is a contract change → designer decision.

### M4 — no designer decision needed

Injecting a `lock` in the four stale test files (or adding one shared setup file that defines `navigator.locks`) changes no product semantics and no stored contract. It is a test-infrastructure repair that any implementer can make unaided, and it should land **first**, because until it does, a fix for M1 or M3 has no working regression protection behind it.

### Designer questions

1. M1: may the steady-state reconcile path re-claim authority (recency takeover), or must a takeover remain exclusive to the dispatch/recovery paths? (Overlaps #56 Q1.)
2. M1b: may the content script emit the contract's existing `AUTHORITY_CHANGED` when reconcile is refused on a foreign authority — i.e. is a foreign-authority refusal the condition that event was written for? If yes, what is the correct threshold, so a legitimately-active conversation does not fail safe spuriously?
3. M2: is "op `COMPLETED` + run still pending" a case reconciliation must repair, or is it expected to be impossible by construction?
4. M3: may `READY_TO_GO` carry a durable AUTO authorization marker (a new epoch), with auto-dispatch permitted only when that marker is present and unconsumed?

---

## 7. Tests and verification

No extension code changed, so this is a baseline check at the base SHA rather than change verification. Commands run from the worktree with `--cache /tmp/npm-cache-noos-main`:

| Command | Result |
|---|---|
| `npm run typecheck` | **pass** (exit 0) |
| `npm run build` | **pass** — 41 modules, `dist/assets/service-worker.js` 163.25 kB, `dist/assets/content.js` 168.68 kB, 1.10 s |
| `npm test -- --exclude tests/content-ui-smoke.test.ts` | **fail at the base SHA — 27 failed / 459 passed (4 of 38 files)**, pre-existing and unrelated to this task |

### The base SHA's test suite is red — separate pre-existing defect (M4)

Reproduced twice, including with both files added by this task removed from the tree (clean tree, identical 4 files / 27 tests failing). Root cause, `CODE`:

`withSubmissionAuthorityLock` ([submission-operation.ts:462-467](src/core/submission-operation.ts)) requires either an injected `lock` option or `globalThis.navigator.locks`, and throws `submission_authority_unavailable` when neither is present. Vitest runs with `environment: "node"` ([vite.config.ts:45-48](vite.config.ts)), which has no `navigator.locks`. Four test files construct a submission store **without** injecting `lock`:

| Test file | `lock:` injections | At base SHA |
|---|---|---|
| `tests/deliver-child-result.test.ts` | 0 | 6 failed |
| `tests/delivery-runtime.test.ts` | 0 | 14 failed |
| `tests/background-observation.test.ts` | 0 | 2 failed |
| `tests/background-continuation-run.test.ts` | 0 | 5 failed |
| `tests/submission-operation.test.ts` | 14 | pass |
| `tests/goal-reanchor.test.ts` | 1 | pass |
| `tests/goal-reanchor-runtime.test.ts` | 7 | pass |

The failing set is exactly the four zero-injection files.

**Decisive confirmation.** Supplying a conforming `navigator.locks` from a temporary vitest setup file — no other change — removes all 27 failures; the dominant error signature (`submission_authority_unavailable`, from `submission-operation.ts:465`) disappears entirely, and the remaining 5 (`background-continuation-run.test.ts`) were an artifact of the probe's own `request` arity: with the two-argument call shape Chrome also accepts, **the whole suite passes**. Note the two runs are not the same test set: the base run used `--exclude tests/content-ui-smoke.test.ts` (38 files / 486 tests), while the confirmation run deliberately dropped the exclusion (39 files / 514 tests, 486 + 28 = 514). The scratch probe config and setup file were deleted afterwards; the tree contains only the two files this task adds.

**Impact.** No live product impact is demonstrated: Chrome content scripts and MV3 service workers both have `navigator.locks`, and the live dogfood instance reconciles normally. The real cost is that **the release-parity test command fails on `main`**, so the authority/continuation subsystem currently has no green regression protection — which is exactly the subsystem M1 and M3 live in, and it means any future fix in this area has no working guard rail until M4 is repaired. Classified `IMPLEMENTATION_DETAIL` (test infrastructure), reported separately from the M1 defect; not part of the background-dependence failure.

The harness itself is a read-only Node script: it opens no new dependencies, sends no provider message, and writes only to `--out`.

**Regression coverage proposed for the eventual fix** (not added here, since no fix was implemented): repair M4 first (inject a `lock` in the four files, or add a shared setup file); then a suspended-driver regression test; `EVALUATION_PASSED → READY_TO_GO` followed by execution interruption; auto-reconcile after reconstruction; duplicate resume callbacks not producing duplicate dispatch; and a no-regression check on the all-foreground path.

---

## 8. Final report

1. **Exact base SHA**: `570331278f54d5c54d00771c03d5f1302aa6bb72`.
2. **Reproduction result**: the *recovery* half is reproduced — `FAIL_REPRODUCED`. A live AUTO_X5 run stranded at `ACTIVE/STABILIZING` 1/5 did not advance after its tab was returned to the foreground and kept at a restored 1 Hz observation cadence for 90 s. The *trigger* half (switch-away causes the wedge) is not reproduced, because driving it requires sending the provider a "go" message (forbidden here); scenarios B, D, E, H are `NOT_VERIFIED`.
3. **Failure edge**: `reconcile` of an in-flight `SubmissionOperation` when `noosSubmissionAuthority.logicalThreadId` differs from the operation's `logicalThreadId` — [submission-operation.ts:273](src/core/submission-operation.ts) — evaluated before any evidence, with no re-claim path in the content script while `activeSubmission` is set ([index.ts:3310](src/content/index.ts)).
4. **Root cause**: single global submission authority + authority-gated reconciliation that never re-establishes authority + recovery reachable only through the volatile `activeSubmission`. A conversation that claims authority permanently blocks every other conversation's in-flight operation; the run then waits forever in an intermediate phase. It never fails safe because the two escalation routes both miss it: the watcher escalates only on `BROKEN` ([continuation-run.ts:141-145](src/core/continuation-run.ts)), and the contract's own `AUTHORITY_CHANGED` event (M1b) is defined and tested but never emitted.
5. **Classification**: primary `IMPLEMENTATION_BUG` (M1, same family as #56/PR #57 F1); secondary structural `IMPLEMENTATION_DETAIL` on a contract question (M3); M2 `IMPLEMENTATION_BUG`, minor. Explicitly not `PROVIDER_FACT`, not `PRODUCT_TRADEOFF`, and **not** a timer-throttling problem.
6. **Instrumentation evidence**: [`scripts/bcr-bg-timeline.mjs`](scripts/bcr-bg-timeline.mjs) plus the captures in §2 — the durable transition that committed (`OPERATION_ACCEPTED`, op → `OBSERVED_ACCEPTED`, run → `STABILIZING`) and the one that never did (`OP_COMPLETED` → `OPERATION_COMPLETED` → `EVALUATING`), with `opsRev` +1/s proving a once-per-second reconcile attempt that changes nothing.
7. **Code modified**: no. No extension source file was touched. One new read-only diagnostic script was added: `scripts/bcr-bg-timeline.mjs`.
8. **If modified**: not applicable. Semantic diff: none. (`scripts/bcr-bg-timeline.mjs` is new, read-only, sends no provider message, and is the only file added.)
9. **Tests**: `npm run typecheck` pass; `npm run build` pass; `npm test` **fails at the base SHA with 27 failed / 459 passed**, a pre-existing defect (M4: four test files do not inject the `lock` that `withSubmissionAuthorityLock` requires, and the node test environment has no `navigator.locks`). Supplying `navigator.locks` removes all 27 failures and makes the suite fully green (39 files / 514 tests — a different file set from the base run, which excluded `content-ui-smoke`), confirming M4 is the sole cause. M4 is reported separately and is not part of the background-dependence failure; it is worth fixing first, because it means this subsystem has no working regression protection today.
10. **Designer needed**: **yes.** M1's fix changes Authority semantics (and overlaps #56 Q1); M3 hits the brief's explicit stop condition (it changes what `READY_TO_GO` represents and whether it may auto-dispatch). Four questions are put to the designer in §6.
11. **Ready for independent review**: yes, as a diagnosis-and-proposal artifact — with the explicit caveat that scenarios B, D, E and H carry `NOT_VERIFIED` status and are not claimed as reproduced.

---

## 9. Review record

| Round | Reviewer | Verdict | Head | Integrated |
|---|---|---|---|---|
| 1 | independent reviewer, read-only toolset, model `fable` | `REQUEST_CHANGES` (6 findings, all `NON_BLOCKING`) | `45d4ed04b0a15ff55f7a95b3db90ba90b15271d0` | §0/§5 causal claim tightened to match §3; **M1b added** (`AUTHORITY_CHANGED` is dead code, now the first Phase B candidate); §7 table corrected to three `lock`-injecting files and the two runs' differing file sets stated; M3 counterexample bullet (a) corrected against `index.ts:1709`; §9 content-disclosure scoped to the new harness and `state-dump.txt` disclosed; §0 refined so authority takeover requires an active claim, not activity |
| 2 | same reviewer (incremental) | see PR thread | — | — |

Round 1's own verified/unverified breakdown: the M1 code chain, M2, M3 (four `issueRunGo` sites, none durable-state-driven; only `EVALUATING` auto-resumes on load), the `LIVE` capture from the saved logs, the M4 counts and the typecheck result were independently re-derived and confirmed. The reviewer could not re-drive Chrome (no re-execution of the foreground experiment) and did not re-run the `navigator.locks` confirmation or the build.

---

## 10. Evidence index

| Artifact | Path |
|---|---|
| Timeline harness (new, read-only) | `scripts/bcr-bg-timeline.mjs` |
| 210 s capture log (hidden baseline → foreground return → 90 s foreground) | `/tmp/bcr-cdp/timeline-6.log`, `timeline-6.jsonl` |
| Ledger-write sampler | `/tmp/bcr-cdp/sample-revision.mjs` |
| Op ↔ authority identity dump | `/tmp/bcr-cdp/dump-op-authority.mjs` |
| Visibility-transition driver (`Page.bringToFront` only) | `/tmp/bcr-cdp/bring-front.mjs` |
| Earliest (stalled) captures, kept for contrast | `/tmp/bcr-cdp/timeline-1.log`, `timeline-2.log` |

Captures are kept outside the repository: they contain live conversation reference prefixes from the dogfood browser.

**Content-handling disclosure.** The scripts written for *this* task — `scripts/bcr-bg-timeline.mjs`, `sample-revision.mjs`, `dump-op-authority.mjs`, `bring-front.mjs` — record only counts, opaque ids, and refs sliced to 8 characters; none reads or stores prompt or assistant text. One earlier artifact from the same investigation, `/tmp/bcr-cdp/state-dump.txt` (16 KB, outside the repository), does contain **short excerpts of assistant messages** from the observed conversations, used to identify which conversation a stranded run belonged to. No complete conversation, and no user-authored prompt text, was captured anywhere; that file is not committed and is not an input to any claim in this report. It should be deleted when the investigation is closed.
