# V1 Adjudication Record — Control-lane FAILED_SAFE / Re-arm (2026-09-15)

> Narrow control-lane closure on top of the W11 three-identity model; the V1
> architecture is not reopened.

## Q1 — CONFIRM: every claim after a FAILED_SAFE attempt mints a new fence id

W9's "same fence" is restated as **same authority components**, never the same
execution-attempt identity (F17 ≠ F18 even when the components are identical).

## Q2 — Option A′: `rearm_submission_dispatch` on the same control operation

No successor operation (`:a2`) — that would fold attempt identity back into
operation_id against the frozen three-identity model. FAILED_SAFE is
re-termed **attempt-terminal / rearmable** (not logical-operation terminal;
COMPLETED and CANCELLED stay logical-operation terminal).

Contract: input carries operation_id, expected_operation_revision,
expected_failed_dispatch_fence_id, proven_not_accepted_evidence_ref,
next_authority (conversation/binding_generation/carrier/lease_generation),
actor, now. The reducer atomically validates existence, FAILED_SAFE state,
revision CAS, fence-id match, evidence ref, **next_authority == canonical
current binding AND lease**, and no conflicting execution owner. Success:
state=PREPARED, revision+1, dispatchFence=null, dispatchClaimedAt=null, and
the operation's next-attempt metadata updates to next_authority. **Re-arm
does not mint F18 — only the subsequent claim does.**

## Q3 — Rollover first, re-arm second; one primitive for W9 and W10

Re-arm may change the operation's components only to a canonical authority
already established by independent binding/lease transitions; it must never
perform rollover itself. Same API covers same-destination (components
unchanged) and retarget (components moved). Recommended runtime order:
journal proves not accepted → transport settle FAILED_SAFE → control settle
FAILED_SAFE → [retarget: control binding/lease rollover] → transport re-arm/
retarget → control rearm → claim (mints F18). Transport readiness first,
authoritative control re-arm last — the conservative crash direction.

## Q4 — Keep RECONCILIATION_EVIDENCE; tighten the semantic predicate

No PROVEN_NOT_ACCEPTED event kind (evidence kind ≠ reconciliation outcome).
Settle-to-FAILED_SAFE and re-arm must verify RECONCILIATION_EVIDENCE whose
durable payload carries outcome=PROVEN_NOT_ACCEPTED and belongs to the exact
prior dispatch_fence_id.

## Final invariants

same attempt → same dispatch_fence_id; new safe retry → new
dispatch_fence_id; same logical submission → same operation_id; every
authority-state mutation → operation_revision advances.
