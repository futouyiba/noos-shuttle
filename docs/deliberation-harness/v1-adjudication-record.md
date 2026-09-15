# V1 Adjudication Record — 2026-09-15

> Two implementation-design conflicts were adjudicated (verdicts relayed via the
> operator, treated as final). Authority baseline moves to
> `futouyiba/noos_docs @ a49303cabf436f3398a596685d36d2792e6a08a1`, which adds
> `current-conversation-binding-contract-v1`,
> `conversation-binding-reducer-operations-v0`, and
> `child-result-delivery-idempotency-contract-v0`.
> Supersedes proposals
> `v1-design-proposal-result-delivery-lane.md` and
> `v1-design-proposal-reducer-model.md`.

## Decision 1 — DELIVER_CHILD_RESULT: A / with specialized projection

The canonical transport lifecycle is `SubmissionOperation(kind=DELIVER_CHILD_RESULT)`.
`ResultDeliveryKey` + `ResultDeliveryReceipt` are a unique index plus a
recipient-side receipt projection that reference the owning
`submissionOperationId`. There is no second transport protocol and no second
authoritative ledger ("two tables at most, one protocol").

Frozen relations:

- `PREPARED != UNCERTAIN != INSERTED`. Waiting for a safe carrier is
  SubmissionOperation PREPARED with no receipt; a receiptless index row is
  allowed.
- `OBSERVED_ACCEPTED → INSERTED` receipt (minted once; replay of the same key
  must never insert again). OBSERVED_ACCEPTED remains execution-owning: no
  route re-resolution between INSERTED and COMPLETED.
- `COMPLETED → COMPLETED` receipt; the parent mechanical
  `WAIT_REVIEW/WAIT_WORKER` clears here, which is not semantic acceptance (no
  REVIEW_ACCEPTED states, §14).
- Logical delivery identity (key) is stable; the concrete
  conversation/generation/carrier lives only in the transport's DispatchFence
  per attempt. Parent rollover before the dispatch claim re-resolves the
  destination; after OBSERVED_ACCEPTED it must not.

Implementation: `0fd2de1` (result-delivery projection + child-return
composition).

## Decision 2 — HarnessReducer: authoritative Operational State Reducer (third model)

Neither "HarnessReducer = Execution Journal" nor plain State Store: it is the
State Store's operational/control-state reducer (the binding-reducer contract
formally extends the delta taxonomy with `commit_current_conversation_binding`,
`transfer_actuation_lease`, `claim_submission_dispatch`). A separate
Provider Execution Journal records what actually happened.

Required work on the reducer line:

1. Delta-contract completeness: `delta_id` + fingerprint, ApplyResult,
   audit/transition record, crash-consistent apply, idempotent replay
   (same delta returns the original result), version/concurrency token.
2. New operation `settle_submission_operation(operation_id,
   expected_current_state, expected_dispatch_fence, target_state ∈
   {OBSERVED_ACCEPTED, COMPLETED, UNCERTAIN, FAILED_SAFE, CANCELLED},
   execution_evidence_ref, reason)` — validates operation + fence, rejects
   stale evidence, keeps terminal states irreversible, durable ApplyResult,
   replay-safe. `claim_submission_dispatch` grants execution authority;
   `settle_submission_operation` advances/releases it (closes the permanent
   execution-owner gap).
3. Rename `HarnessReducer` → `HarnessControlStateReducer` (or
   OperationalStateReducer); journal artifacts use their own names
   (ExecutionJournalEntry / DispatchAttemptRecord / ProviderObservationRecord /
   ReconciliationEvidence), never "ApplyResult".
4. Journal idempotency key: `(operation_id, dispatch_fence_fingerprint,
   event_kind)` — prevents double bookkeeping, not double provider actuation
   (that stays persist-PREPARED → atomic claim → fence → one blind dispatch →
   reconcile).
5. Semantic run-state handlers (commit_decision, open_question, …) remain
   NOT_IMPLEMENTED; long-term they share one AuthorizedDeltaApplyKernel with
   the operational handlers.

Identity map (never merged): `delta_id` = which local state apply;
`operation_id` = which logical submission; `DispatchFence` = which
carrier-generation attempt is authorized; execution attempt id = which
recorded side effect.

## Effect on existing slices

- Result-delivery slice: PARTIAL_ACCEPT → conformed in `0fd2de1`.
- Reducer/durable-reducer slices: domain ACCEPT, protocol completeness REWORK
  (items 1-3) — queued as the next slices.
- Provider Execution Journal: new module, does not own binding/lease/
  SubmissionOperation canonical state.
