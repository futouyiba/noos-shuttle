# NOOS Deliberation Harness — Cross-Agent Handoff / Escalation Contract v0

> Status: Working Design Candidate / Issue #9
>
> Parent feature: `noos-shuttle#7`
>
> Evidence baseline: `cross-agent-handoff-manual-dogfood-baseline-v0.md`
>
> Design authority dependencies: current V1 Deliberation Harness contracts in `futouyiba/noos_docs`, especially Work Item / Logical Thread, SubmissionOperation, Child Worker lifecycle, CurrentConversationBinding, Result Delivery, and authority/reducer boundaries.

## 0. One-sentence decision

Cross-agent Design ↔ Implementation should **not** be modeled as generic agent messaging.

V0 models it as:

> an active bounded work operation that may open a durable authority-aware `Escalation`; NOOS compiles that escalation into a destination-specific `HandoffPacket`, routes it to the appropriate authority role, captures a structured `HandoffResult`, and resumes the **same** source operation only when the returned resolution is sufficient for implementation.

---

## 1. Core problem

The real dogfood loop is:

```text
Primary Design
→ bounded implementation task
→ Coding Agent works autonomously
→ Coding Agent encounters a semantic/authority boundary
→ NEEDS_DESIGN
→ Primary Design adjudicates
→ same Coding Agent task resumes
```

The Human should not have to provide continuity by copying long Markdown bodies between tools.

But removing the Human from transport must **not** remove Human or Design authority from decisions that genuinely require them.

---

## 2. Reuse existing durable identities; add only the missing concept

Existing V1 concepts already cover most of the problem:

- Work Item: durable desired work;
- Logical Thread: durable role/work continuity;
- Provider Conversation / Browser Carrier: replaceable execution surfaces;
- SubmissionOperation: durable browser/provider actuation intent;
- WorkerResult / ResultDelivery: durable terminal/bounded worker output return;
- exact artifact / revision refs: provenance.

What these do **not** directly express is:

> a worker remains active but cannot safely continue one frontier until a higher/different authority answers a bounded question, after which the same worker resumes.

V0 therefore introduces one minimal operational concept:

```text
Escalation
```

`HandoffPacket` and `HandoffResult` are transport/context artifacts around that durable escalation. They do not become a second authoritative state machine.

---

## 3. Escalation

### 3.1 Purpose

An `Escalation` records that a source operation has reached a boundary outside its delegated decision authority or evidence capability.

Conceptually:

```text
Escalation
- escalation_id
- work_item_id
- source_operation_ref
- source_logical_thread_id?       # when the source is represented as a Harness thread
- source_role
- destination_role
- kind
- blocker_summary
- question_ref / question_payload
- authority_refs[]
- evidence_refs[]
- implementation_revision_refs[]
- status
- resolution_ref?
- created_at
- resolved_at?
```

`destination_role` is a role/authority target, not a concrete tab, conversation, or provider surface.

### 3.2 Kinds

V0 needs only:

```text
NEEDS_DESIGN
NEEDS_EVIDENCE
NEEDS_HUMAN
```

Ordinary implementation failure is **not** an escalation kind.

A worker may report `BLOCKED` as a task status when an external dependency prevents progress, but `BLOCKED` should not automatically summon Primary Design.

### 3.3 Status

Keep the Escalation lifecycle deliberately small:

```text
OPEN
RESOLVED
WITHDRAWN
```

Do not mirror transport states such as SENT / DELIVERED / ACKED here.

Transport completion belongs to the relevant adapter / SubmissionOperation / durable mailbox evidence.

This prevents a second parallel delivery state machine.

---

## 4. Source operation remains the identity of the work

Opening an Escalation does not create a new implementation task.

```text
Implementation Operation I17 ACTIVE
→ Escalation E4 OPEN
→ I17 waits on E4
→ E4 RESOLVED
→ I17 resumes
```

Do not model the return as:

```text
I17 ends
→ create I18 after design reply
```

unless the implementation goal/scope itself materially changed and policy explicitly creates a new operation.

This invariant is important for:

- restart recovery;
- exact PR/commit provenance;
- avoiding duplicate implementation work;
- returning an adjudication to the correct coding-agent session/task.

---

## 5. Wait/control is orthogonal to lifecycle

The source worker can remain lifecycle-`ACTIVE` while its affected frontier is blocked by an Escalation.

Conceptually:

```text
ExecutionControl
- RUN
- WAIT_DESIGN(escalation_id)
- WAIT_EVIDENCE(escalation_id)
- WAIT_HUMAN(escalation_id)
```

This is a control overlay, not a replacement worker lifecycle.

V0 may conservatively pause the whole bounded implementation operation when an escalation is OPEN. A later version may allow unrelated safe work to continue, but that is not required for the first cross-agent loop.

---

## 6. When implementation must stay local

The implementation agent should continue autonomously for problems inside delegated implementation freedom.

Examples:

```text
compiler/type error
ordinary API/library discovery
refactoring choice allowed by the contract
selector/UI implementation detail
ordinary implementation bug
unit/integration test construction
performance/debugging choice that does not change semantic contracts
```

The rule is not “ask Design whenever uncertain.”

The worker should escalate only when continuing would require it to manufacture authority, semantics, or evidence that it does not own.

---

## 7. NEEDS_DESIGN policy

Open `NEEDS_DESIGN` when at least one is true:

1. two current authoritative contracts appear mutually incompatible in the implementation context;
2. the contract leaves a material semantic choice unspecified and different choices produce different product behavior;
3. satisfying acceptance criteria requires changing or clarifying an authority/provenance boundary;
4. real provider/runtime evidence falsifies a design assumption;
5. the implementation would need to invent a new durable identity/lifecycle/authority semantic rather than an implementation detail;
6. a material architecture/product tradeoff exceeds the worker's delegated scope;
7. the coding agent finds that the authority refs it was given are stale or insufficient and the correct interpretation cannot be derived deterministically.

Do **not** use `NEEDS_DESIGN` merely because code is hard.

---

## 8. NEEDS_EVIDENCE policy

Use `NEEDS_EVIDENCE` when the central blocker is factual and can in principle be resolved without a semantic decision.

Examples:

```text
Does current ChatGPT Web expose a stable ID before first semantic execution?
Does provider-native fork preserve attachments?
Does a particular DOM lifecycle actually occur after reload?
```

The result may later cause `NEEDS_DESIGN` if the evidence invalidates a contract assumption.

---

## 9. NEEDS_HUMAN policy

Use `NEEDS_HUMAN` when the required action/decision is deliberately Human-reserved, for example:

- credentials or account authorization;
- irreversible external write/side effect requiring approval;
- explicit product choice reserved to the user/owner;
- accepting a fail-closed risk such as Human-assisted provider adoption;
- authority policy explicitly requires Human promotion/approval.

NOOS should remove Human transport work, not bypass Human authority gates.

---

## 10. HandoffPacket is a compiled projection, not canonical truth

### 10.1 Purpose

A `HandoffPacket` is the bounded representation sent to a destination surface.

It is generated from durable canonical records and refs.

Conceptually:

```text
HandoffPacket
- packet_id
- packet_fingerprint
- source_work_item_id
- source_operation_ref
- escalation_id?
- source_role
- destination_role
- reason
- Goal
- Scope
- Non-goals
- exact authority refs[]
- implementation/artifact refs[]
- evidence refs[]
- bounded context refs[]
- precise questions[]
- expected return contract
- stop condition
- compiled_at
```

### 10.2 What it is not

A packet is not:

- the Work Item itself;
- the Escalation itself;
- a new semantic authority source;
- a transcript dump;
- a replacement for exact design artifacts.

If a packet copies a contract excerpt for convenience, the exact artifact/ref still determines authority.

### 10.3 Immutability after dispatch

Once a packet is dispatched/posted as a durable handoff instance, its content identity should be immutable and fingerprinted.

If context/authority changes materially, compile a new packet revision rather than silently rewriting what the destination supposedly received.

---

## 11. Context compilation

The Handoff compiler should prefer durable references over copied narrative.

Minimum useful context for `NEEDS_DESIGN`:

```text
What active implementation operation is blocked?
What exact revision/artifact is being implemented?
What is the observed contradiction/question?
Which authority refs were consulted?
Which evidence/reproduction supports the problem?
What interpretations has the implementation agent considered?
What exact decisions are requested?
What remains explicitly out of scope?
```

The destination may fetch the authoritative material directly.

### 11.1 Current-authority repair

Dogfood exposed that an implementation agent can construct a plausible conflict from an obsolete design snapshot.

Therefore, when policy permits, the Primary Design-side Context Compiler should resolve/check the current authority chain before adjudication rather than blindly trusting the source packet's authority list as exhaustive.

The source packet preserves what the worker actually used; destination compilation may additionally attach superseding/current authority refs.

This distinction preserves both provenance and correctness.

---

## 12. HandoffResult

A destination returns a structured result rather than an untyped chat blob.

Conceptually:

```text
HandoffResult
- result_id
- source_packet_id
- source_escalation_id?
- source_role
- destination/source-authority role
- result_kind
- status
- summary
- artifact_refs[]
- authority_refs[]
- evidence_refs[]
- decisions / findings
- unresolved_questions[]
- recommended_next_action
- resume_authority_ref?
- created_at
```

Candidate result kinds:

```text
ADJUDICATION
EVIDENCE_RESULT
HUMAN_DECISION
TASK_RESULT
```

Candidate statuses:

```text
COMPLETED
NEEDS_DESIGN
NEEDS_EVIDENCE
NEEDS_HUMAN
BLOCKED
FAILED_SAFE
```

A HandoffResult may itself contain a further escalation rather than completing the original operation.

---

## 13. Delivery does not equal resolution

This is a critical invariant.

```text
HandoffResult transported to source worker
!=
Escalation resolved
```

An Escalation may become `RESOLVED` only when the returned result contains sufficient authority/evidence for the source operation to proceed safely.

Examples:

### Existing-contract clarification

Primary Design demonstrates that a later existing contract already answers the question and supplies the exact ref.

```text
result delivered
→ resolution sufficient
→ Escalation RESOLVED
→ implementation may resume
```

### Contract change required but not yet authorized

Primary Design says the implementation exposed a genuine contract gap and proposes a new design, but governance/promotion has not yet produced the required authoritative ref.

```text
result delivered
→ informative but not resume-authoritative
→ Escalation remains OPEN / WAIT_DESIGN
```

After the design delta is authorized/persisted:

```text
new authority ref
→ resolve Escalation
→ resume implementation
```

This prevents “the Designer said something in chat” from automatically becoming frozen implementation authority.

---

## 14. Resume authority

To resume automatically, the returned resolution should include or resolve to a `resume_authority_ref` sufficient under policy.

Conceptually it can point to:

- an already-existing authoritative contract/ref that resolves the misunderstanding;
- an authorized Design Decision / Working Decision where delegated policy permits implementation against it;
- a newly promoted contract revision;
- explicit Human decision where required.

V0 should fail closed when the destination response is advisory but does not establish an implementation-safe authority basis.

---

## 15. Routing is role/logical-thread based, not surface based

The durable destination is conceptually:

```text
destination_role = PRIMARY_DESIGN
```

or a destination Logical Thread when one exists.

Concrete transport resolves late:

```text
PRIMARY_DESIGN
→ current Primary Design Logical Thread
→ current Provider Conversation
→ current eligible Browser Carrier
```

for ChatGPT delivery.

For a coding agent, resolution may instead be:

```text
IMPLEMENTATION role / operation
→ current coding-agent session or runtime projection
→ GitHub-backed durable work item
```

Do not store a stale ChatGPT tab or terminal session as the semantic destination.

---

## 16. Transport adapters

Cross-agent handoff is provider-neutral at the semantic layer but transport-specific at the edge.

Potential V0 adapters:

### ChatGPT Web

Use existing Shuttle/browser observation, current conversation binding, SubmissionOperation, and dispatch safety primitives when automated injection is enabled.

### Coding agent

Prefer a runtime projection / task brief / repository refs appropriate for Claude Code or Codex rather than pretending a coding agent consumes the same prompt surface as ChatGPT.

### GitHub durable mailbox

GitHub may initially carry:

```text
Issue body
Issue/PR comments
repo Markdown artifacts
PR/commit refs
```

GitHub transport evidence is not itself design authority.

---

## 17. GitHub prototype mapping

The first prototype should test a deliberately simple mapping.

### Initial implementation work

```text
GitHub Issue
= durable implementation Work Item / coordination envelope
```

The coding agent can start from a short reference such as:

```text
execute noos-shuttle#N
```

and fetch the linked exact authority/context refs.

### Mid-execution NEEDS_DESIGN

Candidate representation:

```text
structured Issue/PR comment
+ optional repo adjudication/evidence artifact
```

The comment carries a stable machine-readable escalation identity and refs.

Do not create a new GitHub Issue for every tiny escalation by default.

Create a separate Issue only when the design problem becomes independently schedulable/substantial enough to deserve its own Work Item.

### Adjudication return

Primary Design result can be recorded as:

```text
structured adjudication comment
+ exact authority artifact/ref when needed
```

The coding agent resumes from the same original implementation Issue/operation.

This mapping is a prototype transport strategy, not a permanent semantic dependency on GitHub.

---

## 18. Suggested machine-readable GitHub markers

For #10 prototype, comments may use a small marker envelope such as:

```text
<!-- NOOS:ESCALATION v0 -->
escalation_id: E-...
kind: NEEDS_DESIGN
source_operation_ref: ...
packet_ref: ...
```

and return:

```text
<!-- NOOS:HANDOFF_RESULT v0 -->
result_id: R-...
escalation_id: E-...
result_kind: ADJUDICATION
resume_authority_ref: ...
```

The human-readable body follows below.

Do not embed secret state or rely on hidden HTML comments as the only durable record. They are a discovery/transport marker around normal durable GitHub content.

---

## 19. Idempotency / duplicate handling

A round-trip must not produce duplicate logical escalations merely because transport acknowledgement is lost.

V0 logical identity:

```text
escalation_id
```

The same escalation may be transported multiple times only under explicit recovery rules, but destination processing should create-or-get by the same escalation identity.

Likewise, an adjudication/result should have stable `result_id` / fingerprint so a repeated GitHub poll or Shuttle reconnect does not create a second semantic resolution.

Provider/browser dispatch idempotency continues to use the existing SubmissionOperation safety contract where applicable.

---

## 20. Scope change during adjudication

If Primary Design resolves the question by materially changing the implementation Goal/Scope, that is not merely an Escalation resolution.

The system should explicitly record the scope/goal change under the existing authority model and determine whether:

```text
same source operation can continue
```

or:

```text
old operation closes/supersedes
→ new bounded operation created
```

V0 should not silently mutate the source operation's mission through a return message.

---

## 21. Example A — stale authority conflict

```text
I17 implementing Child Result Delivery
↓
worker reads older contract snapshot
↓
sees apparent A/B conflict
↓
E4 = NEEDS_DESIGN
↓
packet includes old authority refs + implementation state
↓
Primary Design compiler finds later current contract
↓
Adjudication Result R9:
  existing current contract already resolves issue
  exact current authority ref supplied
↓
E4 RESOLVED
↓
I17 resumes
```

No new design contract is required.

---

## 22. Example B — genuine clarification requiring new design

```text
I21 implementing settle/recovery path
↓
worker discovers fence semantic is underspecified
↓
E8 = NEEDS_DESIGN
↓
Primary Design separates:
  operation identity
  execution-attempt fence
  operation revision
↓
if this is only clarification of existing allowed model:
  record sufficient Design Decision ref
  E8 RESOLVED

if authoritative contract must change:
  E8 remains WAIT_DESIGN
  design delta goes through required governance
  promoted ref returned
  E8 RESOLVED
↓
I21 resumes
```

---

## 23. Example C — evidence first

```text
I25 implementing FORKED child activation
↓
unknown: what does provider native fork actually preserve?
↓
E11 = NEEDS_EVIDENCE
↓
provider experiment
↓
Evidence Result
   ├─ existing contract remains implementable → resolve and resume
   └─ evidence falsifies assumption → open/convert to NEEDS_DESIGN
```

Do not force Primary Design to answer provider facts from speculation.

---

## 24. Minimal V0 invariants

1. An active implementation task retains the same durable operation identity across an escalation round trip.
2. Escalation identity is distinct from transport attempt identity.
3. Escalation lifecycle does not duplicate SubmissionOperation/provider-delivery lifecycle.
4. `HandoffPacket` is a bounded immutable projection, not canonical authority.
5. Exact authority/artifact/revision refs travel with the handoff.
6. Destination routing is role/Logical-Thread based and concrete surfaces are late-bound.
7. Implementation-local problems do not recall Primary Design.
8. Semantic/authority boundaries cannot be silently decided by the implementation agent.
9. Delivery of an answer does not automatically resolve the Escalation.
10. Automatic resume requires an authority/evidence basis sufficient under policy.
11. Human transport work should disappear; Human authority gates remain explicit.
12. GitHub may be a durable mailbox but is not automatically semantic authority.
13. Repeated transport/reconnect must not create duplicate logical escalations/results.
14. Goal/Scope mutation is explicit and cannot hide inside an adjudication message.

---

## 25. What this design deliberately does not solve

V0 does not yet define:

- a general multi-agent scheduler;
- arbitrary peer-to-peer agent messaging;
- automatic Integration arbitration;
- full GitHub Project synchronization;
- final JSON/database schemas;
- cross-machine coding-agent session takeover;
- autonomous Human approval;
- semantic merging of multiple competing adjudications.

---

## 26. Implementation slicing recommendation

Proceed in this order:

```text
#8 manual baseline
→ #9 contract candidate
→ #10 GitHub durable mailbox prototype
→ #12 coding-agent runtime projection/result capture
→ #11 ChatGPT injection/adjudication return
→ #13 full E2E dogfood
```

`#10` should intentionally keep NOOS semantics thin and test whether GitHub can carry the durable refs/events before building a bespoke message backend.

`#11` should reuse existing Shuttle / CurrentConversationBinding / SubmissionOperation semantics instead of inventing a second browser transport path.

---

## 27. Working conclusion

The design center is not “send context from ChatGPT to Claude Code.”

It is:

```text
bounded work retains identity
        ↓
worker reaches delegated-authority boundary
        ↓
durable Escalation
        ↓
NOOS compiles only the context needed by the authority target
        ↓
role-aware late-bound delivery
        ↓
structured Result
        ↓
resolution authority checked
        ↓
same bounded work resumes
```

This turns the Human from a clipboard/router into what the Human should actually be: an explicit authority participant only when policy requires one.
