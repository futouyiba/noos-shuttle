# Implementation Slice 1: Submission Operation Ledger

> Authority: `futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1` (Issue #5 inputs; transport-only ledger scope).
> Verdict: **IMPLEMENTED for Issue #5 scope.** Durable on `main` via integration merge `59ad928` (lineage includes `codex/issue-5-slice-1` @ `1ceb401`; closed-unmerged PR #6 head `codex/issue-5-slice-1-ledger` @ `d4cb00f` was superseded and is not on `main`). Focused suites: `tests/submission-operation.test.ts` (47 tests), `tests/human-go-runtime.test.ts` (8 tests). Remaining before Issue #5 closure: one real end-to-end dogfood round; canonical binding/lease ownership stays with the later reducer slice, as stated below.

This implementation covers the transport ledger and Human GO boundary for
Issue #5. It does not implement canonical binding mutation, lease transfer,
automated continuation, worker/reviewer lifecycle, or child-result delivery.

## Authority boundary

Browser contexts do not perform ledger mutations directly when the extension
runtime is available. `SubmissionOperationMutation` requests are sent to the
background service worker. The worker owns one coordinator ledger and applies
`prepare`, `claim`, `record`, `rearm`, and `reconcile` in one reducer path.

`HumanGoRuntime` requires a current carrier snapshot with `READY`,
`CONTINUE`, a verified provider conversation, and a matching
`DispatchFence`. It initializes a persisted, generation-numbered authority
for the current execution instance, creates a stable-ID `GO` operation,
persists `PREPARED`, re-reads the carrier, claims the fence, and only then
invokes the provider dispatch callback. A newer source observation may rotate
the authority after reload or navigation; a delayed older execution instance
cannot rotate it back. A dispatch exception records `UNCERTAIN`, including
retry after a lost record response; it cannot create `FAILED_SAFE`.
Reconciliation remains an explicit follow-up operation and accepts only a
fresh observation after `dispatchClaimedAt` with the current provider,
binding, lease, source epoch, and carrier fence.

The ChatGPT content adapter uses this ordered boundary for the generate,
handoff-generation, and crystal-generation actions. It waits for a real
browser-tab carrier and READY observation, prepares and claims through the
background mutation channel, then inserts into the provider composer and
submits. Subsequent runtime observations carry the claimed fence into
reconcile; `PROVEN_ACCEPTED` is followed by a persisted
`OBSERVED_ACCEPTED → COMPLETED` record before the in-memory active operation
is cleared. A newly started content script asks the coordinator for durable
`DISPATCHING`, `UNCERTAIN`, or `OBSERVED_ACCEPTED` operations for its current
browser-tab/provider identity, restores the newest matching fence, and
reconciles it before another GO can proceed.

An accepted operation remains open while the provider is still generating.
Completion requires an explicit `generationActive: false` observation and a
two-second stable window after the claim and the last observed quiet point.
An unchanged inactive carrier becomes `FAILED_SAFE` only with that stable
window, a dispatch receipt, or explicit provider failure evidence. Observations
are monotonic by observation time and carry the current head, last-user, and
last-assistant fingerprints; a `GO` observation must still identify the
submitted payload as the current last user message, so a concurrent human
message cannot be mistaken for the operation's result.

The coordinator's Chrome storage adapter wraps each read, reduction, and write
in the exclusive `navigator.locks` lock
`noos-submission-operation-authority`. It also increments
`noosSubmissionOperationsRevision` on every committed mutation. A caller only
receives a dispatch result after the state has been persisted. Claim failure,
worker restart, or a lost response is fail-closed and never authorizes a blind
retry.

Chrome storage does not expose a conditional compare-and-set primitive for
arbitrary JSON values. The version key is therefore a durable commit marker
and audit fence; mutual exclusion is provided by the single coordinator and
the browser lock. Direct writes that bypass this adapter are outside the
supported authority path and are not treated as valid ledger mutations. The
`HumanGoRuntime` receives binding and lease facts from its caller; canonical
binding/lease ownership still belongs to the future Harness reducer slice.

## Recovery and identity rules

- `PREPARED` is persisted before a caller can request a claim.
- Only `PREPARED → DISPATCHING` grants actuation; an already claimed operation
  returns no claim to a second caller.
- `DISPATCHING`, `UNCERTAIN`, and `OBSERVED_ACCEPTED` are reloaded after a
  coordinator restart and must be reconciled before another operation is
  claimed for the same carrier.
- `COMPLETED`, `FAILED_SAFE`, and `CANCELLED` are terminal and cannot be
  revived by stale observations.
- `UNCERTAIN` cannot be re-armed directly. Only reconciliation evidence that
  proves not accepted creates `FAILED_SAFE`, after which a fresh baseline may
  re-arm the operation.
- Reconciliation requires both the operation and observation to carry the same
  verified provider conversation identity and dispatch fence, with observation
  time newer than the persisted claim time and source epoch matching the
  current authority.
- Authority records have an explicit lifecycle generation and source
  observation timestamp. Reloaded or newly navigated content can establish a
  newer authority; an older execution instance or source observation cannot
  replace it.
- A reconciliation observation without an explicit `generationActive` value
  cannot prove acceptance or non-acceptance and remains `UNCERTAIN`.
- An accepted operation may only refresh its completion evidence when the
  current conversation, route, payload fingerprint, fence, and source epoch
  still match; mismatched recovery observations are ignored.
- Re-arm requires the latest persisted `FAILED_SAFE` reconciliation evidence
  to match the operation's prior baseline, provider identity, and dispatch
  fence, plus a newer matching baseline from the current carrier.
- Reusing an operation id with a different carrier or payload fingerprint is
  rejected, including across separate contexts.

The behavior is covered by
`tests/submission-operation.test.ts`, including concurrent create-or-get,
cross-context claims, coordinator failure, lost claim responses, terminal
state protection, and provider identity absence.
