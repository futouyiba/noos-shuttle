# Cross-Agent Handoff Re-review Disposition — R1–R6

> Primary Design disposition for PR #14 re-review comment `5683250240`.
>
> Reviewed target: `6f7c52291075e8182f48ccb8d2f4585de62c5ad1`.
>
> Re-review verdict: APPROVE with automatic-resume preconditions.

## Summary

| Finding | Disposition | Result |
|---|---|---|
| R1 canonical currentness | ACCEPT + strengthen | Work Item-scoped `AuthorityBasisSnapshot` + canonical pointer + explicit authorized rebase |
| R2 undefined blocking qualifier | ACCEPT | every OPEN Escalation is blocking in V1 |
| R3 missing reducer operations | ACCEPT + strengthen | dedicated escalation reducer extension with basis CAS, supersession, safe withdrawal, idempotent resolution receipt |
| R4 non-goals missing | ACCEPT | non-goals carried into v2 explicitly |
| R5 v0 superseded banner | ACCEPT | v0/v1 current-tree stubs point to v2 and preserve exact historical commits |
| R6 dangling `result_kind` | ACCEPT by deletion | `result_kind` removed; no replacement taxonomy |

## R1 — ACCEPT + strengthen

The reviewer is correct that `current` was not machine-instantiated.

However, V2 deliberately rejects a global rule such as:

```text
current = latest main/HEAD
```

for in-flight work.

Instead:

```text
WorkItem.current_authority_basis_ref
→ immutable AuthorityBasisSnapshot
→ exact per-class currentness rules
```

Normative Git authority is current **for the Work Item** only when pinned by this basis. Moving the pointer requires an explicit authorized State Delta/Reducer transition.

Reason: a running implementation must neither remain accidentally stale nor silently adopt newly pushed semantics.

Automatic resolution also CAS-checks the current basis pointer; if it changes during validation, resolution fails stale.

## R2 — ACCEPT

Delete the undefined `blocking` distinction.

V1 rule:

```text
every OPEN Escalation referencing source_operation_ref is blocking
```

No non-blocking escalation subtype is introduced. Advisory/non-blocking material belongs in Review/Evidence/Note artifacts.

This makes restart derivation total and deterministic.

## R3 — ACCEPT + strengthen

A dedicated extension is added:

`cross-agent-handoff-escalation-reducer-operations-v0.md`

Operations:

```text
commit_work_item_authority_basis
open_escalation
supersede_escalation
withdraw_escalation
resolve_escalation
```

The extension inherits Proposal → Policy → Authorized Delta → Reducer → ApplyResult semantics and defines replay/create-or-get behavior.

### Additional Primary Design correction

The prior v1 prose said withdrawal does not automatically make work safe, but its derived predicate only blocked on OPEN escalations. That was incomplete: arbitrary OPEN→WITHDRAWN could therefore remove the last blocker.

V2 closes this by restricting standalone withdrawal. On a still-runnable source operation, semantic replacement uses an **atomic supersession** that creates the successor OPEN escalation and withdraws the old one in one transaction. Standalone withdrawal requires an already-authorized basis proving that the source operation is terminal/superseded or that an authorized operation/scope transition independently makes continuation safe.

### Resolution idempotency

`resolve_escalation` now has two replay layers:

1. normal `delta_id + fingerprint` replay returns original ApplyResult;
2. a crash retry targeting an already-resolved escalation with the exact same result fingerprint / authority basis / policy version returns the existing ResolutionRecord rather than creating another resolution.

Different result/basis after resolution is a conflict, never an overwrite.

## R4 — ACCEPT

V2 explicitly retains non-goals:

- no general multi-agent scheduler;
- no arbitrary peer messaging;
- no automatic Integration arbitration;
- no full GitHub Project sync;
- no universal final schema beyond prototype needs;
- no cross-machine coding-agent session takeover;
- no autonomous Human approval;
- no semantic merge of competing adjudications;
- no automatic repository-HEAD adoption;
- no automatic timeout chains beyond the explicit V1 rules.

## R5 — ACCEPT

Stale candidate files must not continue to advertise themselves as current candidates in the live docs tree.

The live branch will replace v0 and v1 with short supersession tombstones pointing to v2 while preserving the complete historical versions at their exact reviewed commits:

```text
v0 full historical target: 12fccf6024b10b1cc2c9eeece6c56c5bca2e5645
v1 full re-review target:   6f7c52291075e8182f48ccb8d2f4585de62c5ad1
```

This keeps provenance while removing stale-document ambiguity.

## R6 — ACCEPT by deletion

`result_kind` is removed.

The old values (`ADJUDICATION`, `EVIDENCE_RESULT`, `HUMAN_DECISION`, `TASK_RESULT`) mostly duplicate information already represented by:

- Escalation kind;
- `authority_role`;
- WorkerResult/HandoffResult realization path;
- `completion_status`;
- exact artifact/evidence refs.

Adding another descriptive enum would create drift without authority value.

## Implementation gate after this disposition

### #10 GitHub mailbox

May proceed on transport/provenance mechanics.

### Automatic resume in #11/#12

Still blocked until:

1. Authority Basis pointer/snapshot is implemented;
2. escalation reducer operations are implemented;
3. idempotent resolution receipt + CAS behavior is tested;
4. a focused conformance review passes against v2 + the reducer extension.

Human-mediated resume remains the valid fail-closed path meanwhile.

## Final Primary Design judgment

R1–R6 are accepted as valid follow-up findings. None requires re-opening the overall cross-agent architecture.

The one substantive model change is not a new feature but a missing authority instantiation:

> `current authority` must be a durable Work Item-scoped fact, not a convention inferred from repo recency.

Everything else is lifecycle/formality/hygiene closure around the already-approved model.