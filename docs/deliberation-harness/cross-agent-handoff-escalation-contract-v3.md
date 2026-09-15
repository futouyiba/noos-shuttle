# NOOS Deliberation Harness — Cross-Agent Handoff / Escalation Contract v3

> Status: Consolidated Current Design Candidate / pending fresh independent review of this consolidation
>
> Supersedes as the current reading path (semantics fully absorbed herein; files retained as provenance tombstones):
>
> - `cross-agent-handoff-escalation-contract-v2.md`
> - `cross-agent-handoff-escalation-reducer-operations-v0.md`
> - `cross-agent-handoff-n1-n5-amendment-v0.md`
> - `cross-agent-handoff-m1-m3-amendment-v0.md`
>
> Parent feature: `noos-shuttle#7`. Design lineage: `noos-shuttle#9`. Current PR: `noos-shuttle#14`. Review lineage: `noos-shuttle#15`, `noos-shuttle#16`.
>
> Authority baseline: V1 Deliberation Harness authority in `futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1`.
>
> Authoritative contracts at that baseline win over this candidate wherever they conflict.

## 0. Provenance (compact)

This document is the single implementation-facing current design candidate for the Cross-Agent Handoff / Escalation subsystem. It consolidates the effective semantics of the v2 base contract, the reducer-operations extension, and the N1–N5 and M1–M3 amendments, and it closes the residual findings K1/K2.

Exact historical review targets and verdict lineage:

| Layer | Exact target | Verdict / outcome |
|---|---|---|
| v0 contract | `12fccf6024b10b1cc2c9eeece6c56c5bca2e5645` | `REQUEST_CHANGES` (F1–F8) → v1 |
| v1 contract (re-review) | `6f7c52291075e8182f48ccb8d2f4585de62c5ad1` | `APPROVE` + R1–R6 → v2 at `2e55df6876c7414ff2be9a14c0f4735f5a89baf6` + reducer-v0 at `3daa613504d9a630a5fadbc690e5654307e696e1` |
| v2 + reducer + N1–N5 amendment | `938702cf8ccec114f342dc91abb0a7c7cd5ba165` | N1–N5 `CLOSED`; M1–M3 surfaced → M1–M3 amendment |
| M1–M3 amendment (focused re-review) | `16293eaba47fd107bb40d599b09c3a198b4858ad` (PR #14 comment `5684973946`) | `APPROVE` + K1/K2 + consolidation conditions → this v3 consolidation |

Prior findings F1–F8, R1–R6, N1–N5, M1–M3 are closed and are not restated here. Exact commits and review comments are the provenance anchors; old review prose is not copied into the current contract.

## 1. One-sentence decision

Cross-agent Design ↔ Implementation is an authority-aware interruption/resume protocol for the **same bounded work identity**, not generic agent messaging.

```text
active bounded work
→ immutable durable Escalation
→ immutable HandoffPacket projection
→ authority-aware late-bound transport
→ immutable result observation / WorkerResult
→ ResolutionPolicy against the current Work Item Authority Basis
→ crash-consistent ResolutionRecord + RESOLVED transition
→ no OPEN Escalations remain for the source operation
→ same source operation may continue under existing LogicalControl/runtime gates
```

Central invariants:

```text
transported answer != authority
result delivery != escalation resolution
repository HEAD != automatically current authority
WITHDRAWN != silently safe-to-resume
the worker may describe the blocker; it does not author the bar that releases itself
```

---

## 2. Scope: reuse existing identities; one coordination primitive

Existing V1 concepts remain authoritative for their existing domains:

- Work Item — durable desired work identity;
- Logical Thread — durable role/work continuity;
- Provider Conversation / Browser Carrier — replaceable execution surfaces;
- Proposal / AuthorizationResult / PendingHumanGate — state/action authorization;
- SubmissionOperation — durable provider actuation intent;
- WorkerResult / ResultDelivery — managed-worker result identity and delivery;
- SourceRef / EvidenceRef — immutable evidence provenance;
- State Delta / Reducer / ApplyResult — authoritative local state transition boundary.

The one additional coordination primitive is:

```text
Escalation
```

`HandoffPacket` is a compiled projection. `HandoffResult` is a transport-neutral result shape when no existing WorkerResult identity applies.

---

## 3. Effective schemas (implementation-facing)

These schemas are the **effective current schema**. Implementers must not mentally overlay v2 plus amendments; this section is complete. Field-level naming may be refined by implementation; the semantics are normative.

### 3.1 Escalation

```text
Escalation
- escalation_id
- work_item_id
- source_operation_ref
- source_logical_thread_id?
- source_role
- destination_role
- kind: NEEDS_DESIGN | NEEDS_EVIDENCE | NEEDS_HUMAN
- blocker_summary
- question_ref / question_payload
- authority_basis_ref
- authority_refs[]
- evidence_refs[]
- implementation_revision_refs[]
- resolution_mode: HUMAN_MEDIATED | AUTOMATIC_TEMPLATE_BOUND
- requirement_template_ref?
- requirement_template_version?
- requirement_parameter_bindings?
- resolution_requirements[]
- proposal_ref?
- human_gate_ref?
- authorization_result_ref?
- supersedes_escalation_id?
- status: OPEN | RESOLVED | WITHDRAWN
- lifecycle_revision
- resolution_record_id?
- withdrawal_reason?
- withdrawal_disposition?
- continuation_basis_ref?
- superseded_by_escalation_id?
- created_at
- resolved_at?
- withdrawn_at?
```

Rules:

- `destination_role` is semantic; concrete provider conversation/tab/session is late-bound.
- Automatic mode requires template refs + non-empty deterministic `resolution_requirements[]` materialized from the bound template (§4).
- Human-mediated mode may carry free-form requirements; they never authorize automatic clearance.
- Proposal/gate refs obey the N4 creation-ordering rule (§3.11).
- Withdrawal fields are lifecycle metadata persisted only by authorized reducer withdrawal, not proposer semantic content (§3.9).

Immutability — after creation, semantic content is immutable:

```text
kind
blocker/question
source identity
role targets
authority_basis_ref captured at open time
authority/evidence/implementation refs
resolution_mode and template binding and materialized requirements
supersedes relation
```

Only lifecycle metadata (`status`, `lifecycle_revision`, `resolution_record_id`, withdrawal fields, timestamps) may advance through authorized reducer operations. If the question changes materially, create a new Escalation ID.

### 3.2 ResolutionRequirementTemplate

Template registration/version change is an authority/policy event, not ordinary worker output.

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

A worker MUST NOT define or weaken:

- `applicability_rule_ref`;
- `acceptance_rule_ref`;
- required dimension count;
- eligible authority role;
- template policy semantics.

`parameter_schema` maps each parameter name to a declaration:

```text
ParameterDeclaration
- type/schema constraints
- scope_affecting: true | false
- binding_grounding_rule_ref        # REQUIRED iff scope_affecting == true (K1, §4.2)
```

### 3.3 Materialized ResolutionRequirement

`resolution_requirements[]` on an AUTOMATIC_TEMPLATE_BOUND Escalation is the deterministic expansion of the bound template plus validated parameter bindings:

```text
ResolutionRequirement
- requirement_id                   # stable within the Escalation; never rewritten after transport
- requirement_kind:
    DECISION
    EVIDENCE
    AUTHORIZATION
    HUMAN_INPUT
- question_ref / question_fragment_ref
- scope_selector                   # materialized from blueprint scope_selector_rule_ref + bindings
- applicability_rule_ref
- acceptance_rule_ref
```

Every materialized requirement is mandatory. There is no `required: true | false` field in the effective schema; advisory/non-blocking information belongs in packet context/evidence/notes, not in `resolution_requirements[]`. If the required dimensions change materially, supersede the Escalation.

### 3.4 ResolutionClaim

HandoffResult / WorkerResult resolution payload gains:

```text
ResolutionClaim
- requirement_id
- claim_ref / immutable_payload_ref
- supporting_authority_refs[]
- supporting_evidence_refs[]

resolution_claims[]
```

A destination MUST NOT author a `SUFFICIENT` flag. It supplies claims and refs against requirement IDs only. For automatic mode, claims must reference requirement IDs materialized from the bound template.

### 3.5 HandoffPacket

```text
HandoffPacket
- packet_id
- packet_fingerprint
- packet_revision
- supersedes_packet_id?
- escalation_id
- authority_basis_ref
- source_work_item_id
- source_operation_ref
- source_role
- destination_role
- reason
- goal
- scope
- non_goals
- exact_authority_refs[]
- implementation_artifact_refs[]
- evidence_refs[]
- bounded_context_refs[]
- precise_questions[]
- expected_return_contract
- stop_condition
- compiled_at
```

Rules:

1. Persist packet identity/fingerprint before transport.
2. Once dispatched/posted, packet content is immutable.
3. If authority/context changes, compile a new packet revision with `supersedes_packet_id`.
4. Packet authority refs preserve what was actually used; destination may append current/superseding refs but must not rewrite history.
5. Packet is never canonical authority.

### 3.6 HandoffResult / WorkerResult positioning

```text
HandoffResult
- result_id
- result_fingerprint
- source_packet_id
- source_escalation_id
- source_role
- authority_role
- completion_status
- summary
- artifact_refs[]
- authority_refs[]
- evidence_refs[]
- decisions/findings
- unresolved_questions[]
- recommended_next_action
- candidate_resume_authority_refs[]
- resolution_claims[]
- created_at
```

`completion_status` is descriptive only:

```text
COMPLETE
PARTIAL
BLOCKED
FAILED_SAFE
```

It never self-authorizes resume. There is no `result_kind` field and no destination-authored sufficiency field.

When the destination is a Harness-managed thread that already produces WorkerResult:

- WorkerResult is the canonical durable result identity;
- reuse the same `result_id`;
- cross-agent resolution payload (including `resolution_claims[]`) is carried/referenced by WorkerResult;
- existing ResultDeliveryKey / DELIVER_CHILD_RESULT semantics apply where a return is required;
- do not mint a parallel result ledger.

When the destination is an external/non-worker surface, NOOS may persist HandoffResult as the immutable result observation.

### 3.7 EscalationResolutionRecord

Successful automatic/manual policy resolution creates an immutable operational receipt:

```text
EscalationResolutionRecord
- resolution_id
- escalation_id
- result_id
- result_fingerprint
- authority_basis_ref
- resolution_outcome:
    AUTHORITY_BASIS_SATISFIED
    EVIDENCE_REQUIREMENTS_SATISFIED
    HUMAN_INPUT_REQUIREMENTS_SATISFIED
    GATE_AUTHORIZATION_SATISFIED
    MIXED_REQUIREMENTS_SATISFIED
- authority_basis_refs[]
- evidence_basis_refs[]
- validation_evidence_refs[]
- policy_id / policy_version
- decided_by
- created_at
```

`resolution_outcome` is an audit classification only; it does not itself confer authority. This record is **not** design authority and does not replace AuthorizationResult/ApplyResult. It records why the already-authorized/evidenced blocker was allowed to clear.

For automatic mode, `validation_evidence_refs[]` MUST make evaluation auditable, directly or through an immutable validation bundle containing at least:

```text
requirement_template_ref + version
materialized requirement-set fingerprint
requirement-level claim coverage
applicability rule + version
acceptance rule + version
PASS/FAIL outcome per requirement
supporting authority/evidence refs
```

This makes both the acceptance bar and its execution auditable.

`ResolutionRecord + Escalation RESOLVED` commit atomically under the reducer (§11.5).

### 3.8 AuthorityBasisSnapshot / AuthorityBasisEntry

Every Work Item that permits automatic escalation resolution MUST have a durable immutable authority-basis snapshot referenced by a canonical Work Item pointer:

```text
AuthorityBasisSnapshot
- authority_basis_id
- work_item_id
- basis_revision
- entries[]
- supersedes_authority_basis_id?
- authorized_transition_ref
- created_at

AuthorityBasisEntry
- authority_class
- scope_selector
- canonical_source
- exact_revision_ref?
- policy_ref?
- currentness_rule
- applicability_rule_ref
```

The canonical pointer is:

```text
WorkItem.current_authority_basis_ref
```

It belongs to authoritative NOOS State, not to GitHub comments, adapters, or LLM context. Only an authorized State Delta / Reducer-equivalent transition may replace this pointer (§11.2).

`applicability_rule_ref` is the N1 contract: for any authority class usable by automatic resolution, the entry MUST expose or reference deterministic `scope_selector` semantics, an `applicability_rule_ref`, and a `currentness_rule`. An authority class lacking these may still be cited for Human reasoning, but it is not eligible to satisfy an automatic-resolution requirement.

### 3.9 Withdrawal lifecycle metadata

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

A bare Human/Agent withdraw request cannot produce either disposition. `SUPERSEDED` as a `withdrawal_reason` is set only by `supersede_escalation`, never by standalone withdrawal (§12).

There is no separate post-withdrawal WAIT or re-arm bit. After restart, the authoritative WITHDRAWN lifecycle record plus its immutable disposition/basis is sufficient to reconstruct why the blocker is absent.

### 3.10 PostResolutionResultNotice

Every distinct immutable result observed for an already RESOLVED Escalation MUST be recorded or projected into a durable notice keyed by:

```text
(escalation_id, result_id, result_fingerprint)
```

```text
PostResolutionResultNotice
- notice_id
- escalation_id
- resolution_record_id
- notice_kind: DISTINCT_LATE_RESULT | RESULT_ID_FINGERPRINT_CONFLICT
- late_result_id
- late_result_fingerprint
- observed_source_ref
- status: PENDING_REVIEW | ACKNOWLEDGED | ESCALATED | DISMISSED
- owner_ref
- created_at
- disposition_ref?
```

`notice_kind` semantics:

- `DISTINCT_LATE_RESULT` — a result with a distinct identity observed after RESOLVED;
- `RESULT_ID_FINGERPRINT_CONFLICT` — the same `result_id` observed after RESOLVED with a different `result_fingerprint` (e.g., an editable GitHub comment was edited after consumption).

This notice is operational/audit state, not semantic authority. Full behavior in §14.

### 3.11 Proposal / PendingHumanGate refs (gate-governed NEEDS_HUMAN)

Escalation semantic schema includes optional immutable fields:

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

## 4. Resolution modes and template authority

### 4.1 resolution_mode

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

Automatic resolution is an opt-in, fail-closed capability:

```text
AUTOMATIC_TEMPLATE_BOUND
→ requires one authorized registered ResolutionRequirementTemplate
```

A proposer may request automatic eligibility, but Policy decides whether a conforming template exists and may be bound.

### 4.2 Template binding and binding faithfulness (K1)

For an automatic-resolution-eligible Escalation, persist immutable:

```text
resolution_mode = AUTOMATIC_TEMPLATE_BOUND
requirement_template_ref
requirement_template_version
requirement_parameter_bindings
resolution_requirements[]
```

`resolution_requirements[]` is the deterministic expansion of the registered template plus validated parameter bindings. Worker/source may bind only parameters allowed by `parameter_schema`, for example:

- exact contract/topic selector;
- exact implementation target ref;
- exact evidence subject;
- exact Proposal/gate identity.

The worker may not add/remove acceptance rules or silently delete a required blueprint.

**Binding faithfulness (K1).** Every **scope-affecting** parameter binding MUST be deterministically derived from, or cross-checked against, immutable facts already belonging to the Escalation / source operation / Work Item authority context. Eligible grounding sources are only:

- `Escalation.authority_refs[]`;
- `Escalation.implementation_revision_refs[]`;
- source operation pinned target refs;
- immutable Proposal/gate refs;
- pre-authorized operation metadata;
- Work Item Authority Basis entries explicitly allowed by the template binding rule.

Mechanism:

- each scope-affecting parameter declares `binding_grounding_rule_ref` in the template's `parameter_schema` (§3.2);
- the referenced rule is a registered deterministic rule (same registry family as applicability/acceptance rules) that names its eligible grounding source class(es) and the derivation or cross-check predicate — for example exact membership in `authority_refs[]`, equality with the source operation's pinned target, or containment in an explicitly allowed AuthorityBasisEntry scope;
- at `open_escalation`, the rule executes deterministically: the worker-supplied value must equal the derived value, or satisfy the declared cross-check predicate against the grounding refs.

A proposer-supplied binding that cannot be deterministically proven faithful to those immutable refs MUST NOT remain automatic:

```text
→ downgrade to HUMAN_MEDIATED under explicit Policy outcome
OR
→ reject open if automatic mode was required
```

It MUST NOT silently remain marked automatic. No LLM semantic comparison may be inserted to decide binding faithfulness; it is deterministic rule execution only.

The worker may choose a value only within the template's declared binding rule; it cannot use an unrelated but schema-valid authority/topic selector.

### 4.3 open-time template verification

`open_escalation` MUST verify:

```text
1. template exists and is authorized/current under policy;
2. template escalation_kind matches;
3. source/destination roles are eligible;
4. parameter bindings satisfy schema, and every scope-affecting binding is
   deterministically grounded per its registered binding_grounding_rule (§4.2);
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

It MUST NOT silently remain marked automatic. If the caller supplies free-form/self-authored acceptance rules, automatic mode rejects.

### 4.4 Free-form requirement sets

Free-form `resolution_requirements[]` remain useful for:

- Human-readable task framing;
- Primary Design / Human adjudication;
- audit/provenance;
- future template design.

But:

> A free-form requirement set is never sufficient to grant automatic resolution eligibility in V1.

Such Escalations use `resolution_mode = HUMAN_MEDIATED`. Their blocker may clear only through an explicit Human/authorized manual resolution path whose authority basis is durable and auditable (§10.4).

### 4.5 NEEDS_DESIGN profiles

A generic open-ended NEEDS_DESIGN is HUMAN_MEDIATED by default.

Automatic NEEDS_DESIGN resolution is allowed only for a registered narrow profile whose completion can be mechanically checked, for example:

```text
EXISTING_AUTHORITY_CLARIFICATION
→ exact promoted/current authority artifact answering each registered dimension

PROMOTED_DESIGN_DELTA_AVAILABLE
→ exact promoted design authority ref for the declared scope + target
```

A routine conversational clarification without the template-required authority artifacts cannot auto-clear the blocker. This preserves:

```text
ordinary chat answer != implementation authority
```

### 4.6 No semantic judge in template selection

EscalationOpenPolicy may bind an automatic template only when template eligibility can itself be established by registered deterministic rules or pre-authorized operation metadata.

If deciding which template/profile applies requires free-form semantic judgment:

```text
→ HUMAN_MEDIATED
```

Do not invoke an LLM inside the authorization boundary to select a weaker automatic template.

### 4.7 Automatic-resolution eligibility (precise definition)

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

Any eligibility failure — including template supersession/invalidation (§5) and ungroundable scope-affecting bindings (§4.2) — keeps the Escalation OPEN and routes to Human-mediated handling or supersession.

---

## 5. Template supersession lifecycle for in-flight escalations (K2)

When a bound template is superseded or invalidated while its Escalation is OPEN:

Immutable history:

- materialized `resolution_requirements[]` remain immutable historical content;
- the stored `requirement_template_ref` / `requirement_template_version` / `requirement_parameter_bindings` MUST NOT be mutated in place;
- the Escalation MUST NOT be silently re-expanded or re-materialized under the successor template.

Evaluation:

- automatic `resolve_escalation` fails stale — the template is no longer current (§11.5);
- this is an eligibility failure under §4.7, whose fail-closed routing applies.

Conforming exits (explicit and authorized only):

```text
A. supersede_escalation
   old OPEN escalation → new OPEN escalation bound under the successor template
   (or any other currently authorized template, or HUMAN_MEDIATED),
   atomically preserving blocking continuity (§11.4);

B. human-mediated resolution
   the ordinary authorized Human/Design resolution path (§10.4) commits the
   ResolutionRecord + RESOLVED transition; the resolution basis and audit
   record that automatic evaluation was unavailable because the bound template
   was superseded/invalidated at evaluation time.
```

The Escalation may otherwise remain OPEN indefinitely under Human oversight (§12.3).

"Downgrade" in path B means the handling path, not an in-place edit: `resolution_mode` and the template binding are semantic content fixed at open; the explicit downgrade lives in the authorized resolution basis and audit trail, and the historical Escalation retains its original binding.

Non-conforming shortcuts:

- in-place re-materialization of requirements from the successor template;
- in-place mutation of template ref/version/bindings;
- accepting a stale-template automatic resolution without re-evaluation.

This adds no new reducer operation and no second control plane; it constrains the existing operations.

---

## 6. Work Item Authority Basis — canonical currentness

Automatic resolution MUST NOT infer current authority from:

- repository `main`/HEAD;
- wall-clock recency;
- a newer-looking commit;
- the packet's own authority list;
- an Agent assertion that something is current.

### 6.1 Currentness rules by dominant artifact class

#### A. Normative Git design/spec authority

For repo-backed normative contracts such as `noos_docs`:

```text
current = exact revision pinned by WorkItem.current_authority_basis_ref
```

A later commit on `main` is **not** automatically current for an in-flight Work Item. Changing the pin requires an explicit authorized authority-basis rebase (§6.2). This prevents both stale authority silently persisting forever and a running implementation silently changing semantics because the repository advanced.

#### B. Implementation target / candidate revision

For an implementation operation or review target:

```text
current = exact implementation revision(s) pinned by the source operation / Work Item
```

If PR head or implementation target moves materially, the operation target must be explicitly refreshed/superseded before resolution uses the new revision.

#### C. Mutable external observations, including GitHub comments

Mutable surfaces are never normative current authority merely because they are latest. NOOS consumes them as immutable SourceRef/result observations with:

```text
source ref
observed revision/time
content fingerprint
```

Freshness/currentness is evaluated by the escalation's evidence policy. A later edit creates a new observation; it cannot rewrite a committed basis.

#### D. Human authorization

Where PendingHumanGate applies, current Human authorization is the latest valid AuthorizationResult produced from the same immutable Proposal/gate chain under existing policy.

### 6.2 Authority-basis rebase

If Primary Design determines that the Work Item should adopt a newer normative authority revision:

```text
propose authority-basis rebase
→ Authority / Promotion Policy
→ Authorized Delta
→ Reducer commits new immutable AuthorityBasisSnapshot
→ WorkItem.current_authority_basis_ref changes
```

The old basis remains auditable. An Escalation result cannot itself mutate the basis pointer. A repo HEAD movement alone is not a valid invocation.

### 6.3 Resolution CAS against authority basis

Automatic `resolve_escalation` must carry:

```text
expected_current_authority_basis_ref
```

If the Work Item basis changed after validation began, resolution fails stale and must be re-evaluated.

---

## 7. Blocking semantics — total predicate, no second WAIT state

> **Every OPEN Escalation referencing a source operation is blocking.**

There is no `blocking` flag and no non-blocking Escalation subtype in V1. If information is advisory and must not block execution, represent it as a Review/Evidence/Note artifact rather than an Escalation.

Continuation eligibility is derived:

```text
can_continue(source_operation) =
  existing LogicalControl == CONTINUE
  AND count(Escalation where
            E.source_operation_ref == source_operation
            AND E.status == OPEN) == 0
  AND existing runtime/provider/SubmissionOperation gates pass
```

UI may project `WAIT(escalation_id, kind)`, but WAIT is not durable authority state.

With multiple OPEN Escalations, the operation remains blocked until all have been resolved or authoritatively disposed under the lifecycle rules (§12).

---

## 8. Escalation kinds

### NEEDS_DESIGN

Use only when safe continuation requires semantic/authority judgment outside delegated implementation freedom, including contract incompatibility, material unspecified product semantics, authority/provenance/identity/lifecycle gaps, runtime evidence falsifying a design assumption, or material architecture/product tradeoff.

Ordinary compiler errors, API discovery, refactors, UI selectors, implementation bugs, test construction, and debugging stay local.

### NEEDS_EVIDENCE

Use when the blocker is factual and can in principle be answered without semantic adjudication.

If the evidence changes the semantic problem, create a superseding NEEDS_DESIGN escalation; do not mutate kind in place.

### NEEDS_HUMAN

Escalation routes the Human request. It does not create a second approval system.

When the Human decision authorizes a Proposal, state transition, promotion, irreversible action, or external write already governed by V1 authority machinery:

```text
Escalation
→ references proposal_id / gate_id (§3.11 ordering)
→ PendingHumanGate
→ Human decision
→ Policy re-authorizes immutable Proposal
```

Non-authorization Human input may be captured as immutable evidence/result under policy.

Secrets/credentials must not be embedded in GitHub handoff artifacts.

---

## 9. Result realization

See §3.6 for the effective schema. Summary of rules:

- WorkerResult is the canonical durable result identity for managed threads; HandoffResult is the immutable result observation for external surfaces; no parallel result ledger.
- `resolution_claims[]` are keyed to materialized requirement IDs (§3.4).
- `completion_status` is descriptive only and never self-authorizes resume.
- No `result_kind`; no destination-authored `SUFFICIENT`.

---

## 10. ResolutionPolicy — blocker clearance, not semantic promotion

ResolutionPolicy is intentionally narrower than Authority/Promotion Policy. It answers only:

> Given already-existing authoritative/evidentiary facts and the current Work Item Authority Basis, may this specific Escalation blocker clear?

It does **not**:

- create new semantic authority;
- promote a Design proposal;
- approve Human-reserved actions;
- mutate Goal/Scope;
- change the Work Item Authority Basis.

If new semantic authority is needed, that authority must first be created through the existing Promotion/Authorization path.

### 10.1 Mandatory validation

Before automatic OPEN→RESOLVED, policy validates at least:

1. result ID/fingerprint exists and targets the exact escalation;
2. required refs resolve to immutable durable records;
3. authority role is eligible for this escalation kind;
4. `expected_current_authority_basis_ref` equals the Work Item's canonical pointer;
5. every normative authority ref is current/permitted under that basis and artifact-class rule;
6. implementation target refs still match the source operation's pinned target;
7. authority/evidence applies to the exact question and scope;
8. all mandatory decision/evidence dimensions are answered — realized deterministically as the requirement machinery of §10.2;
9. required PendingHumanGate/AuthorizationResult path is complete;
10. no already-known conflicting sufficient candidate requires higher authority.

A ref-shaped string, chat answer, or newer commit alone is never sufficient.

### 10.2 Deterministic requirement evaluation (automatic mode)

For `resolution_mode == AUTOMATIC_TEMPLATE_BOUND`, policy performs three separate checks for each materialized requirement:

```text
A. COVERAGE
   exactly this requirement_id is addressed by one or more immutable claims

B. APPLICABILITY
   the cited authority/evidence satisfies the requirement's declared
   applicability_rule_ref for the declared scope_selector

C. ACCEPTANCE
   the claim satisfies the requirement's declared acceptance_rule_ref
```

Coverage is structural. Applicability and acceptance MUST be evaluated by a registered deterministic rule belonging to the current `policy_version` / authority artifact class. Examples include:

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

### 10.3 Automatic-mode additional checks

Automatic `resolve_escalation` additionally requires:

```text
resolution_mode == AUTOMATIC_TEMPLATE_BOUND
template still eligible/current
non-empty requirement set
all materialized requirements PASS
validation bundle records exact template/rule versions
```

If the template was superseded or policy invalidates it before commit, CAS/policy validation fails stale and resolution must be re-evaluated (§5).

### 10.4 Human-mediated resolution

HUMAN_MEDIATED clearance is not an alternate hidden auto-policy.

It must consume a durable authorized Human/Design resolution basis appropriate to the escalation kind and existing authority model, then commit the ordinary immutable ResolutionRecord + RESOLVED transition.

The same human-mediated path is the conforming exit B for an OPEN AUTOMATIC_TEMPLATE_BOUND escalation whose bound template became superseded/invalidated (§5).

### 10.5 Non-authorization NEEDS_HUMAN sufficiency

A non-authorization NEEDS_HUMAN Escalation may resolve without PendingHumanGate only when:

1. the immutable result observation is Human-origin under an eligible Human authority role;
2. it targets the exact Escalation;
3. all required HUMAN_INPUT / other declared `resolution_requirements[]` are deterministically covered and pass their acceptance/applicability rules;
4. no gate-governed authorization is actually required by Policy;
5. normal authority-basis/currentness and conflict checks pass.

A Human-authored chat/comment alone does not bypass these provenance and scope checks.

---

## 11. Reducer operations

### 11.0 Core rule and canonical state

This extension does **not** create a new authority system. All operations are governed state transitions:

```text
Proposal
→ Authority / Promotion Policy
→ Authorized Delta
→ Reducer-equivalent atomic apply
→ ApplyResult + Audit Record
```

The LLM/adapter may propose. It may not directly mutate the canonical Work Item authority pointer or Escalation lifecycle.

Conceptually:

```text
CrossAgentControlState
- work_item_authority_basis_pointers: Map<work_item_id, authority_basis_ref>
- authority_basis_snapshots: Map<authority_basis_id, AuthorityBasisSnapshot>
- escalations: Map<escalation_id, Escalation>
- escalation_resolution_records: Map<resolution_id, EscalationResolutionRecord>
```

A conforming implementation may store these physically elsewhere, but it must provide equivalent serialized/crash-consistent semantics.

### 11.1 Shared idempotency semantics

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

### 11.2 `commit_work_item_authority_basis`

Purpose: create a new immutable `AuthorityBasisSnapshot` and atomically make it the canonical current basis for one Work Item.

Input:

```text
work_item_id
expected_current_authority_basis_ref: ref | null
new_authority_basis_snapshot
transition_authority_ref
actor
now
```

Preconditions:

- expected pointer equals canonical current pointer;
- new snapshot belongs to the same Work Item;
- new snapshot has a new stable ID and immutable fingerprint;
- if replacing an existing basis, `supersedes_authority_basis_id` points to the current basis;
- transition is authorized by the existing State/Scope/Decision authority policy;
- monotonic/audit invariants pass.

Apply (atomic):

```text
persist immutable AuthorityBasisSnapshot
set WorkItem.current_authority_basis_ref = new snapshot ref
persist ApplyResult / AuditRecord
```

A repo HEAD movement alone is not a valid invocation.

Race behavior: two concurrent rebases from the same expected basis cannot both commit. The loser is stale and must rebase its proposal.

### 11.3 `open_escalation`

Purpose: persist the blocking coordination fact **before** any cross-agent transport.

Input:

```text
escalation
expected_current_authority_basis_ref
actor
now
```

Preconditions:

- `escalation.status == OPEN`;
- `lifecycle_revision == 0`;
- semantic fields are complete/valid;
- `authority_basis_ref` equals the current Work Item authority basis at open time;
- source operation/work item exists;
- stable `escalation_id` is unused, or create-or-get identity matches exactly.

For every Escalation, persist/validate `resolution_mode`.

For `AUTOMATIC_TEMPLATE_BOUND`, additionally require:

```text
registered current template
matching escalation kind/profile
eligible source + authority roles
valid parameter bindings, with every scope-affecting binding
  deterministically grounded per its binding_grounding_rule (§4.2)
non-empty deterministic expansion
exact requirement-set fingerprint
all rules registered under current policy version
gate-governed NEEDS_HUMAN carries the required Proposal/gate refs (§3.11)
each requirement ID is unique and has declared applicability/acceptance rules
```

Failure of any automatic-mode check:

```text
→ explicit Policy outcome: open as HUMAN_MEDIATED
OR
→ reject open if caller required automatic mode
```

Apply:

```text
persist immutable Escalation semantic content
status = OPEN
lifecycle_revision = 0
persist ApplyResult / AuditRecord
```

Only after successful apply may HandoffPacket transport begin.

Create-or-get:

```text
same escalation_id + same immutable fingerprint
→ return existing OPEN/terminal record

same escalation_id + different immutable fingerprint
→ rejected_invariant
```

### 11.4 `supersede_escalation`

Purpose: replace one semantic question with another without creating a moment in which a still-runnable source operation has no blocker. This is also conforming exit A for template supersession (§5).

Input:

```text
old_escalation_id
expected_old_lifecycle_revision
new_escalation
expected_current_authority_basis_ref
supersession_basis_ref
actor
now
```

Preconditions:

- old escalation is OPEN;
- old lifecycle revision matches;
- new escalation is OPEN revision 0;
- new `source_operation_ref` is the same source operation;
- `new.supersedes_escalation_id == old_escalation_id`;
- current Work Item authority basis matches expectation;
- supersession basis is authorized/valid.

Apply — one atomic transaction:

```text
persist new OPEN escalation
old.status = WITHDRAWN
old.withdrawal_reason = SUPERSEDED
old.superseded_by_escalation_id = new.escalation_id
old.lifecycle_revision += 1
persist ApplyResult / AuditRecord
```

There is no intermediate durable state where the old blocker is withdrawn before the successor exists.

Replay: same authorized delta returns the original apply result and the same pair of escalation identities.

### 11.5 `resolve_escalation`

Purpose: clear an OPEN blocker only after source-side ResolutionPolicy has validated an immutable result against the **current** Work Item Authority Basis.

Input:

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

Preconditions:

- escalation exists and is OPEN;
- lifecycle revision matches;
- canonical Work Item authority basis equals the expected ref;
- result ID/fingerprint is an immutable known result targeting this escalation;
- ResolutionPolicy passes all mandatory checks (§10.1) and, for automatic mode, the template/requirement checks (§10.2–10.3);
- candidate ResolutionRecord fingerprints the exact result/basis/evidence used;
- no known conflicting sufficient candidate requires higher authority.

Apply — one atomic transaction:

```text
persist immutable EscalationResolutionRecord
escalation.status = RESOLVED
escalation.resolution_record_id = resolution_id
escalation.resolved_at = now
escalation.lifecycle_revision += 1
persist ApplyResult / AuditRecord
```

Idempotent resolution receipt — in addition to ordinary `delta_id` replay:

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

A late conflicting result cannot rewrite the historical record; it surfaces through §14.

### 11.6 `withdraw_escalation`

Purpose: close an OPEN escalation only when an explicit authorized basis proves that removing this blocker cannot create unsafe silent continuation.

Input:

```text
escalation_id
expected_lifecycle_revision
withdrawal_reason
withdrawal_basis_ref
expected_source_operation_state/ref
actor
now
```

Allowed cases — standalone withdrawal is allowed only when at least one is proven under policy:

1. source operation is already terminal/cancelled/superseded (`withdrawal_disposition = SOURCE_NOT_RUNNABLE`); or
2. an authorized Goal/Scope/operation transition makes this question obsolete and independently establishes continuation safety (`withdrawal_disposition = CONTINUATION_SAFETY_ESTABLISHED`).

For semantic replacement of a question on a live operation, use `supersede_escalation` instead.

Forbidden case:

```text
OPEN escalation on runnable source
→ arbitrary withdraw
→ no other blocker
→ source resumes
```

is non-conforming. If a source owner merely wants to stop waiting but cannot establish one of the two dispositions, `withdraw_escalation` MUST reject and the Escalation remains OPEN.

Apply:

```text
status = WITHDRAWN
withdrawal_reason/basis/disposition persisted
continuation_basis_ref persisted
withdrawn_at = now
lifecycle_revision += 1
persist ApplyResult / AuditRecord
```

A successful standalone withdrawal is itself the authoritative proof that removal of this blocker is safe under one of the two enumerated dispositions. No separate re-arm marker is created.

### 11.7 Derived blocking query

There is no reducer operation `set_wait` / `clear_wait`.

```text
has_escalation_blocker(op) =
  exists E where
    E.source_operation_ref == op
    AND E.status == OPEN
```

V1 invariant: every OPEN Escalation is blocking. Continuation still additionally requires existing `LogicalControl == CONTINUE` and the ordinary runtime/dispatch gates.

Withdrawn blockers are absent only because the authorized withdraw reducer already established one of the two allowed dispositions (§3.9).

### 11.8 Restart / recovery

After restart, control state is reconstructed only from durable records:

- canonical Work Item authority-basis pointer;
- immutable AuthorityBasisSnapshots;
- Escalation records and lifecycle revisions;
- EscalationResolutionRecords;
- ApplyResults/Audit records.

No in-memory WAIT flag is required.

If crash occurs:

**after Escalation persisted but before transport** — rediscover the same OPEN escalation and transport the same/new packet revision under the same escalation ID.

**after result observed but before resolution apply** — re-run ResolutionPolicy against current basis and retry the same authorized delta or create a fresh delta after stale revalidation.

**after resolution committed but acknowledgement lost** — same-delta replay returns original ApplyResult; same-result resolution create-or-get returns the existing ResolutionRecord.

### 11.9 Current-authority race

Resolution validation and authority-basis rebase must serialize through expectations.

**Resolution commits first** — it records the exact basis ref used. Later basis rebase does not rewrite historical resolution.

**Authority-basis rebase commits first** — a resolution carrying the old `expected_current_authority_basis_ref` is rejected stale and must be revalidated against the new basis.

This is deliberate: automatic resume must never race past a changed authority basis.

### 11.10 Relation to Promotion / Authorization Policy

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

## 12. Supersession and withdrawal semantics

Because every OPEN Escalation blocks, withdrawal rules must not create a hidden resume path.

### 12.1 Supersession

For a live source operation:

```text
open successor E2
+ withdraw E1 as SUPERSEDED
```

must be one atomic reducer operation (§11.4) so at least one blocker remains continuously OPEN.

Do not mutate kind in place:

```text
E11 NEEDS_EVIDENCE
→ evidence falsifies assumption
→ create E12 NEEDS_DESIGN, supersedes=E11
→ atomically withdraw E11 as SUPERSEDED while E12 is OPEN
```

### 12.2 Standalone withdrawal

Standalone OPEN→WITHDRAWN is allowed only under the dispositions of §3.9/§11.6. A mere Human/Agent request to "withdraw" is not sufficient for a still-runnable operation.

### 12.3 Indefinite wait

V1 permits an OPEN Escalation to remain OPEN indefinitely under Human oversight. No automatic timeout is required. Timeout→NEEDS_HUMAN policy is deferred.

---

## 13. Competing results

Multiple immutable result candidates may target one OPEN Escalation.

1. observation does not mutate Escalation;
2. resolve uses expected OPEN lifecycle revision and expected authority basis ref;
3. one sufficient non-conflicting candidate may atomically win;
4. if conflicting sufficient candidates are known before commit, fail closed to higher authority/Human;
5. after RESOLVED, later results cannot rewrite the ResolutionRecord;
6. materially conflicting later evidence opens a new review/evidence/design escalation.

No semantic result merging in V1.

---

## 14. Post-resolution result notices

Do not require NOOS to decide whether a late result is "materially conflicting" before surfacing it; that phrase would itself require the semantic judge §10 forbids.

Every distinct immutable result observed for an already RESOLVED Escalation MUST be recorded as a durable `PostResolutionResultNotice` (§3.10) and routed/surfaced to the source-operation owner/Human:

- `DISTINCT_LATE_RESULT` — distinct result identity observed after RESOLVED;
- `RESULT_ID_FINGERPRINT_CONFLICT` — same `result_id`, different `result_fingerprint` observed after RESOLVED (freeze the immutable new observation first).

Owner: the durable source-operation owner / Work Item owner policy target. If no non-Human owner can be resolved, surface to Human.

NOOS MUST make `PENDING_REVIEW` visible; silently recording the late candidate in the mailbox is non-conforming, and the fingerprint-conflict case must not end as a silent invariant rejection in transport code.

A late result (either kind):

- never rewrites the historical ResolutionRecord;
- never silently reopens the resolved Escalation;
- does not automatically block the already-running source operation merely because it is distinct;
- MUST be triaged by policy/Human.

If triage determines that the late result creates a real unresolved authority/evidence issue, create a **new** blocking Escalation with explicit provenance back to the notice/result.

This avoids both unsafe silent suppression and an LLM-based automatic semantic-conflict classifier.

---

## 15. GitHub prototype durability

GitHub is mailbox/artifact transport, not semantic authority.

### Persist before post

```text
persist Escalation
→ persist HandoffPacket
→ attempt GitHub post
```

Lost acknowledgement reuses the same identities.

### Mutable comment handling

When consuming a GitHub comment/result, freeze an immutable observation:

```text
comment/source ref
observed revision/time
content fingerprint
parsed result_id
```

Later edits create new observations and cannot rewrite a committed resolution basis.

### Result dedup

```text
same result_id + same fingerprint → replay/create-or-get
same result_id + different fingerprint
  → before RESOLVED: invariant conflict at observation
  → after RESOLVED: RESULT_ID_FINGERPRINT_CONFLICT notice (§14)
```

---

## 16. Routing

Durable routing targets role/Logical Thread, not current surface.

```text
PRIMARY_DESIGN
→ current Primary Design Logical Thread
→ current Provider Conversation
→ current eligible Carrier
```

Coding-agent routing may use the current runtime/session projection with the GitHub work item as durable discovery anchor.

Never make tab ID, terminal PID, or stale provider conversation the semantic route identity.

---

## 17. Goal/Scope changes

A result cannot silently mutate Goal/Scope.

If resolution requires a material scope/goal change:

```text
result identifies change
→ existing Proposal/Authorization path
→ Work Item/source operation state changes explicitly
→ policy determines whether same operation remains valid or is superseded
```

Only then may the corresponding Escalation resolve/withdraw under the reducer rules.

---

## 18. Non-goals and settled structural decisions

V1 does not define:

- a general multi-agent scheduler;
- arbitrary peer-to-peer agent messaging;
- automatic Integration arbitration;
- full GitHub Project synchronization;
- final universal JSON/database schemas beyond the contracts needed for the prototype;
- cross-machine coding-agent session takeover;
- autonomous Human approval;
- semantic merging of competing adjudications;
- automatic repository-HEAD adoption as current authority;
- automatic timeout/escalation chains beyond the explicit V1 rules.

Settled structural decisions that MUST NOT be reintroduced:

- a second durable WAIT/RUN control plane;
- `requires_explicit_rearm` as a parallel control bit;
- a second result ledger parallel to WorkerResult/ResultDelivery;
- destination-authored `SUFFICIENT`;
- `result_kind`;
- an LLM semantic judge inside ResolutionPolicy — including for binding faithfulness (§4.2), template selection (§4.6), or late-result classification (§14);
- automatic semantic pre-filtering of late results;
- repository HEAD as implicit current authority.

---

## 19. Prototype boundary and automatic-resume gate

### #10 GitHub mailbox

May proceed with:

- persisted Escalation identity before post;
- immutable packet identity/revision/fingerprint;
- marker discovery;
- create-or-get;
- immutable observation capture;
- result dedup/provenance.

Marker envelopes MUST NOT emit `result_kind` or any destination-authored sufficiency field.

### #11 / #12 automatic resume — blocked

Automatic resume remains blocked until implementation provides and focused independent conformance review verifies **all** of:

1. Work Item Authority Basis/current-pointer semantics;
2. registered/versioned `ResolutionRequirementTemplate` policy and `resolution_mode` gating, **including deterministic binding-faithfulness for scope-affecting parameter bindings under registered binding-grounding rules (§4.2)**: every scope-affecting binding derived from or cross-checked against immutable escalation/source-operation grounding refs, with ungroundable bindings failing closed;
3. deterministic non-empty template materialization + requirement claims + registered applicability/acceptance rules, with fail-closed behavior and no LLM semantic judge;
4. escalation reducer operations + idempotent resolution receipt;
5. withdrawal disposition semantics with no arbitrary OPEN→WITHDRAWN path;
6. post-resolution result/edit-conflict notice + visible owner surfacing;
7. PendingHumanGate reference ordering for gate-governed NEEDS_HUMAN.

In particular:

> Implementing deterministic rule execution without template-authority closure is insufficient for automatic resume.

The acceptance bar itself must be independently registered/authorized rather than source-authored, and its parameter bindings must be grounded.

Human-mediated resume remains the valid fail-closed path before this gate passes.

### #13 E2E

Target flow:

```text
Design handoff
→ coding work
→ genuine Escalation
→ durable route to current authority role
→ immutable result
→ ResolutionPolicy against canonical Authority Basis
→ reducer resolution receipt
→ same source operation resumes
```

---

## 20. Minimal invariants

1. Same bounded work identity survives escalation round trip.
2. Escalation identity is distinct from transport/result identity.
3. Escalation semantic content is immutable.
4. Every OPEN Escalation is blocking in V1.
5. There is no second durable WAIT/RUN authority state.
6. Work Item Authority Basis, not repository recency, defines normative currentness.
7. Authority-basis pointer changes only through authorized reducer transition.
8. Resolution CAS checks the current authority-basis pointer.
9. HandoffPacket is immutable projection, never canonical authority.
10. Managed-thread results reuse WorkerResult/ResultDelivery.
11. Result delivery does not resolve an Escalation.
12. ResolutionPolicy clears blockers but does not create semantic authority.
13. ResolutionRecord + RESOLVED commit crash-consistently.
14. Human approval reuses PendingHumanGate where applicable.
15. Supersession preserves blocking continuity.
16. Standalone withdrawal cannot silently make unsafe work runnable.
17. Mutable GitHub comments cannot rewrite consumed provenance.
18. Duplicate/replayed transport does not create duplicate semantic records.
19. Goal/Scope changes remain explicit authority transitions.
20. A later repo commit is not automatically current for an in-flight Work Item.
21. `resolution_mode` is authorized by `open_escalation` policy, never proposer-owned; free-form escalations are HUMAN_MEDIATED.
22. AUTOMATIC_TEMPLATE_BOUND requires a registered current template with non-empty deterministic materialization; the worker never authors the acceptance bar.
23. Every scope-affecting parameter binding is deterministically grounded in immutable escalation/source-operation facts; ungroundable bindings fail closed (K1).
24. Template supersession never silently re-materializes or mutates an OPEN escalation's requirements or binding; conforming exits are supersession or human-mediated resolution (K2).
25. Post-resolution notices (`DISTINCT_LATE_RESULT` / `RESULT_ID_FINGERPRINT_CONFLICT`) are visibly surfaced with an owner and never rewrite or reopen the historical resolution.

---

## 21. Minimal conformance tests

Before automatic resume ships, tests should cover at least:

**Identity / open**

1. open persists before transport;
2. same escalation create-or-get (same ID + fingerprint);
3. same ID / different fingerprint rejects;

**Template authority (M1/M2)**

4. free-form requirement set + requested automatic mode ⇒ reject or explicit policy downgrade to HUMAN_MEDIATED only;
5. registered template + valid bindings ⇒ deterministic non-empty requirement materialization;
6. worker cannot weaken/delete a template blueprint acceptance rule;
7. unknown/superseded template ⇒ automatic resolution ineligible;
8. empty materialized requirement set ⇒ automatic resolution rejects;
9. automatic mode with no template ⇒ rejects;
10. Human-mediated free-form escalation never auto-resolves from a routine result;
11. generic NEEDS_DESIGN chat clarification without promoted/template-required authority artifact ⇒ does not auto-resolve;
12. exact template/rule versions recorded in the resolution validation bundle;

**Binding faithfulness (K1)**

13. scope-affecting parameter value not matching any authorized immutable escalation/source-operation grounding ref ⇒ automatic mode fails closed at open (reject or explicit HUMAN_MEDIATED downgrade);
14. binding faithfulness decided only by registered deterministic rule execution; no LLM judgment path exists in the pipeline;

**Template supersession lifecycle (K2)**

15. template superseded while escalation OPEN ⇒ stored requirements/binding remain immutable; silent in-place re-materialization or binding mutation is non-conforming;
16. stale-template automatic resolution fails stale; conforming exits are supersession to a new escalation or an authorized human-mediated resolution basis;

**Blocking / lifecycle**

17. every OPEN escalation blocks;
18. two OPEN escalations require both to clear;
19. supersession atomically preserves one OPEN blocker;
20. standalone unsafe withdrawal rejects;
21. authorized safe withdrawal persists disposition/basis and restart remains deterministic;

**Resolution / idempotency**

22. missing required requirement ID ⇒ automatic resolution rejects;
23. unknown/unregistered applicability or acceptance rule ⇒ fail closed without LLM judgment;
24. all required requirements PASS ⇒ eligible for reducer resolution subject to ordinary checks;
25. resolution rejects stale lifecycle revision;
26. resolution rejects stale authority-basis pointer;
27. resolution persists record + RESOLVED atomically;
28. same delta replay does not duplicate resolution;
29. same result retry returns existing resolution receipt;
30. different result after resolution cannot overwrite record;
31. concurrent authority-basis rebase vs resolution serializes correctly;

**NEEDS_HUMAN**

32. gate-governed NEEDS_HUMAN without gate refs ⇒ open rejects;
33. non-authorization Human input resolves only through requirement coverage + eligible Human provenance;

**Post-resolution notices**

34. distinct late result after RESOLVED ⇒ visible `DISTINCT_LATE_RESULT` notice;
35. same result_id + different fingerprint after RESOLVED ⇒ visible `RESULT_ID_FINGERPRINT_CONFLICT` notice;
36. neither notice rewrites the historical ResolutionRecord or silently auto-blocks/reopens;
37. notice triage may create a new Escalation but cannot mutate the old one;

**Restart**

38. restart derives blocking without an in-memory WAIT state.

---

## 22. Working conclusion

The automatic path is intentionally narrow:

```text
worker discovers blocker
        ↓
open_escalation Policy
        ├─ no deterministic authorized template
        │      → HUMAN_MEDIATED
        │
        └─ registered template applicable
               → AUTOMATIC_TEMPLATE_BOUND
               → scope-affecting bindings deterministically grounded (K1)
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

And when authority moves under an in-flight escalation:

```text
bound template superseded / invalidated while OPEN
        ↓
requirements + binding stay immutable; automatic resolve fails stale (K2)
        ↓
explicit exit only:
   supersede to a newly-bound escalation
   OR resolve through an authorized human-mediated basis
```

The overall boundary:

```text
bounded work retains identity
        ↓
worker reaches delegated authority/evidence boundary
        ↓
immutable Escalation persisted
        ↓
packet compiled against explicit Work Item Authority Basis
        ↓
role-aware late-bound transport
        ↓
immutable result observed
        ↓
source-side policy validates exact current basis + scope + sufficiency
        ↓
reducer atomically records resolution
        ↓
OPEN blocker disappears
        ↓
same bounded work may continue under ordinary gates
```

Human clipboard/routing work should disappear; Human authority remains wherever policy reserves it.
