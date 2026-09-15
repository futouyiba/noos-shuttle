# NOOS Deliberation Harness — Escalation Reducer Operations v0

> Status: Working Design Contract / automatic-resume prerequisite
>
> Extends: `cross-agent-handoff-escalation-contract-v2.md`
>
> Precedent: `conversation-binding-reducer-operations-v0.md`
>
> Purpose: formalize the authoritative local mutation boundary for Work Item Authority Basis and Escalation lifecycle state.

## 0. Core rule

This document does **not** create a new authority system.

All operations are governed state transitions:

```text
Proposal
→ Authority / Promotion Policy
→ Authorized Delta
→ Reducer-equivalent atomic apply
→ ApplyResult + Audit Record
```

The LLM/adapter may propose. It may not directly mutate the canonical Work Item authority pointer or Escalation lifecycle.

## 1. Canonical state owned by this extension

Conceptually:

```text
CrossAgentControlState
- work_item_authority_basis_pointers: Map<work_item_id, authority_basis_ref>
- authority_basis_snapshots: Map<authority_basis_id, AuthorityBasisSnapshot>
- escalations: Map<escalation_id, Escalation>
- escalation_resolution_records: Map<resolution_id, EscalationResolutionRecord>
```

A conforming implementation may store these physically elsewhere, but it must provide equivalent serialized/crash-consistent semantics.

## 2. Shared idempotency semantics

Every authorized mutation has:

```text
delta_id
delta_fingerprint
base/control expectations
```

Same `delta_id + same fingerprint` replay after a successful apply:

```text
→ return the original persisted ApplyResult
→ do not apply again
```

Same `delta_id + different fingerprint`:

```text
→ rejected_invariant
```

This is the same State Delta replay principle used elsewhere in V1.

## 3. `commit_work_item_authority_basis`

### Purpose

Create a new immutable `AuthorityBasisSnapshot` and atomically make it the canonical current basis for one Work Item.

### Input

```text
work_item_id
expected_current_authority_basis_ref: ref | null
new_authority_basis_snapshot
transition_authority_ref
actor
now
```

### Preconditions

- expected pointer equals canonical current pointer;
- new snapshot belongs to the same Work Item;
- new snapshot has a new stable ID and immutable fingerprint;
- if replacing an existing basis, `supersedes_authority_basis_id` points to the current basis;
- transition is authorized by the existing State/Scope/Decision authority policy;
- monotonic/audit invariants pass.

### Apply

Atomically:

```text
persist immutable AuthorityBasisSnapshot
set WorkItem.current_authority_basis_ref = new snapshot ref
persist ApplyResult / AuditRecord
```

A repo HEAD movement alone is not a valid invocation.

### Race behavior

Two concurrent rebases from the same expected basis cannot both commit. The loser is stale and must rebase its proposal.

---

## 4. `open_escalation`

### Purpose

Persist the blocking coordination fact **before** any cross-agent transport.

### Input

```text
escalation
expected_current_authority_basis_ref
actor
now
```

### Preconditions

- `escalation.status == OPEN`;
- `lifecycle_revision == 0`;
- semantic fields are complete/valid;
- `authority_basis_ref` equals the current Work Item authority basis at open time;
- source operation/work item exists;
- stable `escalation_id` is unused, or create-or-get identity matches exactly.

### Apply

```text
persist immutable Escalation semantic content
status = OPEN
lifecycle_revision = 0
persist ApplyResult / AuditRecord
```

Only after successful apply may HandoffPacket transport begin.

### Create-or-get

```text
same escalation_id + same immutable fingerprint
→ return existing OPEN/terminal record

same escalation_id + different immutable fingerprint
→ rejected_invariant
```

---

## 5. `supersede_escalation`

### Purpose

Replace one semantic question with another without creating a moment in which a still-runnable source operation has no blocker.

### Input

```text
old_escalation_id
expected_old_lifecycle_revision
new_escalation
expected_current_authority_basis_ref
supersession_basis_ref
actor
now
```

### Preconditions

- old escalation is OPEN;
- old lifecycle revision matches;
- new escalation is OPEN revision 0;
- new `source_operation_ref` is the same source operation;
- `new.supersedes_escalation_id == old_escalation_id`;
- current Work Item authority basis matches expectation;
- supersession basis is authorized/valid.

### Apply — one atomic transaction

```text
persist new OPEN escalation
old.status = WITHDRAWN
old.withdrawal_reason = SUPERSEDED
old.superseded_by_escalation_id = new.escalation_id
old.lifecycle_revision += 1
persist ApplyResult / AuditRecord
```

There is no intermediate durable state where the old blocker is withdrawn before the successor exists.

### Replay

Same authorized delta returns the original apply result and the same pair of escalation identities.

---

## 6. `resolve_escalation`

### Purpose

Clear an OPEN blocker only after source-side ResolutionPolicy has validated an immutable result against the **current** Work Item Authority Basis.

### Input

```text
escalation_id
expected_lifecycle_revision
expected_current_authority_basis_ref
result_id
result_fingerprint
candidate_resolution_record
resolution_policy_ref / version
validation_evidence_refs[]
actor
now
```

### Preconditions

- escalation exists and is OPEN;
- lifecycle revision matches;
- canonical Work Item authority basis equals the expected ref;
- result ID/fingerprint is an immutable known result targeting this escalation;
- ResolutionPolicy passes all v2 mandatory checks;
- candidate ResolutionRecord fingerprints the exact result/basis/evidence used;
- no known conflicting sufficient candidate requires higher authority.

### Apply — one atomic transaction

```text
persist immutable EscalationResolutionRecord
escalation.status = RESOLVED
escalation.resolution_record_id = resolution_id
escalation.resolved_at = now
escalation.lifecycle_revision += 1
persist ApplyResult / AuditRecord
```

### Idempotent resolution receipt

In addition to ordinary `delta_id` replay:

```text
if escalation is already RESOLVED
AND existing ResolutionRecord has
  same escalation_id
  same result_id
  same result_fingerprint
  same authority_basis_ref
  same policy version
→ return the existing ResolutionRecord / successful prior ApplyResult semantics
→ never create a second resolution
```

If already RESOLVED under a different result/basis:

```text
→ rejected_already_resolved_conflict
```

A late conflicting result cannot rewrite the historical record; it may open a new review/evidence/design escalation.

---

## 7. `withdraw_escalation`

### Purpose

Close an OPEN escalation only when an explicit authorized basis proves that removing this blocker cannot create unsafe silent continuation.

### Input

```text
escalation_id
expected_lifecycle_revision
withdrawal_reason
withdrawal_basis_ref
expected_source_operation_state/ref
actor
now
```

### Allowed cases

Standalone withdrawal is allowed only when at least one is proven under policy:

1. source operation is already terminal/cancelled/superseded; or
2. an authorized Goal/Scope/operation transition makes this question obsolete and independently establishes continuation safety.

For semantic replacement of a question on a live operation, use `supersede_escalation` instead.

### Forbidden case

```text
OPEN escalation on runnable source
→ arbitrary withdraw
→ no other blocker
→ source resumes
```

is non-conforming.

### Apply

```text
status = WITHDRAWN
withdrawal_reason/basis persisted
withdrawn_at = now
lifecycle_revision += 1
persist ApplyResult / AuditRecord
```

---

## 8. Derived blocking query

There is no reducer operation `set_wait` / `clear_wait`.

For a source operation:

```text
has_escalation_blocker(op) =
  exists E where
    E.source_operation_ref == op
    AND E.status == OPEN
```

V1 invariant:

> every OPEN Escalation is blocking.

Continuation still additionally requires existing `LogicalControl == CONTINUE` and the ordinary runtime/dispatch gates.

---

## 9. Restart / recovery

After restart, control state is reconstructed only from durable records:

- canonical Work Item authority-basis pointer;
- immutable AuthorityBasisSnapshots;
- Escalation records and lifecycle revisions;
- EscalationResolutionRecords;
- ApplyResults/Audit records.

No in-memory WAIT flag is required.

If crash occurs:

### after Escalation persisted but before transport

Rediscover the same OPEN escalation and transport the same/new packet revision under the same escalation ID.

### after result observed but before resolution apply

Re-run ResolutionPolicy against current basis and retry the same authorized delta or create a fresh delta after stale revalidation.

### after resolution committed but acknowledgement lost

Same-delta replay returns original ApplyResult; same-result resolution create-or-get returns the existing ResolutionRecord.

---

## 10. Current-authority race

Resolution validation and authority-basis rebase must serialize through expectations.

### Resolution commits first

It records the exact basis ref used. Later basis rebase does not rewrite historical resolution.

### Authority-basis rebase commits first

A resolution carrying the old `expected_current_authority_basis_ref` is rejected stale and must be revalidated against the new basis.

This is deliberate: automatic resume must never race past a changed authority basis.

---

## 11. Relation to Promotion / Authorization Policy

This extension does not promote semantic content.

- `commit_work_item_authority_basis` requires an already-authorized basis change.
- `resolve_escalation` consumes authority/evidence that is already valid under policy.
- `EscalationResolutionRecord` is an operational blocker-clearance receipt, not design authority.
- Human-reserved authorization continues through Proposal → AuthorizationResult → PendingHumanGate.

Formula:

```text
Promotion/Authorization Policy
= may this fact/decision/action become authoritative?

ResolutionPolicy
= given current already-authoritative/evidenced facts, may this Escalation blocker clear?
```

---

## 12. Minimal conformance tests

Before automatic resume ships, tests should cover at least:

1. open persists before transport;
2. same escalation create-or-get;
3. same ID/different fingerprint reject;
4. every OPEN escalation blocks;
5. two OPEN escalations require both to clear;
6. supersession atomically preserves one OPEN blocker;
7. standalone unsafe withdrawal rejects;
8. resolution rejects stale lifecycle revision;
9. resolution rejects stale authority-basis pointer;
10. resolution persists record + RESOLVED atomically;
11. same delta replay does not duplicate resolution;
12. same result retry returns existing resolution receipt;
13. different result after resolution cannot overwrite record;
14. concurrent authority-basis rebase vs resolution serializes correctly;
15. restart derives blocking without an in-memory WAIT state.

---

## 13. Working conclusion

The authoritative boundary is:

```text
immutable semantic inputs
        ↓
Policy authorization / validation
        ↓
expected current basis + lifecycle CAS
        ↓
Reducer atomic apply
        ↓
ApplyResult + immutable audit/receipt
```

Cross-agent transport may fail, replay, or move surfaces without changing these identities or authority facts.