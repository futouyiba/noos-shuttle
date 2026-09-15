# NOOS Deliberation Harness — Cross-Agent Design ↔ Implementation Manual Dogfood Baseline v0

> Status: Dogfood Evidence / Design Input
>
> Parent work item: `noos-shuttle#7`
>
> Research item: `noos-shuttle#8`
>
> Purpose: capture the real manual ChatGPT ↔ coding-agent handoff loop before automating it.

## 1. Why this document exists

The current NOOS implementation process already contains a repeated cross-agent workflow:

```text
Primary Design Agent
→ implementation instruction / adjudication
→ Human copy/paste
→ Coding Agent
→ implementation work
→ design ambiguity discovered
→ adjudication packet
→ Human copy/paste
→ Primary Design Agent
→ design adjudication
→ Human copy/paste
→ Coding Agent resumes
```

This is not hypothetical. It occurred repeatedly while implementing the Deliberation Harness itself.

The user is currently acting as an implicit runtime component that performs:

```text
Router
+ Context Compiler
+ Authority Resolver
+ Transport
+ Result Return
```

The product opportunity is not merely to save clipboard actions. It is to remove this transport/context-routing burden while preserving the moments where Human or Design authority is actually required.

---

## 2. Observed Trace A — Result Delivery / Reducer adjudication

### 2.1 Implementation-side discovery

The coding agent encountered two apparent design conflicts while implementing previously reviewed V1 slices:

1. whether `DELIVER_CHILD_RESULT` belonged to the generic `SubmissionOperation` transport lifecycle or to an independent result-delivery ledger;
2. whether the existing implementation `HarnessReducer` should be interpreted as the semantic State Store reducer or as a Provider Execution Journal.

The coding agent produced a bounded adjudication document rather than silently choosing an interpretation.

### 2.2 Human transport

The user manually transferred that adjudication packet into the Primary Design conversation.

The Human had to decide:

- which design conversation was authoritative;
- which attached file represented the current blocker;
- whether additional repository authority needed to be read;
- how much implementation context to paste.

### 2.3 Primary Design adjudication

Primary Design re-read the later V1 authority snapshot and discovered that part of the apparent conflict came from stale authority input.

Key decisions included:

- `DELIVER_CHILD_RESULT` is a specialized `SubmissionOperation`, with `ResultDeliveryKey` and `ResultDeliveryReceipt` as delivery-specific identity/receipt semantics rather than a second transport protocol;
- local authoritative state/control reduction and Provider Execution Journal evidence are separate domains;
- implementation should not reinterpret missing reducer completeness as permission to redefine the reducer as the execution journal.

### 2.4 Return path

The user then manually copied the adjudication back to the coding agent so implementation could continue.

### 2.5 What this trace proves

The returned information was not a generic chat reply. It had all of the following properties:

```text
bound to an active implementation task
bound to exact authority refs
answers a narrow design blocker
changes what the implementation agent is allowed to do
must return to the same implementation operation
must not create a second implementation task
```

This is therefore a mid-execution authority escalation, not ordinary conversational messaging.

---

## 3. Observed Trace B — W11 fence / FORKED adapter gap

### 3.1 Implementation-side discovery

The coding agent later produced two new design proposals:

- W11 settle-hop / fence ownership;
- provider inability to perform a conforming `FORKED` child spawn under current activation requirements.

Again, the coding agent did not need the Primary Design Agent to debug syntax or implement code. It needed decisions about semantics/authority boundaries.

### 3.2 Primary Design adjudication

The first-pass adjudication was then attacked and refined.

The refined conclusions separated concepts that the first proposal risked mixing:

```text
operation_id
= logical submission identity

dispatch_fence_id
= one authorized provider execution attempt

operation_revision
= local authoritative state revision used for stale/CAS protection
```

and separately:

```text
FORKED / FRESH
= creation provenance

Context source / fidelity
= what context the new worker actually receives
```

This trace demonstrates another important property:

> the design return may itself require deliberation before it becomes safe implementation authority.

Therefore a future transport must not equate “Primary Design produced a message” with “a frozen authoritative contract automatically changed.”

---

## 4. Generic observed workflow

The two traces reduce to one stable pattern:

```text
Implementation Operation ACTIVE
        ↓
implementation-local work
        ↓
agent discovers boundary it cannot safely decide
        ↓
classify blocker
        ├─ implementation-local → solve locally
        ├─ evidence unknown → NEEDS_EVIDENCE
        ├─ semantic/authority conflict → NEEDS_DESIGN
        └─ reserved/irreversible authority → NEEDS_HUMAN
        ↓
for NEEDS_DESIGN:
create bounded Escalation
        ↓
compile destination-specific Handoff Packet
        ↓
route to current Primary Design Logical Thread
        ↓
Primary Design reads exact authority/evidence
        ↓
adjudication
        ↓
return adjudication to same implementation operation
        ↓
resolve Escalation
        ↓
Implementation Operation resumes
```

The implementation task remains the same task across the round trip.

---

## 5. Human work observed today

The Human currently performs at least seven distinct jobs.

### 5.1 Destination resolution

The user decides which ChatGPT conversation is the current Primary Design thread.

### 5.2 Context selection

The user decides which coding-agent output, document, issue, commit, and prior decision need to travel.

### 5.3 Authority repair

When a coding agent uses a stale design snapshot, the Human/Primary Design side must discover the newer authority chain.

### 5.4 Transport

The user copies long Markdown packets between tools.

### 5.5 Identity preservation

The user implicitly remembers that the returned adjudication belongs to a particular still-active coding task rather than a new task.

### 5.6 Resume instruction

The user tells the coding agent that the design decision has returned and that it may continue.

### 5.7 Audit reconstruction

Later, the user or agent must reconstruct which adjudication applied to which implementation revision.

These are product responsibilities that NOOS can largely automate.

---

## 6. Information that actually needs to cross the boundary

The observed cases do **not** require copying the entire source conversation.

The useful bounded packet is closer to:

```text
Handoff / Escalation identity
source Work Item / implementation operation
source role and destination role
reason
Goal
Scope / Non-goals
exact authority refs
current implementation revision / artifact refs
observed conflict or question
evidence / reproduction where relevant
what the source agent has already concluded
precise decisions requested
expected return shape
stop condition
```

The destination may then fetch the referenced durable material directly.

---

## 7. Information that should not silently cross

Avoid implicitly transporting:

- the full originating chain-of-thought;
- stale copies of design contracts when exact refs are available;
- unrelated implementation logs;
- secrets/credentials;
- arbitrary conversation history merely because it exists;
- authority that the source worker does not own.

Transport should be bounded and provenance-bearing.

---

## 8. Observed escalation boundary

### Stay implementation-local

Examples:

- compiler/type errors;
- ordinary API/library discovery;
- refactoring choices already permitted by the contract;
- selector changes;
- implementation bugs with an unambiguous contract;
- test fixture construction;
- local performance/debugging choices that do not change product semantics.

### Return `NEEDS_DESIGN`

Observed or strongly supported triggers:

- two authoritative contracts appear mutually incompatible;
- implementation requires choosing between materially different semantic models;
- required behavior is absent from the current contract and choosing it would create product semantics;
- provider evidence falsifies a design assumption;
- a proposed implementation would change authority/provenance semantics;
- acceptance criteria cannot be met without changing or clarifying design;
- a material product/architecture tradeoff exceeds delegated implementation scope.

### Return `NEEDS_HUMAN`

Examples:

- credentials/permissions;
- irreversible external action;
- explicit Human-reserved product decision;
- approval of risk that contracts deliberately fail closed on.

### `NEEDS_EVIDENCE`

Use when the blocker is primarily an unresolved factual/provider question that can be investigated without semantic adjudication.

---

## 9. Provenance requirements learned from dogfood

The workflow must preserve enough identity to answer:

```text
Which implementation operation asked?
Which exact implementation revision was being worked on?
Which exact design authority was considered?
Which evidence caused the escalation?
Which adjudication answered it?
Did the implementation resume under that adjudication?
```

Minimum useful refs include, when applicable:

- repository + path;
- exact commit / blob;
- Issue / PR;
- PR head revision;
- Work Item / Logical Thread;
- implementation operation identity;
- escalation identity;
- adjudication artifact/ref.

This is the same lesson already learned from exact-target Review provenance: a correct answer attached to the wrong revision is not reliable governance evidence.

---

## 10. GitHub's observed role

GitHub already works well as a first durable coordination bus for implementation work:

```text
Issue
= durable desired work / coordination envelope

repo Markdown / exact commit
= versioned design or evidence artifact

PR
= implementation candidate

Issue / PR comment
= durable event / escalation / adjudication transport candidate
```

But GitHub should not become the semantic authority merely because it carries the message.

Authority remains in the relevant NOOS design contracts / approved decisions and exact refs.

---

## 11. Failure modes observed or exposed

### 11.1 Stale authority input

A coding agent may produce a plausible design conflict using an old snapshot even though a later contract already resolved it.

Required response:

> destination context compilation should resolve current authority before adjudication whenever policy permits.

### 11.2 Manual context omission

The user can forget a relevant contract, implementation revision, or earlier decision.

### 11.3 Manual misrouting

A result can be pasted into the wrong conversation or a stale implementation session.

### 11.4 Semantic over-escalation

Without policy, coding agents may return routine implementation questions to Primary Design and create ping-pong.

### 11.5 Semantic under-escalation

A coding agent may choose a semantic interpretation locally and accidentally redefine the product.

### 11.6 Transport completion confused with semantic acceptance

Delivery of an adjudication does not itself prove:

- the design was promoted into an authoritative contract;
- the coding agent implemented it correctly;
- Review passed.

These remain separate lifecycle events.

---

## 12. Product design implications

The observed workflow suggests four distinct concepts rather than a generic multi-agent chat bus:

1. **Worker / Implementation Operation** — durable identity of the ongoing bounded task.
2. **Escalation** — a durable request for authority/evidence/human intervention while that operation remains active.
3. **Handoff Packet** — destination-specific projection compiled from canonical operation/escalation/authority/context records.
4. **Handoff Result** — structured return from the destination, which may resolve an escalation or complete a task.

This separation avoids making transported text itself authoritative state.

---

## 13. Non-goals

This baseline does not propose:

- a general autonomous agent graph;
- peer Design agents with equal authority;
- automatic semantic integration of competing designs;
- moving all design documents into GitHub Issues;
- exposing private chain-of-thought as transport context;
- replacing provider-native coding/chat surfaces.

---

## 14. Research conclusion

The current manual workflow is best characterized as:

> **authority-aware mid-execution escalation and return between durable work roles across heterogeneous AI surfaces.**

The Human currently provides continuity because NOOS does not yet persist and route the escalation explicitly.

The next design step should therefore focus on:

```text
active worker operation
→ durable Escalation
→ compiled Handoff Packet
→ authority-aware routing
→ structured adjudication/result
→ return to same active worker operation
```

rather than starting from a generic “send messages between agents” abstraction.
