# NOOS Deliberation Harness — Cross-Agent Handoff N1–N5 Amendment v0

> Status: Working Design Contract / PR #14 closure amendment
>
> Extends: `cross-agent-handoff-escalation-contract-v2.md`
>
> Extends: `cross-agent-handoff-escalation-reducer-operations-v0.md`
>
> Source review: `noos-shuttle#16`, exact reviewed target `6f7c52291075e8182f48ccb8d2f4585de62c5ad1`
>
> Purpose: close N1–N5 without reintroducing a second WAIT/control plane or a second result ledger.
>
> Conflict rule: where this amendment is more specific than v2/reducer-v0, this amendment governs the current PR #14 candidate.

## 0. Primary Design disposition

```text
N1 ACCEPT + STRENGTHEN
N2 ACCEPT concern / REJECT separate re-arm marker
N3 ACCEPT + remove semantic pre-filter
N4 ACCEPT
N5 PARTIAL_ACCEPT because result_kind was already deleted in v2; remaining gaps ACCEPT
```

The central principle remains:

> LLM/worker may propose structured claims; deterministic policy evaluates declared rules; Reducer commits authority-bearing lifecycle facts.

ResolutionPolicy MUST NOT introduce an LLM semantic judge inside the authorization boundary.

---

## 1. N1 — deterministic applicability and sufficiency

### 1.1 Add `resolution_requirements[]` to Escalation

Every Escalation eligible for automatic resolution MUST carry an immutable, finite set of resolution requirements at creation time.

Conceptually:

```text
ResolutionRequirement
- requirement_id
- requirement_kind:
    DECISION
    EVIDENCE
    AUTHORIZATION
    HUMAN_INPUT
- question_ref / question_fragment_ref
- scope_selector
- applicability_rule_ref
- acceptance_rule_ref
- required: true
```

Escalation gains:

```text
resolution_requirements[]
```

`requirement_id` is stable within the Escalation and MUST NOT be rewritten after transport. If the required dimensions change materially, supersede the Escalation.

The intent is not to make all semantics globally machine-understandable. The intent is to make the **contract for what must be established before this particular blocker clears** explicit and enumerable.

### 1.2 Result claims are keyed to requirement IDs

HandoffResult / WorkerResult resolution payload gains:

```text
ResolutionClaim
- requirement_id
- claim_ref / immutable payload ref
- supporting_authority_refs[]
- supporting_evidence_refs[]
```

and:

```text
resolution_claims[]
```

A destination MUST NOT author a `SUFFICIENT` flag. It supplies claims and refs against requirement IDs only.

### 1.3 Deterministic ResolutionPolicy rule

Automatic ResolutionPolicy performs three separate checks for each required requirement:

```text
A. COVERAGE
   exactly this requirement_id is addressed by one or more immutable claims

B. APPLICABILITY
   the cited authority/evidence satisfies the requirement's declared
   applicability_rule_ref for the declared scope_selector

C. ACCEPTANCE
   the claim satisfies the requirement's declared acceptance_rule_ref
```

Coverage is structural.

Applicability and acceptance MUST be evaluated by a registered deterministic rule belonging to the current `policy_version` / authority artifact class. Examples include:

- exact authority-basis membership / exact pinned revision;
- exact target revision match;
- EvidenceRef claim kind + authority role + scope selector match;
- completed PendingHumanGate / AuthorizationResult chain;
- exact enum/value/equality/range predicates frozen in the requirement rule.

If no registered deterministic applicability/acceptance rule can decide a required requirement:

```text
→ automatic resolution FAILS CLOSED
→ keep Escalation OPEN
→ route to Human / Design / policy refinement as appropriate
```

ResolutionPolicy MUST NOT fall back to an LLM call, free-form semantic grading, `unresolved_questions == []`, destination-authored completion flags, or other proposer-controlled self-attestation.

### 1.4 AuthorityBasisEntry applicability contract

For any authority class usable by automatic resolution, `AuthorityBasisEntry` MUST expose or reference:

```text
scope_selector semantics
applicability_rule_ref
currentness_rule
```

An authority class lacking these deterministic rules may still be cited for Human reasoning, but it is not eligible to satisfy an automatic-resolution requirement.

### 1.5 ResolutionRecord evidence

`EscalationResolutionRecord.validation_evidence_refs[]` MUST make requirement-level evaluation auditable, directly or through an immutable validation bundle containing:

```text
requirement_id
claim/result ref
applicability rule + version
acceptance rule + version
PASS/FAIL outcome
supporting authority/evidence refs
```

Only all-required-PASS may authorize OPEN→RESOLVED automatically.

---

## 2. N2 — withdrawal safety without a second re-arm plane

The N2 failure mode is valid for v1, but the current v2/reducer-v0 already narrowed standalone withdrawal to cases where an authorized basis proves that removing the blocker is safe.

Primary Design therefore rejects adding a generic durable `requires_explicit_rearm` flag: that would recreate the second control plane v1 intentionally deleted.

Instead, make the withdrawal's continuation meaning explicit and durable.

### 2.1 Withdrawal disposition

For `withdraw_escalation`, persist:

```text
withdrawal_disposition:
  SOURCE_NOT_RUNNABLE
  CONTINUATION_SAFETY_ESTABLISHED

continuation_basis_ref
```

`SOURCE_NOT_RUNNABLE` is valid only when the source operation is already terminal/cancelled/superseded.

`CONTINUATION_SAFETY_ESTABLISHED` is valid only when an independently authorized Goal/Scope/operation transition both:

1. makes the Escalation obsolete; and
2. establishes that ordinary continuation under the resulting source-operation contract is safe.

A bare Human/Agent withdraw request cannot produce either disposition.

### 2.2 Derived continuation rule

The blocker query remains simple:

```text
OPEN Escalation => blocks
RESOLVED => no longer blocks
WITHDRAWN => no longer blocks only because the authorized withdraw reducer
             already established one of the allowed dispositions above
```

There is no separate post-withdrawal WAIT or re-arm bit.

After restart, the authoritative WITHDRAWN lifecycle record plus its immutable disposition/basis is sufficient to reconstruct why the blocker is absent.

If a source owner merely wants to stop waiting but cannot establish one of the two dispositions, `withdraw_escalation` MUST reject and the Escalation remains OPEN.

### 2.3 Supersession unchanged

Semantic replacement remains atomic:

```text
open successor
+ withdraw predecessor as SUPERSEDED
```

`SUPERSEDED` is handled only by `supersede_escalation`, not standalone withdrawal, so blocking continuity remains atomic.

---

## 3. N3 — late result handling after RESOLVED

Do not require NOOS to decide whether a late result is "materially conflicting" before surfacing it; that phrase would itself require the semantic judge N1 forbids.

### 3.1 Durable post-resolution notice

Every distinct immutable result observed for an already RESOLVED Escalation MUST be recorded or projected into a durable notice keyed by:

```text
(escalation_id, result_id, result_fingerprint)
```

Conceptually:

```text
PostResolutionResultNotice
- notice_id
- escalation_id
- resolution_record_id
- late_result_id
- late_result_fingerprint
- observed_source_ref
- status: PENDING_REVIEW | ACKNOWLEDGED | ESCALATED | DISMISSED
- owner_ref
- created_at
- disposition_ref?
```

This notice is operational/audit state, not semantic authority.

### 3.2 Owner

The owner is the durable source-operation owner / Work Item owner policy target. If no non-Human owner can be resolved, surface to Human.

NOOS MUST make `PENDING_REVIEW` visible; silently recording the late candidate in the mailbox is non-conforming.

### 3.3 No automatic rewrite, no automatic blocker

A late result:

- never rewrites the historical ResolutionRecord;
- never silently reopens the resolved Escalation;
- does not automatically block the already-running source operation merely because it is distinct;
- MUST be triaged by policy/Human.

If triage determines that the late result creates a real unresolved authority/evidence issue, create a **new** blocking Escalation with explicit provenance back to the notice/result.

This avoids both unsafe silent suppression and an LLM-based automatic semantic-conflict classifier.

---

## 4. N4 — NEEDS_HUMAN schema and ordering

Escalation semantic schema gains optional immutable fields:

```text
proposal_ref?
human_gate_ref?
authorization_result_ref?
```

For NEEDS_HUMAN cases governed by Proposal → AuthorizationResult → PendingHumanGate:

```text
Proposal / requires_human AuthorizationResult / PendingHumanGate
must already exist before Escalation open,
OR be created in the same serialized transaction boundary as open_escalation.
```

The Escalation is the cross-surface routing/coordination record; it is not the object that later mutates to acquire a gate ID.

If a Human need is discovered before the gate chain exists, create the required Proposal/gate chain first, then open the immutable NEEDS_HUMAN Escalation. If an already-open non-gate Escalation later becomes a gate-governed authorization problem, supersede it with a new Escalation carrying the refs.

For non-authorization Human input, these refs remain absent.

---

## 5. N5 — schema closure

### 5.1 `result_kind`

No action required beyond reaffirming v2:

> `result_kind` is deleted.

#10 marker envelopes MUST NOT reintroduce it. Classification derives from source Escalation kind, authority role, result provenance, and completion status.

### 5.2 Enumerate `resolution_outcome`

`EscalationResolutionRecord.resolution_outcome` is:

```text
AUTHORITY_BASIS_SATISFIED
EVIDENCE_REQUIREMENTS_SATISFIED
HUMAN_INPUT_REQUIREMENTS_SATISFIED
GATE_AUTHORIZATION_SATISFIED
MIXED_REQUIREMENTS_SATISFIED
```

This is an audit classification only. It does not itself confer authority.

### 5.3 Non-authorization NEEDS_HUMAN sufficiency

A non-authorization NEEDS_HUMAN Escalation may resolve without PendingHumanGate only when:

1. the immutable result observation is Human-origin under an eligible Human authority role;
2. it targets the exact Escalation;
3. all required HUMAN_INPUT / other declared `resolution_requirements[]` are deterministically covered and pass their acceptance/applicability rules;
4. no gate-governed authorization is actually required by Policy;
5. normal authority-basis/currentness and conflict checks pass.

A Human-authored chat/comment alone does not bypass these provenance and scope checks.

---

## 6. Reducer-extension amendments

The following are normative additions to `cross-agent-handoff-escalation-reducer-operations-v0.md`.

### `open_escalation`

Also validate:

- immutable `resolution_requirements[]` is present for automatic-resume eligible Escalations;
- each requirement ID is unique and has declared applicability/acceptance rules;
- gate-governed NEEDS_HUMAN carries the required Proposal/gate refs under the ordering rule above.

### `resolve_escalation`

Also require:

- deterministic requirement-coverage/applicability/acceptance validation bundle;
- all required requirements PASS;
- no fallback semantic model judgment inside ResolutionPolicy.

Same-result idempotent receipt semantics remain unchanged.

### `withdraw_escalation`

Also persist and validate:

```text
withdrawal_disposition
continuation_basis_ref
```

A successful standalone withdrawal is itself the authoritative proof that removal of this blocker is safe under one of the two enumerated dispositions. No separate re-arm marker is created.

### post-resolution result observation

Observation of a distinct result against RESOLVED MUST create-or-get a durable `PostResolutionResultNotice` and route/surface it to the source-operation owner/Human. The historical resolution remains immutable.

---

## 7. Automatic-resume gate after this amendment

#10 GitHub mailbox/provenance work remains allowed within the existing prototype boundary.

Automatic resume in #11/#12 remains blocked until implementation provides and focused conformance review verifies:

1. Work Item Authority Basis/current-pointer semantics;
2. deterministic `resolution_requirements[]` and registered applicability/acceptance rules with fail-closed behavior;
3. escalation reducer operations + idempotent resolution receipt;
4. withdrawal disposition semantics with no arbitrary OPEN→WITHDRAWN path;
5. post-resolution result notice/surfacing;
6. PendingHumanGate reference ordering for gate-governed NEEDS_HUMAN.

N5 marker vocabulary must be reflected before #10 freezes its marker schema: specifically, do not emit `result_kind`.

---

## 8. Minimal conformance additions

Add tests/proofs for:

1. missing required requirement ID => automatic resolution rejects;
2. unknown/unregistered applicability or acceptance rule => fail closed without LLM judgment;
3. all required requirements PASS => eligible for reducer resolution subject to ordinary checks;
4. gate-governed NEEDS_HUMAN without gate refs => open rejects;
5. arbitrary standalone withdrawal on runnable source => rejects;
6. authorized safe withdrawal persists disposition/basis and restart remains deterministic;
7. distinct late result after RESOLVED => durable PENDING_REVIEW notice;
8. late result never rewrites prior ResolutionRecord;
9. notice triage may create a new Escalation but cannot mutate the old one;
10. non-authorization Human input resolves only through requirement coverage + eligible Human provenance.

---

## 9. Working conclusion

The amended automatic-resume boundary is:

```text
explicit immutable resolution requirements
        ↓
result claims keyed to requirement IDs
        ↓
registered deterministic applicability/acceptance rules
        ↓
no undecidable required dimension
        ↓
current authority basis + target + gate checks
        ↓
Reducer atomic resolution receipt
```

Withdrawal safety is carried by the authorized withdrawal transition itself, not by a second WAIT/re-arm control plane.

Late post-resolution results are never silently ignored and never automatically semantically classified: they are durably surfaced for explicit triage.