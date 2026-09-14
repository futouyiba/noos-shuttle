# Goal Re-anchor rollover event source and durable recovery

This slice continues the reviewed Goal Re-anchor production wiring (`49d5eda`) with the remaining production event source and persistence recovery that do not depend on the child/reviewer lifecycle slices. It is based directly on `codex/goal-reanchor-next` (`49d5eda`); no branch merge or push is performed.

## Design basis

- Walkthrough v1 Step 4: re-anchor is eligible at configured N or on compaction, **rollover**, Review return, scope correction, or Sedimentation return; "post-rollover event runs against the new current binding epoch"; the anchor is its own persisted submission operation and must obey UNCERTAIN reconciliation.
- Final E2E confirmation §2 step 5 and §4 "Rollover vs in-flight execution": `DISPATCHING`, `OBSERVED_ACCEPTED`, and `UNCERTAIN` block binding/lease movement; `PREPARED` has no dispatch authority and becomes stale against the old generation after rollover; restart recovery must never produce a duplicate logical delivery.

## What this slice adds

1. **Rollover trigger production.** The anchor record now persists the durable Work Item binding observed by the last probe. When the active Work Item's binding commits to a different provider conversation (both non-empty), the next probe raises the anchor with trigger `rollover` regardless of the sparse counter, and the anchor executes against the current (new) binding because the probe context is matched against the Work Item binding before anything else runs. The signal is one-shot: the persisted binding snapshot updates after every probe.

2. **Binding/payload-scoped transport identity.** The submission operation backing an anchor is now identified as `reanchor:{thread}:{targetRevision}:{conversation}:{carrier}:{payloadFingerprint8}` (plus an `:aN` suffix when a previous attempt at the same binding and payload retired an id). The goal-side operation durably records `submissionOperationId` and `supersededSubmissionOperationIds`, so restart recovery can always find the authoritative transport without scanning.

3. **Fail-closed recovery.** Before raising or executing anything, the probe checks the pending anchor's recorded transport:
   - `COMPLETED` (even if reconciled by another runtime instance) closes the anchor cycle and resets the counter;
   - `DISPATCHING` / `UNCERTAIN` / `OBSERVED_ACCEPTED` — including on a superseded old binding — returns `RECONCILE_REQUIRED` and never dispatches a second transport for the same anchor;
   - an execution-owning operation on the current carrier (any kind, e.g. an in-flight GO) returns `BLOCKED_BY_EXECUTION` (one active submission per carrier).
4. **Stale transport supersession.** A recorded transport in `PREPARED` / `FAILED_SAFE` / `CANCELLED` state, or missing, has no dispatch authority: when the binding or payload moved (or the fresh probe baseline/fence can no longer prepare against it, since `prepare` is create-or-get over full operation identity), the anchor rotates to a fresh binding-scoped transport and durably supersedes the old id. The stale transport stays untouched in the ledger for audit; exactly one transport is authoritative per anchor at any time.
5. **In-place re-arm.** When the recorded transport is `FAILED_SAFE` on the current fence, the probe re-arms the same transport identity with the fresh baseline (the ledger's `rearm` validates the proven-not-accepted evidence and the newer matching baseline) instead of rotating identity; only a rejected re-arm falls back to a fresh transport.

## What this slice deliberately does not do

- `compaction`, `review_return`, and `sedimentation_return` producers remain unwired vocabulary: compaction has no observable provider signal in the current DOM adapter, and review/sedimentation returns require the reviewer/child lifecycle slices. The core already accepts these triggers.
- Canonical binding/lease generations (Reducer `commit_current_conversation_binding` / `transfer_actuation_lease`) remain with the integration work; `bindingEpoch` today is the carrier observation source epoch, as in `49d5eda`.
- An `UNCERTAIN` anchor transport whose conversation is gone (e.g. closed after rollover) cannot reconcile and keeps the anchor pending by design ("ambiguity pauses"); there is still no cancel path for a pending anchor — that belongs with the Reducer slice.

## Validation

- `npm run typecheck` passed.
- Full suite: 18 files / 162 tests passed, including the built-bundle browser smoke (`tests/content-ui-smoke.test.ts`) which loads the real content and service-worker bundles with only Chrome APIs and the provider DOM simulated.
- New coverage in `tests/goal-reanchor-runtime.test.ts`: rollover trigger below N against the new binding with one-shot semantics; `RECONCILE_REQUIRED` fail-closed while the old-binding transport is `UNCERTAIN`; supersession only after proven non-acceptance (`PROVEN_NOT_ACCEPTED` → `FAILED_SAFE`) with the stale transport retained; in-place `rearm` keeping a single transport identity across a failed then successful dispatch; `BLOCKED_BY_EXECUTION` while an in-flight GO holds the carrier followed by execution after it completes; anchor-cycle closure when the pending transport is completed by external reconciliation; binding-scoped transport ids recorded durably. New core coverage in `tests/goal-reanchor.test.ts`: `noteSubmissionOperation` rotation/supersession bookkeeping, idempotent re-note, completed-operation rejection, and `normalizeState` rejection of a submission identity that is both current and superseded.
- `npm run build` and `npm run package:extension` passed.
- Independent review: APPROVE with no blocker/major findings; the single minor finding (missing committed coverage for the blocked/externally-completed recovery branches) was addressed by the follow-up test commit.
