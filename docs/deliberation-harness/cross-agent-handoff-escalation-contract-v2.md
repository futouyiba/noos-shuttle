# NOOS Deliberation Harness — Cross-Agent Handoff / Escalation Contract v2

> Status: Working Design Candidate / post re-review closure
>
> Supersedes: `cross-agent-handoff-escalation-contract-v1.md`
>
> Parent feature: `noos-shuttle#7`
>
> Prior review targets:
> - v0 exact review target: `12fccf6024b10b1cc2c9eeece6c56c5bca2e5645`
> - v1 exact re-review target: `6f7c52291075e8182f48ccb8d2f4585de62c5ad1`
>
> Re-review verdict: APPROVE with automatic-resume preconditions R1–R3 and hygiene findings R4–R6.
>
> Authority baseline: V1 Deliberation Harness authority in `futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1`.

## 0. One-sentence decision

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
```

---

## 1. Reuse existing identities; add one coordination primitive

Existing V1 concepts remain authoritative for their existing domains:

- Work Item — durable desired work identity;
- Logical Thread — durable role/work continuity;
- Provider Conversation / Browser Carrier — replaceable execution surfaces;
- Proposal / AuthorizationResult / PendingHumanGate — state/action authorization;
- SubmissionOperation — durable provider actuation intent;
- WorkerResult / ResultDelivery — managed-worker result identity and delivery;
- SourceRef / EvidenceRef — immutable evidence provenance;
- State Delta / Reducer / ApplyResult — authoritative local state transition boundary.

The missing coordination fact is:

> a still-active source operation has reached a bounded authority/evidence frontier that it cannot safely cross under its delegated scope.

V2 retains one additional coordination primitive:

```text
Escalation
```

`HandoffPacket` is a compiled projection. `HandoffResult` is a transport-neutral result shape when no existing WorkerResult identity applies.

---

## 2. Escalation object

### 2.1 Schema

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
- supersedes_escalation_id?
- status: OPEN | RESOLVED | WITHDRAWN
- lifecycle_revision
- resolution_record_id?
- withdrawal_reason?
- superseded_by_escalation_id?
- created_at
- resolved_at?
- withdrawn_at?
```

`destination_role` is semantic. Concrete provider conversation/tab/session is late-bound.

### 2.2 Immutability

After creation, semantic content is immutable:

```text
kind
blocker/question
source identity
role targets
authority_basis_ref captured at open time
authority/evidence/implementation refs
supersedes relation
```

Only lifecycle metadata may advance through authorized reducer operations.

If the question changes materially, create a new Escalation ID.

### 2.3 Supersession

Do not mutate kind in place.

```text
E11 NEEDS_EVIDENCE
→ evidence falsifies assumption
→ create E12 NEEDS_DESIGN, supersedes=E11
→ atomically withdraw E11 as SUPERSEDED while E12 is OPEN
```

The supersession operation must preserve blocking continuity.

---

## 3. Work Item Authority Basis — canonical currentness for automatic resolution

R1 is closed by making currentness explicit and **work-item scoped**.

Automatic resolution MUST NOT infer current authority from:

- repository `main`/HEAD;
- wall-clock recency;
- a newer-looking commit;
- the packet's own authority list;
- an Agent assertion that something is current.

### 3.1 AuthorityBasisSnapshot

Every Work Item that permits automatic escalation resolution MUST have a durable immutable authority-basis snapshot referenced by a canonical Work Item pointer.

Conceptually:

```text
AuthorityBasisSnapshot
- authority_basis_id
- work_item_id
- basis_revision
- entries[]
- supersedes_authority_basis_id?
- authorized_transition_ref
- created_at
```

Each entry identifies an authority class and its currentness rule, for example:

```text
AuthorityBasisEntry
- authority_class
- scope_selector
- canonical_source
- exact_revision_ref?
- policy_ref?
- currentness_rule
```

The canonical pointer is:

```text
WorkItem.current_authority_basis_ref
```

It belongs to authoritative NOOS State, not to GitHub comments, adapters, or LLM context.

Only an authorized State Delta / Reducer-equivalent transition may replace this pointer.

### 3.2 V1/V2 currentness rules by dominant artifact class

#### A. Normative Git design/spec authority

For repo-backed normative contracts such as `noos_docs`:

```text
current = exact revision pinned by WorkItem.current_authority_basis_ref
```

A later commit on `main` is **not** automatically current for an in-flight Work Item.

Changing the pin requires an explicit authorized authority-basis rebase.

This prevents both:

- stale authority silently persisting forever; and
- a running implementation silently changing semantics because the repository advanced.

#### B. Implementation target / candidate revision

For an implementation operation or review target:

```text
current = exact implementation revision(s) pinned by the source operation / Work Item
```

If PR head or implementation target moves materially, the operation target must be explicitly refreshed/superseded before resolution uses the new revision.

#### C. Mutable external observations, including GitHub comments

Mutable surfaces are never normative current authority merely because they are latest.

NOOS consumes them as immutable SourceRef/result observations with:

```text
source ref
observed revision/time
content fingerprint
```

Freshness/currentness is evaluated by the escalation's evidence policy. A later edit creates a new observation; it cannot rewrite a committed basis.

#### D. Human authorization

Where PendingHumanGate applies, current Human authorization is the latest valid AuthorizationResult produced from the same immutable Proposal/gate chain under existing policy.

### 3.3 Authority-basis rebase

If Primary Design determines that the Work Item should adopt a newer normative authority revision:

```text
propose authority-basis rebase
→ Authority / Promotion Policy
→ Authorized Delta
→ Reducer commits new immutable AuthorityBasisSnapshot
→ WorkItem.current_authority_basis_ref changes
```

The old basis remains auditable.

An Escalation result cannot itself mutate the basis pointer.

### 3.4 Resolution CAS against authority basis

Automatic `resolve_escalation` must carry:

```text
expected_current_authority_basis_ref
```

If the Work Item basis changed after validation began, resolution fails stale and must be re-evaluated.

---

## 4. Blocking semantics — total predicate, no second WAIT state

R2 is closed with the simplest deterministic V1 rule:

> **Every OPEN Escalation referencing a source operation is blocking.**

There is no `blocking` flag and no non-blocking Escalation subtype in V1.

If information is advisory and must not block execution, represent it as a Review/Evidence/Note artifact rather than an Escalation.

Continuation eligibility is derived:

```text
can_continue(source_operation) =
  existing LogicalControl == CONTINUE
  AND count(Escalation where
            E.source_operation_ref == source_operation
            AND E.status == OPEN) == 0
  AND existing runtime/provider/SubmissionOperation gates pass
```

UI may project:

```text
WAIT(escalation_id, kind)
```

but WAIT is not durable authority state.

With multiple OPEN Escalations, the operation remains blocked until all have been resolved or authoritatively disposed under the lifecycle rules below.

---

## 5. Escalation kinds

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
→ references proposal_id / gate_id
→ PendingHumanGate
→ Human decision
→ Policy re-authorizes immutable Proposal
```

Non-authorization Human input may be captured as immutable evidence/result under policy.

Secrets/credentials must not be embedded in GitHub handoff artifacts.

---

## 6. HandoffPacket — immutable projection

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

---

## 7. Result realization

### 7.1 HandoffResult shape

R6 is closed by **removing `result_kind`** rather than adding a second descriptive taxonomy.

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
- created_at
```

`completion_status` is descriptive only:

```text
COMPLETE
PARTIAL
BLOCKED
FAILED_SAFE
```

It never self-authorizes resume.

### 7.2 WorkerResult unification

When the destination is a Harness-managed thread that already produces WorkerResult:

- WorkerResult is the canonical durable result identity;
- reuse the same `result_id`;
- cross-agent resolution payload is carried/referenced by WorkerResult;
- existing ResultDeliveryKey / DELIVER_CHILD_RESULT semantics apply where a return is required;
- do not mint a parallel result ledger.

When the destination is an external/non-worker surface, NOOS may persist HandoffResult as the immutable result observation.

---

## 8. ResolutionPolicy — blocker clearance, not semantic promotion

ResolutionPolicy is intentionally narrower than Authority/Promotion Policy.

It answers only:

> Given already-existing authoritative/evidentiary facts and the current Work Item Authority Basis, may this specific Escalation blocker clear?

It does **not**:

- create new semantic authority;
- promote a Design proposal;
- approve Human-reserved actions;
- mutate Goal/Scope;
- change the Work Item Authority Basis.

If new semantic authority is needed, that authority must first be created through the existing Promotion/Authorization path.

### 8.1 Mandatory validation

Before automatic OPEN→RESOLVED, policy validates at least:

1. result ID/fingerprint exists and targets the exact escalation;
2. required refs resolve to immutable durable records;
3. authority role is eligible for this escalation kind;
4. `expected_current_authority_basis_ref` equals the Work Item's canonical pointer;
5. every normative authority ref is current/permitted under that basis and artifact-class rule;
6. implementation target refs still match the source operation's pinned target;
7. authority/evidence applies to the exact question and scope;
8. all mandatory decision/evidence dimensions are answered;
9. required PendingHumanGate/AuthorizationResult path is complete;
10. no already-known conflicting sufficient candidate requires higher authority.

A ref-shaped string, chat answer, or newer commit alone is never sufficient.

---

## 9. EscalationResolutionRecord

Successful automatic/manual policy resolution creates an immutable operational receipt:

```text
EscalationResolutionRecord
- resolution_id
- escalation_id
- result_id
- result_fingerprint
- authority_basis_ref
- resolution_outcome
- authority_basis_refs[]
- evidence_basis_refs[]
- validation_evidence_refs[]
- policy_id / policy_version
- decided_by
- created_at
```

This is **not** design authority and does not replace AuthorizationResult/ApplyResult.

It records why the already-authorized/evidenced blocker was allowed to clear.

`ResolutionRecord + Escalation RESOLVED` commit atomically under the reducer extension defined in `cross-agent-handoff-escalation-reducer-operations-v0.md`.

---

## 10. Escalation lifecycle operations

R3 is closed normatively by the dedicated extension:

`cross-agent-handoff-escalation-reducer-operations-v0.md`

V1/V2 operations are:

```text
commit_work_item_authority_basis
open_escalation
supersede_escalation
withdraw_escalation
resolve_escalation
```

They follow the same authority shape as existing binding reducer operations:

```text
Proposal
→ Policy
→ Authorized Delta
→ Reducer
→ crash-consistent ApplyResult / audit
```

Semantic Escalation content is immutable; reducer operations only create records or advance lifecycle metadata.

---

## 11. Supersession and withdrawal

Because every OPEN Escalation blocks, withdrawal rules must not create a hidden resume path.

### 11.1 Supersession

For a live source operation:

```text
open successor E2
+ withdraw E1 as SUPERSEDED
```

must be one atomic reducer operation so at least one blocker remains continuously OPEN.

### 11.2 Standalone withdrawal

Standalone OPEN→WITHDRAWN is allowed only when an explicit authorized basis proves that removing the blocker cannot silently resume unsafe work, for example:

- source operation is CANCELLED/COMPLETED/SUPERSEDED;
- an authorized Goal/Scope/operation transition makes the question obsolete and independently establishes continuation safety.

A mere Human/Agent request to "withdraw" is not sufficient for a still-runnable operation.

### 11.3 Indefinite wait

V1 permits an OPEN Escalation to remain OPEN indefinitely under Human oversight. No automatic timeout is required.

Timeout→NEEDS_HUMAN policy is deferred.

---

## 12. Competing results

Multiple immutable result candidates may target one OPEN Escalation.

1. observation does not mutate Escalation;
2. resolve uses expected OPEN lifecycle revision and expected authority basis ref;
3. one sufficient non-conflicting candidate may atomically win;
4. if conflicting sufficient candidates are known before commit, fail closed to higher authority/Human;
5. after RESOLVED, later results cannot rewrite the ResolutionRecord;
6. materially conflicting later evidence opens a new review/evidence/design escalation.

No semantic result merging in V1.

---

## 13. GitHub prototype durability

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
same result_id + different fingerprint → invariant conflict
```

---

## 14. Routing

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

## 15. Goal/Scope changes

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

## 16. Explicit non-goals

R4 is closed by carrying forward the V0 boundaries.

V1/V2 does not define:

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

---

## 17. Prototype boundary

### #10 GitHub mailbox

May proceed with:

- persisted Escalation identity before post;
- immutable packet identity/revision/fingerprint;
- marker discovery;
- create-or-get;
- immutable observation capture;
- result dedup/provenance.

### #11 / #12 automatic resume

Automatic resume remains blocked until:

1. Work Item Authority Basis/current pointer semantics are implemented;
2. escalation reducer operations are implemented with idempotent receipts/CAS;
3. the implementation passes focused conformance review against this contract and the reducer extension.

Human-mediated resume remains a valid fail-closed prototype path before then.

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

## 18. Minimal invariants

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

---

## 19. Working conclusion

The design center is:

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