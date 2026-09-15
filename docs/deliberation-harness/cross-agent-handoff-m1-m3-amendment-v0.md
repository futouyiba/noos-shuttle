# NOOS Deliberation Harness — Cross-Agent Handoff M1–M3 Amendment v0

> Status: Working Design Contract / PR #14 focused re-review closure amendment
>
> Extends: `cross-agent-handoff-escalation-contract-v2.md`
>
> Extends: `cross-agent-handoff-escalation-reducer-operations-v0.md`
>
> Extends: `cross-agent-handoff-n1-n5-amendment-v0.md`
>
> Source review: `noos-shuttle#16`, focused re-review of exact target `938702cf8ccec114f342dc91abb0a7c7cd5ba165`
>
> Purpose: close M1–M3 without introducing an LLM semantic judge, a second WAIT/re-arm plane, or another result ledger.
>
> Conflict rule: where this amendment is more specific than v2 / reducer-v0 / N1–N5 amendment, this amendment governs the current PR #14 candidate.

## 0. Primary Design disposition

```text
M1 ACCEPT + STRENGTHEN
M2 ACCEPT
M3 ACCEPT
```

The central correction is:

> Automatic-resolution eligibility is not proposer-owned.
>
> A worker may discover and describe a blocker, but it may not author the acceptance bar that later permits its own continuation.

V1 therefore treats automatic escalation resolution as an explicit, template-bound capability.

---

## 1. M1 — registered requirement templates own the automatic-resolution bar

### 1.1 Separate escalation discovery from automatic-resolution eligibility

Every Escalation has exactly one resolution mode:

```text
resolution_mode:
  HUMAN_MEDIATED
  AUTOMATIC_TEMPLATE_BOUND
```

`resolution_mode` is determined/authorized by `open_escalation` policy. It is not a free-form proposer-controlled field.

Default:

```text
free-form / semantically open Escalation
→ HUMAN_MEDIATED
```

Automatic resolution is opt-in, fail-closed capability:

```text
AUTOMATIC_TEMPLATE_BOUND
→ requires one authorized registered ResolutionRequirementTemplate
```

A proposer may request automatic eligibility, but Policy decides whether a conforming template exists and may be bound.

### 1.2 ResolutionRequirementTemplate

Conceptually:

```text
ResolutionRequirementTemplate
- template_id
- template_version
- escalation_kind
- resolution_profile
- eligible_source_roles[]
- eligible_destination_authority_roles[]
- parameter_schema
- requirement_blueprints[]
- template_policy_ref
- authorized_registration_ref
- created_at
- supersedes_template_ref?
```

Each `requirement_blueprint` fixes the acceptance bar rather than allowing the worker to invent one:

```text
RequirementBlueprint
- blueprint_id
- requirement_kind:
    DECISION
    EVIDENCE
    AUTHORIZATION
    HUMAN_INPUT
- question_dimension
- scope_selector_rule_ref
- applicability_rule_ref
- acceptance_rule_ref
```

Template registration/version change is an authority/policy event, not ordinary worker output.

A worker MUST NOT define or weaken:

- `applicability_rule_ref`;
- `acceptance_rule_ref`;
- required dimension count;
- eligible authority role;
- template policy semantics.

### 1.3 Template binding

For an automatic-resolution-eligible Escalation, persist immutable:

```text
resolution_mode = AUTOMATIC_TEMPLATE_BOUND
requirement_template_ref
requirement_template_version
requirement_parameter_bindings
resolution_requirements[]
```

`resolution_requirements[]` is the deterministic expansion of the registered template plus validated parameter bindings.

Worker/source may bind only parameters allowed by `parameter_schema`, for example:

- exact contract/topic selector;
- exact implementation target ref;
- exact evidence subject;
- exact Proposal/gate identity.

The worker may not add/remove acceptance rules or silently delete a required blueprint.

`open_escalation` MUST verify:

```text
1. template exists and is authorized/current under policy;
2. template escalation_kind matches;
3. source/destination roles are eligible;
4. parameter bindings satisfy schema;
5. deterministic expansion fingerprint matches stored resolution_requirements[];
6. expansion is non-empty;
7. every requirement has registered applicability + acceptance rules.
```

Failure of any check:

```text
→ Escalation may still open as HUMAN_MEDIATED
OR
→ open rejects if caller required automatic mode
```

It MUST NOT silently remain marked automatic.

### 1.4 Free-form requirement sets

Free-form `resolution_requirements[]` remain useful for:

- Human-readable task framing;
- Primary Design / Human adjudication;
- audit/provenance;
- future template design.

But:

> A free-form requirement set is never sufficient to grant automatic resolution eligibility in V1.

Such Escalations use:

```text
resolution_mode = HUMAN_MEDIATED
```

Their blocker may clear only through an explicit Human/authorized manual resolution path whose authority basis is durable and auditable.

### 1.5 NEEDS_DESIGN profiles

A generic open-ended NEEDS_DESIGN is HUMAN_MEDIATED by default.

Automatic NEEDS_DESIGN resolution is allowed only for a registered narrow profile whose completion can be mechanically checked, for example:

```text
EXISTING_AUTHORITY_CLARIFICATION
→ exact promoted/current authority artifact answering each registered dimension

PROMOTED_DESIGN_DELTA_AVAILABLE
→ exact promoted design authority ref for the declared scope + target
```

A routine conversational clarification without the template-required authority artifacts cannot auto-clear the blocker.

This preserves the key invariant:

```text
ordinary chat answer != implementation authority
```

### 1.6 No semantic judge in template selection

EscalationOpenPolicy may bind an automatic template only when template eligibility can itself be established by registered deterministic rules or pre-authorized operation metadata.

If deciding which template/profile applies requires free-form semantic judgment:

```text
→ HUMAN_MEDIATED
```

Do not invoke an LLM inside the authorization boundary to select a weaker automatic template.

---

## 2. M2 — eliminate vacuous pass and define automatic-resolution eligibility

### 2.1 Non-empty requirement set

For:

```text
resolution_mode = AUTOMATIC_TEMPLATE_BOUND
```

all of the following are mandatory:

```text
requirement_template_ref exists
resolution_requirements[] exists
count(resolution_requirements) >= 1
```

Empty or absent requirements can never satisfy automatic resolution.

### 2.2 All materialized requirements are required

V1 removes the ambiguous field:

```text
required: true | false
```

from the effective automatic requirement schema.

Every requirement materialized from the bound template is mandatory.

Advisory/non-blocking information belongs in packet context/evidence/notes, not in `resolution_requirements[]`.

### 2.3 Define eligibility precisely

An Escalation is `automatic-resolution eligible` iff:

```text
status == OPEN
AND resolution_mode == AUTOMATIC_TEMPLATE_BOUND
AND bound template is valid/current for the policy version
AND deterministic materialized requirements are non-empty
AND all ordinary authority-basis / target / gate preconditions remain satisfiable
```

Eligibility means only:

> ResolutionPolicy is permitted to evaluate the blocker automatically.

It does not mean the blocker is already sufficient to clear.

Any eligibility failure keeps the Escalation OPEN and routes to Human-mediated handling or supersession.

---

## 3. M3 — effective schema consolidation and post-resolution edit-conflict ownership

Until a later consolidated contract revision replaces these files, implementers MUST treat the following overlays as the **effective current schema** for PR #14. The v2 schema blocks alone are not implementation-complete.

### 3.1 Effective Escalation schema overlay

Add to v2 §2.1:

```text
Escalation
- resolution_mode: HUMAN_MEDIATED | AUTOMATIC_TEMPLATE_BOUND
- requirement_template_ref?
- requirement_template_version?
- requirement_parameter_bindings?
- resolution_requirements[]
- proposal_ref?
- human_gate_ref?
- authorization_result_ref?
- withdrawal_disposition?
- continuation_basis_ref?
```

Rules:

- automatic mode requires template refs + non-empty deterministic requirements;
- Human-mediated mode may have free-form requirements but they never authorize automatic clearance;
- Proposal/gate refs obey N4 creation ordering;
- withdrawal fields are lifecycle metadata persisted only by authorized reducer withdrawal, not proposer semantic content.

### 3.2 Effective result schema overlay

Add to v2 §7.1 / WorkerResult resolution payload:

```text
ResolutionClaim
- requirement_id
- claim_ref / immutable_payload_ref
- supporting_authority_refs[]
- supporting_evidence_refs[]

resolution_claims[]
```

For automatic mode, claims must reference requirement IDs materialized from the bound template.

No `result_kind` and no destination-authored `SUFFICIENT` field may be introduced.

### 3.3 Effective ResolutionRecord overlay

`resolution_outcome` remains audit-only and uses the N1–N5 amendment enumeration.

Automatic ResolutionRecord validation evidence MUST include:

```text
requirement_template_ref + version
materialized requirement-set fingerprint
requirement-level claim coverage
applicability rule + version
acceptance rule + version
PASS/FAIL result
```

This makes both the acceptance bar and its execution auditable.

### 3.4 Effective post-resolution notice ownership

`PostResolutionResultNotice` is also the visibility surface for a post-resolution editable-comment invariant conflict.

If NOOS observes after RESOLVED:

```text
same result_id
+ different result_fingerprint
```

then:

```text
freeze immutable new observation
create/get PostResolutionResultNotice
notice_kind = RESULT_ID_FINGERPRINT_CONFLICT
owner = source-operation / Work Item owner, Human fallback
status = PENDING_REVIEW
```

A distinct late result uses:

```text
notice_kind = DISTINCT_LATE_RESULT
```

Both cases:

- never rewrite the historical ResolutionRecord;
- MUST be visibly surfaced;
- do not automatically reopen/block the running source operation;
- may produce a new blocking Escalation only through explicit policy/Human triage.

This is the owner for the v2 GitHub-comment edit-conflict case; it must not end as a silent invariant rejection in transport code.

---

## 4. Reducer / policy amendments

### 4.1 `open_escalation`

For every Escalation, persist/validate `resolution_mode`.

For `AUTOMATIC_TEMPLATE_BOUND`, additionally require:

```text
registered current template
matching escalation kind/profile
eligible source + authority roles
valid parameter bindings
non-empty deterministic expansion
exact requirement-set fingerprint
all rules registered under current policy version
```

If the caller supplies free-form/self-authored acceptance rules, automatic mode rejects.

### 4.2 `resolve_escalation`

Automatic `resolve_escalation` additionally requires:

```text
resolution_mode == AUTOMATIC_TEMPLATE_BOUND
template still eligible/current
non-empty requirement set
all materialized requirements PASS
validation bundle records exact template/rule versions
```

If the template was superseded or policy invalidates it before commit, CAS/policy validation fails stale and resolution must be re-evaluated.

### 4.3 Human-mediated resolution

HUMAN_MEDIATED clearance is not an alternate hidden auto-policy.

It must consume a durable authorized Human/Design resolution basis appropriate to the escalation kind and existing authority model, then commit the ordinary immutable ResolutionRecord + RESOLVED transition.

### 4.4 post-resolution observations

The observation path MUST create/surface the notice variants defined in §3.4 for:

- distinct late results;
- same result ID with a changed fingerprint after RESOLVED.

---

## 5. Automatic-resume gate amendment

This section normatively amends `cross-agent-handoff-n1-n5-amendment-v0.md` §7.

#10 GitHub mailbox/provenance work remains allowed within its existing boundary.

Automatic resume in #11/#12 remains blocked until implementation and focused conformance review verify **all** of:

1. Work Item Authority Basis/current-pointer semantics;
2. registered/versioned `ResolutionRequirementTemplate` policy and `resolution_mode` gating;
3. deterministic non-empty template materialization + requirement claims + registered applicability/acceptance rules, with fail-closed behavior and no LLM semantic judge;
4. escalation reducer operations + idempotent resolution receipt;
5. withdrawal disposition semantics with no arbitrary OPEN→WITHDRAWN path;
6. post-resolution result/edit-conflict notice + visible owner surfacing;
7. PendingHumanGate reference ordering for gate-governed NEEDS_HUMAN.

In particular:

> Implementing deterministic rule execution without M1 template-authority closure is insufficient for automatic resume.

The acceptance bar itself must be independently registered/authorized rather than source-authored.

Human-mediated resume remains the valid fail-closed path before this gate passes.

---

## 6. Minimal conformance additions

Add tests/proofs for at least:

1. free-form requirement set + requested automatic mode => reject or downgrade only through explicit policy outcome to HUMAN_MEDIATED;
2. registered template + valid bindings => deterministic non-empty requirement materialization;
3. worker cannot weaken/delete a template blueprint acceptance rule;
4. unknown/superseded template => automatic resolution ineligible;
5. empty materialized requirement set => automatic resolution rejects;
6. automatic mode with no template => rejects;
7. Human-mediated free-form escalation never auto-resolves from a routine result;
8. generic NEEDS_DESIGN chat clarification without promoted/template-required authority artifact => does not auto-resolve;
9. exact template/rule versions recorded in resolution validation bundle;
10. same result_id + different fingerprint observed after RESOLVED => visible `RESULT_ID_FINGERPRINT_CONFLICT` notice;
11. distinct late result => visible `DISTINCT_LATE_RESULT` notice;
12. neither late-result notice rewrites historical ResolutionRecord or silently auto-blocks/reopens.

---

## 7. Working conclusion

The automatic path is now intentionally narrower:

```text
worker discovers blocker
        ↓
open_escalation Policy
        ├─ no deterministic authorized template
        │      → HUMAN_MEDIATED
        │
        └─ registered template applicable
               → AUTOMATIC_TEMPLATE_BOUND
               → immutable non-empty requirements materialized
               ↓
          destination returns claims keyed to requirement IDs
               ↓
          source-side deterministic rules evaluate claims
               ↓
          no undecidable dimension / currentness / conflict failure
               ↓
          Reducer commits ResolutionRecord + RESOLVED
```

The worker may describe the problem. It does not get to choose the bar that releases itself.
