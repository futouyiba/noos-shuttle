# NOOS Deliberation Harness — Cross-Agent Handoff / Escalation Contract v1

> Status: Working Design Candidate / revision after Issue #15 review
>
> Supersedes candidate: `cross-agent-handoff-escalation-contract-v0.md`
>
> Parent feature: `noos-shuttle#7`
>
> Review input: PR #14 independent review on exact target `12fccf6024b10b1cc2c9eeece6c56c5bca2e5645`
>
> Authority dependencies: V1 Deliberation Harness authority in `futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1`.

## 0. One-sentence decision

Cross-agent Design ↔ Implementation is not generic agent messaging.

V1 models it as:

> an active bounded operation that may open an immutable durable authority-aware `Escalation`; NOOS compiles immutable destination-specific `HandoffPacket` projections, routes them late to the correct authority role, captures immutable results, and resumes the same source operation only after deterministic `ResolutionPolicy` validation commits a durable resolution basis.

The central rule is:

```text
transported answer != authority
result delivery != escalation resolution
escalation resolution != semantic acceptance outside its delegated scope
```

---

## 1. Reuse existing identities; add one coordination primitive

Existing V1 concepts remain authoritative for their existing domains:

- Work Item — desired work identity;
- Logical Thread — durable role/work continuity;
- Provider Conversation / Browser Carrier — replaceable execution surfaces;
- Proposal / AuthorizationResult / PendingHumanGate — state/action authorization;
- SubmissionOperation — durable provider actuation intent;
- WorkerResult / ResultDelivery — managed child-worker result identity and delivery;
- SourceRef / EvidenceRef — immutable evidence provenance.

The missing coordination fact is:

> a still-active source operation cannot safely continue one bounded frontier until another authority/evidence source answers an immutable question.

V1 adds:

```text
Escalation
```

`HandoffPacket` is a compiled projection. `HandoffResult` is a transport-neutral result shape/observation and is not always a separate ledger identity.

---

## 2. Escalation object

### 2.1 Conceptual schema

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
- authority_refs[]
- evidence_refs[]
- implementation_revision_refs[]
- supersedes_escalation_id?
- status: OPEN | RESOLVED | WITHDRAWN
- resolution_record_id?
- withdrawal_reason?
- superseded_by_escalation_id?
- created_at
- resolved_at?
- withdrawn_at?
```

`destination_role` is semantic. A concrete provider conversation/tab/session is selected only by routing/transport.

### 2.2 Immutability

After creation, the semantic content of an Escalation is immutable:

```text
kind
blocker/question
source identity
role targets
authority/evidence/revision refs
supersedes relation
```

must not be silently edited.

Only authorized lifecycle metadata may advance through explicit transitions.

If the semantic question changes materially, create a new Escalation ID.

### 2.3 Supersession, not kind conversion

Do not mutate:

```text
E11 NEEDS_EVIDENCE
→ E11 NEEDS_DESIGN
```

Instead:

```text
E11 NEEDS_EVIDENCE
→ evidence falsifies assumption
→ create E12 NEEDS_DESIGN
   supersedes_escalation_id = E11
→ withdraw E11(reason = SUPERSEDED, superseded_by = E12)
```

The original question remains auditable.

---

## 3. Source operation retains work identity

Opening an Escalation does not finish or replace the source operation.

```text
I17 ACTIVE
→ E4 OPEN
→ I17 is blocked by E4
→ E4 RESOLVED
→ I17 may become eligible to continue
```

Do not create `I18` merely because Design answered a question.

Create/supersede the source operation only if Goal/Scope materially changes under existing authority policy.

---

## 4. No second durable control state machine

V0's separate durable:

```text
ExecutionControl = RUN | WAIT_DESIGN | WAIT_EVIDENCE | WAIT_HUMAN
```

is removed.

Operation blocking is derived from authoritative records.

A source operation may continue only when all relevant gates pass, conceptually:

```text
existing LogicalControl == CONTINUE
AND no OPEN blocking Escalation references source_operation_ref
AND existing provider/runtime/SubmissionOperation eligibility gates pass
```

UI/debug surfaces may project:

```text
WAIT(escalation_id, kind)
```

but that is a derived view, not another source of truth.

If several blocking Escalations are OPEN, the source remains blocked until every required blocker is resolved/otherwise authoritatively disposed.

This avoids crash/restart split-brain between `Escalation.status` and a separate WAIT/RUN flag.

---

## 5. Escalation kind policy

### 5.1 NEEDS_DESIGN

Open only when safe continuation requires semantic/authority judgment outside delegated implementation freedom, including:

1. current authoritative contracts appear incompatible in the implementation context;
2. a material product/semantic choice is underspecified;
3. satisfying acceptance requires changing/clarifying authority, provenance, identity, lifecycle, or scope semantics;
4. runtime/provider evidence falsifies a design assumption;
5. implementation would have to invent a new durable semantic object/authority rule;
6. a material architecture/product tradeoff exceeds delegated scope;
7. authority refs are stale/insufficient and no deterministic current interpretation exists.

Compiler errors, refactors, ordinary API discovery, ordinary implementation bugs, selector changes, routine testing/debugging stay local.

### 5.2 NEEDS_EVIDENCE

Use when the blocker is primarily factual and can in principle be answered without a semantic decision.

Examples:

```text
provider identity timing
native fork preservation facts
reload/DOM/provider lifecycle facts
```

If evidence later invalidates a design assumption, create a superseding `NEEDS_DESIGN` Escalation.

### 5.3 NEEDS_HUMAN

Use when continuation requires Human-reserved input or authority.

`Escalation` routes the request; it does not replace existing Human authorization machinery.

When the Human decision authorizes a Proposal, state transition, external write, promotion, irreversible action, or other action already governed by AuthorizationResult/PendingHumanGate:

```text
NEEDS_HUMAN Escalation
→ references gate_id / proposal_id
→ Human decision occurs through PendingHumanGate
→ Policy re-authorizes original immutable Proposal
```

When the request is non-authorization Human input/evidence, an immutable Human result/evidence record may suffice under policy.

Credentials/secrets must not be embedded into GitHub handoff artifacts.

---

## 6. HandoffPacket — immutable compiled projection

### 6.1 Conceptual schema

```text
HandoffPacket
- packet_id
- packet_fingerprint
- packet_revision
- supersedes_packet_id?
- escalation_id
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

### 6.2 Projection, not authority

A packet is not:

- the Work Item;
- the Escalation;
- a new semantic authority source;
- a transcript dump;
- a replacement for exact authority artifacts.

Copied excerpts are conveniences only. Exact immutable refs determine provenance/authority.

### 6.3 Immutability and revisions

Persist packet identity/fingerprint before transport.

Once posted/dispatched, the packet is immutable.

If context or current authority changes, compile a new packet:

```text
P2.supersedes_packet_id = P1
P2.packet_revision = P1.packet_revision + 1
```

Never rewrite what the destination supposedly received.

---

## 7. Context compilation and current-authority repair

A `NEEDS_DESIGN` packet should answer at least:

```text
Which active operation is blocked?
Which exact implementation revision/artifact is involved?
What bounded contradiction/question exists?
Which authority refs did the source actually consult?
What evidence/reproduction supports the issue?
Which interpretations were considered?
Which exact decisions are requested?
What remains out of scope?
```

Source provenance preserves the refs the worker actually used.

Before adjudication, the destination-side Context Compiler may additionally resolve the current canonical authority chain.

Currentness is not determined by timestamp or "newer-looking" commit alone. The compiler/policy must use the canonical authority pointer, explicit supersession relation, promoted/current branch, or equivalent authoritative currentness rule for that artifact class.

A superseding/current ref is appended as a new ref; the source packet is not rewritten.

---

## 8. Result realization and HandoffResult

### 8.1 Result shape

A destination returns a structured immutable result shape:

```text
HandoffResult
- result_id
- result_fingerprint
- source_packet_id
- source_escalation_id
- source_role
- authority_role
- result_kind
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

Do not use result statuses such as `NEEDS_DESIGN / NEEDS_EVIDENCE / NEEDS_HUMAN`; those are Escalation kinds. If another authority question is needed, create/reference a new or superseding Escalation.

### 8.2 Sufficiency is not destination-authored

A destination must not self-assert:

```text
status = SUFFICIENT
```

as authority to resume.

Whether a result is sufficient is decided by source-side `ResolutionPolicy`.

### 8.3 WorkerResult unification

When the destination is a Harness-managed child/logical thread that already produces `WorkerResult`:

- `WorkerResult` is the canonical durable result identity;
- the cross-agent resolution payload is carried by or referenced from that WorkerResult;
- the same `result_id` is reused;
- normal `ResultDeliveryKey` / `DELIVER_CHILD_RESULT` semantics apply where a parent-thread return is required;
- NOOS MUST NOT mint a parallel independent HandoffResult identity/ledger for the same output.

When the destination is an external/non-worker surface without a WorkerResult, NOOS may persist an immutable HandoffResult observation as the canonical result record.

Thus HandoffResult is a transport-neutral result shape/projection, not necessarily a new first-class ledger in every path.

---

## 9. Delivery does not equal resolution

This invariant remains strict:

```text
result transported / WorkerResult delivered
!=
Escalation RESOLVED
```

Transport only proves the answer arrived.

Resolution requires deterministic policy authorization.

---

## 10. ResolutionPolicy

### 10.1 Principle

```text
Agent/result proposes a basis
→ ResolutionPolicy validates
→ durable ResolutionRecord + Escalation transition commit
→ NOOS derives that the blocker is gone
```

`LLM proposes; Policy authorizes; NOOS records.`

### 10.2 Mandatory validation dimensions

Before automatic `OPEN → RESOLVED`, policy must deterministically validate at least:

1. **Identity binding** — result ID/fingerprint exists and explicitly targets the exact `escalation_id`;
2. **Durable existence** — required authority/evidence refs resolve to immutable durable records;
3. **Authority-role eligibility** — the ref/result comes from an authority type allowed for this escalation kind;
4. **Currentness** — required design/state authority is current under that artifact class's canonical pointer/supersession/promotion rule, not merely newer by time;
5. **Target/scope compatibility** — the authority/evidence actually applies to the blocked operation/question/scope;
6. **Question sufficiency** — all mandatory decision/evidence dimensions requested by the Escalation are answered;
7. **No unresolved required Human gate** — when Human authorization applies, the referenced PendingHumanGate/AuthorizationResult path is complete;
8. **No known conflicting sufficient candidate requiring higher authority**.

A well-formed `resume_authority_ref` string alone never passes these checks.

### 10.3 Kind-specific sufficiency

Examples:

#### NEEDS_DESIGN

Sufficient basis may be:

- an existing current authoritative contract that deterministically resolves the ambiguity;
- an authorized Working/Design Decision whose policy explicitly permits implementation against it;
- a newly promoted contract revision;
- an explicit Human/product decision where policy reserves that decision to Human.

An advisory chat answer without such basis is insufficient.

#### NEEDS_EVIDENCE

Sufficiency requires immutable evidence records that answer the requested factual dimensions with the required freshness/provenance.

Evidence that changes the semantic problem may cause the original evidence escalation to be withdrawn/superseded by a new NEEDS_DESIGN escalation rather than resolving implementation automatically.

#### NEEDS_HUMAN

Where PendingHumanGate semantics apply, Human approval is sufficient only after the existing Proposal/AuthorizationResult/Gate path reaches the required authorized state.

---

## 11. EscalationResolutionRecord

A successful resolution creates an immutable durable record:

```text
EscalationResolutionRecord
- resolution_id
- escalation_id
- result_id
- result_fingerprint
- resolution_outcome
- authority_basis_refs[]
- evidence_basis_refs[]
- validation_evidence_refs[]
- policy_id / policy_version
- decided_by
- created_at
```

This record is not a substitute design authority. It records **why policy allowed this escalation blocker to clear**.

The local authoritative commit must be crash-consistent:

```text
expected Escalation OPEN revision
→ validate ResolutionPolicy
→ persist ResolutionRecord
→ set Escalation RESOLVED + resolution_record_id
```

as one reducer-equivalent transaction / durable atomic boundary.

Because operation wait is derived from OPEN Escalations, no second WAIT→RUN write is required.

---

## 12. Competing results

Multiple immutable result candidates may target one OPEN Escalation.

Rules:

1. result observation does not mutate the Escalation;
2. resolution commit uses expected OPEN state/revision (CAS or equivalent);
3. if one sufficient, non-conflicting candidate passes policy, one atomic resolution commit wins;
4. if conflicting sufficient candidates are already known before commit, fail closed to the required higher authority/Human rather than select by arrival order;
5. after RESOLVED, later results cannot rewrite the ResolutionRecord;
6. a materially conflicting later result opens a new evidence/design escalation or review; it does not mutate historical resolution.

V1 deliberately does not semantically merge competing adjudications.

---

## 13. GitHub durability semantics

GitHub is a durable mailbox/artifact bus for the prototype, not semantic authority.

### 13.1 Persist before post

Before posting a structured escalation comment:

```text
persist Escalation
→ persist/compile HandoffPacket
→ attempt GitHub transport
```

Lost acknowledgement must rediscover/reuse the same `escalation_id` / packet identity, not mint a new logical escalation.

### 13.2 Editable comments are observations, not immutable authority

A GitHub comment can be edited.

Therefore when NOOS consumes a GitHub result/adjudication it records an immutable observation:

```text
source/comment ref
observed revision/time
content fingerprint
parsed result id
```

through SourceRef/result provenance or equivalent durable capture.

If the live comment later changes, that produces a new observation; it cannot retroactively alter a committed ResolutionRecord.

### 13.3 Result dedup

Create-or-get processing uses stable `result_id + result_fingerprint` semantics.

Same result identity + same fingerprint is replay.

Same result identity + different fingerprint is invariant/conflict failure.

---

## 14. Routing remains role/logical-thread based

Durable destination examples:

```text
destination_role = PRIMARY_DESIGN
```

or an explicit destination Logical Thread.

Concrete transport resolves late:

```text
PRIMARY_DESIGN
→ current Primary Design Logical Thread
→ current Provider Conversation
→ current eligible Carrier
```

For a coding agent:

```text
source implementation operation
→ current coding-agent session/runtime projection
→ GitHub-backed durable work item as fallback/discovery anchor
```

Never store a stale ChatGPT tab, terminal PID, or old provider conversation as the semantic route identity.

---

## 15. WITHDRAWN and indefinite waits

V1 allows an OPEN Escalation to remain visibly OPEN indefinitely under Human oversight. No automatic timeout is required.

`WITHDRAWN` may be committed only by:

- the owner/authority of the source operation; or
- an authorized supersession transition.

Withdrawal does not itself prove the source operation is safe to run.

After withdrawal, continuation requires an explicit valid path such as:

- a superseding OPEN Escalation that later resolves;
- an authorized scope/operation change that makes the blocker obsolete;
- cancellation/supersession of the source operation;
- other explicit re-authorization under policy.

Automatic timeout → NEEDS_HUMAN conversion is deferred.

---

## 16. Scope changes during adjudication

A result cannot silently mutate the source operation's Goal/Scope.

If resolution requires a material Goal/Scope change:

```text
result identifies required scope change
→ existing Proposal/Authorization policy records that change
→ policy decides whether source operation remains valid
   or is superseded by a new bounded operation
```

Only then may the appropriate blocker resolve/resume path proceed.

---

## 17. Example — stale authority repair

```text
I17 implementing contract behavior
↓
worker used old authority ref
↓
E4 NEEDS_DESIGN OPEN
↓
packet preserves old ref provenance
↓
Primary Design compiler resolves canonical current ref
↓
result cites current authoritative contract
↓
ResolutionPolicy verifies:
  ref exists
  ref is current in canonical chain
  ref applies to E4 question/scope
  all requested decision dimensions answered
↓
ResolutionRecord RR4 + E4 RESOLVED atomically
↓
I17 has no remaining OPEN blocker
↓
I17 may continue subject to ordinary LogicalControl/runtime gates
```

---

## 18. Example — evidence causes a new design escalation

```text
I25 blocked on provider fact
↓
E11 NEEDS_EVIDENCE
↓
immutable evidence result arrives
↓
evidence falsifies design assumption
↓
create E12 NEEDS_DESIGN
  supersedes E11
↓
withdraw E11 as SUPERSEDED
↓
I25 remains blocked because E12 is OPEN
```

No in-place kind conversion occurs.

---

## 19. Example — NEEDS_HUMAN requiring a gate

```text
implementation requires reserved external write
↓
E20 NEEDS_HUMAN
↓
underlying immutable Proposal P7
↓
AuthorizationResult = requires_human
↓
PendingHumanGate G3
↓
E20 references G3
↓
Human approves G3
↓
Policy re-evaluates P7 and authorizes
↓
ResolutionPolicy validates the authorized result
↓
RR20 + E20 RESOLVED
```

Escalation did not create a second approval system.

---

## 20. Minimal V1 invariants

1. Source bounded work retains its durable operation identity across an escalation round trip.
2. Escalation identity is distinct from transport attempt and result identities.
3. Escalation semantic content is immutable after creation.
4. Escalation lifecycle does not duplicate SubmissionOperation/provider delivery lifecycle.
5. Blocking is derived from OPEN Escalations plus existing LogicalControl; there is no second durable WAIT/RUN authority state.
6. HandoffPacket is immutable, fingerprinted, explicitly revision-linked, and never canonical authority.
7. Exact authority/artifact/evidence refs travel with the handoff.
8. Routing is role/Logical-Thread based; concrete surfaces are late-bound.
9. Implementation-local problems do not recall Design.
10. Semantic/authority boundaries cannot be silently decided by implementation agents.
11. Result delivery does not resolve an Escalation.
12. Automatic resolution requires deterministic ResolutionPolicy validation.
13. A chat answer or ref-shaped string alone never grants resume authority.
14. ResolutionRecord + RESOLVED transition are crash-consistent and immutable.
15. Managed-thread results reuse WorkerResult/ResultDelivery identities instead of creating a parallel result ledger.
16. Human authority gates reuse Proposal/AuthorizationResult/PendingHumanGate where those semantics apply.
17. Persist escalation/packet identity before transport.
18. Mutable GitHub comments cannot retroactively mutate a consumed resolution basis.
19. Duplicate/replayed transport does not create duplicate logical escalations/results.
20. Goal/Scope changes are explicit authority transitions, not hidden in result messages.
21. Withdrawal does not silently resume blocked work.
22. Competing results cannot race to rewrite a historical resolution.

---

## 21. Prototype boundary for #10–#13

### #10 GitHub mailbox prototype

May implement:

- persisted Escalation identity before post;
- immutable packet identity/revision/fingerprint;
- structured GitHub marker discovery;
- create-or-get processing;
- immutable comment/result observation capture;
- result dedup/provenance.

Must not implement automatic resume until this revised ResolutionPolicy contract passes independent review.

Human-mediated resume is the safe prototype boundary before approval.

### #11 ChatGPT path

Reuse Shuttle / CurrentConversationBinding / SubmissionOperation transport. Do not create a second browser delivery protocol.

### #12 coding-agent path

Generate bounded runtime projection from the packet and return structured result/escalation refs. Implementation-local failures remain local.

### #13 E2E

Validate:

```text
Design handoff
→ coding work
→ genuine NEEDS_DESIGN
→ durable routing to current Primary Design
→ immutable adjudication result
→ ResolutionPolicy validation
→ resolution record
→ same coding operation resumes
```

Measure remaining Human actions and distinguish authority actions from transport work.

---

## 22. Working conclusion

The product primitive is not "agents send each other messages".

It is:

```text
bounded operation retains identity
        ↓
delegated authority/evidence boundary reached
        ↓
immutable Escalation persisted
        ↓
immutable bounded projection compiled
        ↓
role-aware late-bound transport
        ↓
immutable result observed
        ↓
policy validates exact current authority/evidence basis
        ↓
ResolutionRecord + RESOLVED commit atomically
        ↓
blocking disappears by derivation
        ↓
same bounded operation may continue under ordinary gates
```

The Human is removed from clipboard/routing work, but remains an explicit authority participant wherever policy requires Human authority.
