# W11 Design Note — The Control-State Settle Hop and Fence-Number Minting

> Scope note for the final wiring slice. The pieces (durable
> OperationalStateReducer with applyDelta/settle, ProviderExecutionJournal,
> settleFromEvidence glue) are all implemented and independently reviewed;
> what remains is making them live in one runtime flow. One identity question
> must be answered first — this note frames it.

## The seam

The adjudication's two-step flow ends with the control-state reducer settling
an operation from journal evidence. For the delivery runtime that means, in
lockstep with the submission ledger:

1. restore the durable reducer (chrome storage bundle);
2. ensure the binding (commitCurrentConversationBinding for the parent thread)
   and the actuation lease (transferActuationLease to the probing carrier);
3. seed the reducer operation for the delivery and claim the dispatch permit
   (claimSubmissionDispatch) before the carrier dispatch;
4. settle from journal facts (settleFromEvidence) as acceptance/completion
   evidence lands.

Steps 2–4 only cohere if the reducer's fence numbers and the submission
ledger's fence numbers agree — settleFromEvidence maps by field renaming
(bindingEpoch ≡ bindingGeneration), not by re-numbering.

## The open question: who mints the generation numbers?

Today the two sides number independently:

- the ledger's `bindingEpoch`/`leaseGeneration` come from the probe context
  (observation `sourceEpoch` and runtime counters — the reanchor precedent);
- the reducer's `bindingGeneration`/`leaseGeneration` are its own monotonic
  counters (binding commit = previous+1; lease transfer = previous+1).

They coincide only by fixture construction; nothing at runtime aligns them.
Three candidate resolutions:

- **A. Reducer mints (adjudication-intent reading).** The runtime drives the
  reducer FIRST (binding, lease), derives the fence from the reducer's
  returned generations, and builds the ledger claim context from those
  numbers. The reducer is the authority that grants execution; the ledger
  fence is a projection of that grant. Cost: the probe context construction
  changes (content no longer supplies bindingEpoch from sourceEpoch for the
  delivery lane), and the reducer's restore must be robust to the worker
  restart window.
- **B. Ledger mints, reducer adopts.** The reducer's seedOperation accepts
  the ledger's fence numbers (seed is already unconstrained on generations);
  binding/lease are committed with expectation fences derived from whatever
  the reducer already holds, and claim uses the ledger-minted numbers. Cost:
  the reducer's monotonic generation story gets an external feed — reverse
  conflicts and rollback guards need care.
- **C. Keep the lanes separate for V1.** The control-state reducer stays
  unwired at runtime (its reviewed pure modules + the settle glue remain),
  the delivery flow keeps running entirely on the submission ledger, and the
  settle hop is documented as the V1→V2 bridge. Cost: the adjudication's
  two-step flow is implemented but not exercised end-to-end.

## Recommendation

**A**, scoped to the delivery lane only (a new runtime step before the
carrier dispatch; the reanchor lane keeps its context-derived fences until it
migrates). It matches the adjudication's direction — the reducer decides who
may execute — and it exercises applyDelta, settle, the journal, and
settleFromEvidence in one live flow, which is the last unverified stretch of
the adjudicated architecture.

This note is the design proposal; per the operating rule, the choice (A/B/C or
an alternative) should go to ChatGPT before W11 is implemented.
