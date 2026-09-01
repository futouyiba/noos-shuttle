# V1 End-to-End Walkthrough

> Status: Working Design Note v1 / V1 validation only / does not modify or reinterpret frozen Review Candidate v4.

## 1. Baseline assumptions and evidence boundary

This revision corrects v0's input error. The design inputs are the latest `futouyiba/noos_docs` files at commit [`9b55137a2bf4886d9f712df68fd51dec2144e91c`](https://github.com/futouyiba/noos_docs/tree/9b55137a2bf4886d9f712df68fd51dec2144e91c):

- [Self-Bootstrap Runtime Working Model v0](https://github.com/futouyiba/noos_docs/blob/9b55137a2bf4886d9f712df68fd51dec2144e91c/docs/deliberation-harness/self-bootstrap-runtime-working-model-v0.md)
- [Browser Runtime Observation Contract v0](https://github.com/futouyiba/noos_docs/blob/9b55137a2bf4886d9f712df68fd51dec2144e91c/docs/deliberation-harness/browser-runtime-observation-contract-v0.md)
- [Command Submission / Idempotency Contract v0](https://github.com/futouyiba/noos_docs/blob/9b55137a2bf4886d9f712df68fd51dec2144e91c/docs/deliberation-harness/command-submission-idempotency-contract-v0.md)
- [Logical Thread / Provider Conversation / Browser Carrier Binding Contract v0](https://github.com/futouyiba/noos_docs/blob/9b55137a2bf4886d9f712df68fd51dec2144e91c/docs/deliberation-harness/logical-thread-conversation-carrier-binding-contract-v0.md)
- [Primary Design + Child Worker Lifecycle v0](https://github.com/futouyiba/noos_docs/blob/9b55137a2bf4886d9f712df68fd51dec2144e91c/docs/deliberation-harness/primary-design-child-worker-lifecycle-v0.md)
- Freeze / exact target authority comes from frozen [Review Candidate v4](https://github.com/futouyiba/noos_docs/blob/9b55137a2bf4886d9f712df68fd51dec2144e91c/docs/deliberation-harness/review-candidate-v4.md).

The cross-contract authority baseline is [Runtime Object Model & Authority Model v0.1](https://github.com/futouyiba/noos_docs/blob/9b55137a2bf4886d9f712df68fd51dec2144e91c/docs/harness/runtime-object-authority-model.md) plus [State Delta + Reducer Contract v0.1](https://github.com/futouyiba/noos_docs/blob/9b55137a2bf4886d9f712df68fd51dec2144e91c/docs/harness/state-delta-reducer-contract.md).

Implementation evidence comes only from `futouyiba/noos-shuttle`. Its current page-context watcher can detect route/conversation changes, cancel active waits on `pagehide`, and reset local capture UI. No Harness Logical Thread, operation ledger, binding epoch, child lifecycle, Freeze, or review-routing implementation was found.

Verdicts:

- `SUPPORTED`: the design contract is sufficient and current runtime evidence covers the transition.
- `GAP`: the design contract itself cannot reliably define the transition.
- `NOT_IMPLEMENTED`: the design contract is sufficient, but `noos-shuttle` does not yet implement it.

V1 topology is one Primary Design Logical Thread (PDLT) per Work Item. Reviewer, Sedimentation, and Evidence workers are bounded child Logical Threads, not peer Designers.

## 2. Full happy-path trace

### Step 1 — Create Work Item and Primary Logical Thread intent

- **Actor / Logical Thread:** Human creates/activates the Work Item; PDLT durable intent is created before browser actuation.
- **State:** Work Item carries stable identity, Primary Goal, Scope/Non-goals and Current/Companion refs. No Provider Conversation or Browser Carrier exists yet.
- **Operation:** create/activate Work Item and create the one Primary Design Logical Thread.
- **Identity / binding / epoch:** `work_item_id` and `logical_thread_id` become durable; active conversation is initially null.
- **Goal / Scope:** declared by the Work Item and Human authority; no child inheritance yet.
- **Human boundary:** creating/activating the Work Item and changing Goal/Scope are explicit authority events.
- **Expected transition:** durable Work Item + PDLT exist and can survive browser/service-worker restart before bootstrap.
- **Verdict:** `NOT_IMPLEMENTED`.
- **Evidence:** frozen v4 §2 binds operations to stable `work_item_id`; Self-Bootstrap §§2, 6 define Work Item/Goal/Scope bootstrap state; Binding §§2, 20 define durable Logical Thread identity. `noos-shuttle` has no matching state objects.

### Step 2 — Bootstrap and bind the Primary Provider Conversation

- **Actor / Logical Thread:** PDLT.
- **State:** logical control is not yet eligible for GO; carrier proceeds `ATTACHING → STABILIZING → READY`.
- **Operation:** durable `BOOTSTRAP` Submission Operation, persisted before actuation.
- **Conversation / Carrier:** a Provider Conversation is created/resolved and attached to a tab; these are distinct identities.
- **Identity / binding / epoch:** initial `PDLT → Conversation` active binding is committed; carrier receives an actuation lease.
- **Goal / Scope:** bootstrap includes role, Work Item, Primary Goal, Scope/Non-goals, durable refs and authority boundaries.
- **Recovery:** idempotency contract prevents blind duplicate bootstrap; binding recovery distinguishes conversation from tab.
- **Expected transition:** carrier `READY`, logical control `CONTINUE`, bootstrap operation `COMPLETED`.
- **Verdict:** `GAP`.
- **Reason:** contracts state that the binding is durable and atomic, but do not define initial bind/rollover/adoption as an authorized compare-and-set mutation through `Proposal → Policy → Authorized Delta → Reducer`. They also leave multiple potential binding truths writable. The runtime therefore lacks a contractually unique commit path.

### Step 3 — Several explicit GO cycles

- **Actor / Logical Thread:** PDLT.
- **State:** each cycle requires `Carrier READY + Logical Control CONTINUE`; submission moves `PREPARED → DISPATCHING → OBSERVED_ACCEPTED → COMPLETED`, while carrier moves `READY → GENERATING → STABILIZING → READY`.
- **Operation:** a new durable GO `operation_id` per Human-triggered Step Mode continuation.
- **Identity / binding / epoch:** unchanged; operation targets the expected conversation and carrier binding.
- **Goal / Scope:** inherited from in-conversation trajectory; no full prompt reinjection every turn.
- **Human boundary:** V1 Step Mode requires Human/explicit Harness GO; missing blocker signal is acceptable only because continuation is not autonomous.
- **Recovery:** `UNCERTAIN != NOT_SENT`; reconcile message counts/fingerprints/head before any retry. One active submission per carrier.
- **Expected transition:** exactly one blind dispatch per operation; ambiguity pauses rather than resends.
- **Verdict:** `NOT_IMPLEMENTED`.
- **Evidence:** Self-Bootstrap §§6, 10, 13–14; Observation §§4–6, 15; Idempotency §§1–12, 17.

### Step 4 — Periodic/event-driven Goal Re-anchor

- **Actor / Logical Thread:** PDLT; Harness triggers a non-semantic lifecycle hook.
- **State:** `design_turns_since_anchor` increments only after completed substantive Design generations. Re-anchor is eligible at configured `N` or on compaction, rollover, Review return, scope correction, or Sedimentation return.
- **Operation:** its own persisted submission operation; it must obey READY/CONTINUE and UNCERTAIN reconciliation.
- **Identity / binding / epoch:** unchanged; post-rollover event runs against the new current binding epoch.
- **Goal / Scope:** short anchor compiled from durable Primary Goal and Scope/Non-goals.
- **Human boundary:** Human scope corrections change durable scope; periodic reminders do not mutate scope.
- **Reset:** reset `design_turns_since_anchor` only after the re-anchor operation is observed completed; `UNCERTAIN` must not create a second anchor.
- **Expected transition:** return to normal `CONTINUE` without visible alignment-report ceremony.
- **Verdict:** `NOT_IMPLEMENTED`.
- **Evidence:** Self-Bootstrap §§7, 8, 12 defines sparse counter/event hooks and experimental N; Idempotency supplies safe submission/reconciliation. Counter reset is the direct operational meaning of “turns since anchor”; exact N remains an implementation experiment, not a contract gap.

### Step 5 — Context/memory risk grows and Sedimentation is planned

- **Actor / Logical Thread:** PDLT/Human declares the maintenance need; no semantic supervisor is introduced.
- **State:** parent may enter `WAIT_WORKER(child_id)`; durable child intent starts `PLANNED`.
- **Operation:** create child intent before browser spawn, including parent, role, `FORKED`, operation goal/scope, return route and artifact refs.
- **Goal / Scope:** inherits Work Item Goal/Scope and receives bounded Sedimentation scope: preserve missing reasoning, do not continue Design.
- **Human boundary:** no automatic semantic risk score is required; V1 may use Human/Agent declaration.
- **Expected transition:** spawn may begin without losing intent on restart.
- **Verdict:** `NOT_IMPLEMENTED`.
- **Evidence:** Self-Bootstrap §4 and Lifecycle §§3–7, 13, 20.

### Step 6 — Fork and bootstrap Sedimentation Worker

- **Actor / Logical Thread:** new Sedimentation child L2, parent PDLT remains L1.
- **State:** child `PLANNED → SPAWNING → BOOTSTRAPPING → ACTIVE`; carrier `ATTACHING → STABILIZING → READY`.
- **Operation:** one durable fork/spawn operation; `SPAWN_UNCERTAIN` reconciles existing child candidates and never blindly forks again.
- **Conversation / Carrier:** L2 receives a distinct forked Provider Conversation/carrier; L1 binding is unchanged. Scratch reasoning stays on L2.
- **Identity / binding / epoch:** fork creates a new Logical Thread; it is not parent rollover. Parent/child lineage and return route are durable.
- **Goal / Scope:** inherited Work Item context plus Sedimentation Operation Goal/Scope.
- **Expected transition:** one stable, re-identifiable child carrier.
- **Verdict:** `GAP`.
- **Reason:** fork idempotency and isolation are defined, but child conversation activation inherits the same binding gaps as Step 2. In addition, contracts allow bootstrap interaction while a conversation is still `PROVISIONAL` without an enforceable side-effect-disabled/quarantined pre-activation capability. A prompt instruction to avoid side effects is insufficient fencing.

### Step 7 — Sedimentation writes durable memory and completes

- **Actor / Logical Thread:** Sedimentation L2 only.
- **State:** child `ACTIVE → RESULT_READY → RETURNING → COMPLETED → RETIRED`; parent remains logically waiting/unchanged.
- **Operation:** agent-driven authorized writes to Current-adjacent durable docs, followed by omission/deduplication pass and completion receipt/result refs.
- **Conversation / Carrier:** only child conversation executes; parent conversation does not inherit scratch turns.
- **Identity / provenance:** result records child, parent, Work Item, relevant revision/ref and completion receipt. RETIRED releases execution lease but preserves thread/conversation/history refs.
- **Goal / Scope:** worker keeps inherited Work Item Goal but may write only within its Sedimentation Operation Scope.
- **Human boundary:** reversible working-document mutation is autonomous by default; higher-authority Promote/Publish remains Human-gated.
- **Expected transition:** future fresh agents depend less on old conversation history.
- **Verdict:** `NOT_IMPLEMENTED`.
- **Evidence:** Self-Bootstrap §§3–5; Lifecycle §§8–10, 15, 20.

### Step 8 — Return to and resume the Primary Design Thread

- **Actor / Logical Thread:** result router resolves parent L1; PDLT resumes.
- **State:** mechanical `WAIT_WORKER(L2)` clears when the expected completion arrives; logical state becomes eligible for explicit GO, without inferring semantic acceptance.
- **Operation:** deliver completion/result refs to `parent_thread_id`, then resolve its current active conversation and current actuation carrier.
- **Conversation / Carrier:** child retires; parent carrier is used even if different from the tab that created L2.
- **Identity / binding / epoch:** child provenance remains; destination is resolved at delivery time.
- **Goal / Scope:** event-driven Goal Re-anchor precedes/joins resumption.
- **Expected transition:** main Design trajectory continues cleanly.
- **Verdict:** `GAP`.
- **Reason:** return-by-Logical-Thread is correctly designed, but reliable resolution still depends on an unambiguous canonical active binding and authorized epoch switch, which the binding contract has not closed.

### Step 9 — Continue Design after Sedimentation

- **Actor / Logical Thread:** original PDLT L1.
- **State:** `READY + CONTINUE`; prior worker is RETIRED and unscheduled.
- **Operation:** explicit GO under the normal idempotency lifecycle.
- **Goal / Scope:** unchanged Work Item Goal/Scope, refreshed by event-driven anchor; durable memory refs are available on recovery/on demand.
- **Expected transition:** same Logical Thread and current Provider Conversation continue Design.
- **Verdict:** `NOT_IMPLEMENTED`.
- **Evidence:** Self-Bootstrap §§3, 6, 12, 15; Lifecycle §§12–15.

### Step 10 — Freeze the exact Review Target

- **Actor / Logical Thread:** PDLT proposes; Human exercises the higher-authority Freeze boundary.
- **State:** parent reaches `WAIT_REVIEW`; Working Candidate remains separate from immutable Review Snapshot.
- **Operation:** Freeze exact Candidate revision/body identity, Work Item, readiness checklist, classified Open Questions, fixed supporting refs, and excluded-material counts.
- **Identity / authority:** `snapshot_id` is immutable and Reviewer instructions are separately version-identifiable provenance. Review never mutates the Candidate directly.
- **Goal / Scope:** Review scope derives from the frozen Snapshot, not the moving Current head.
- **Recovery:** the immutable snapshot makes refresh/restart/re-dispatch reproducible.
- **Expected transition:** exact Review Target exists and can be passed to a fresh Reviewer.
- **Verdict:** `NOT_IMPLEMENTED`.
- **Evidence:** frozen v4 §§6–9; Self-Bootstrap §5 explicitly reserves Freeze/Promote/Publish as higher-authority transitions.

### Step 11 — Spawn a Fresh Independent Reviewer

- **Actor / Logical Thread:** new Reviewer child L3; PDLT waits.
- **State:** L3 `PLANNED → SPAWNING → BOOTSTRAPPING → ACTIVE`, creation mode `FRESH`.
- **Operation:** durable reviewer spawn/bootstrap operations with UNCERTAIN reconciliation.
- **Conversation / Carrier:** a new conversation, not forked Designer history. It receives only Work Item Goal/Scope, exact frozen target, Reviewer contract and selected evidence refs.
- **Identity / binding / epoch:** L3 has its own logical id, parent L1, explicit return route and independent binding.
- **Human boundary:** Human authorized Freeze and Review dispatch; Reviewer may report findings but cannot mutate parent decisions.
- **Expected transition:** sufficient context plus preserved independence.
- **Verdict:** `GAP`.
- **Reason:** Fresh/independence/context envelope are sufficient, but provisional new-conversation bootstrap and binding commit still have the Step 2/6 authority, single-truth, inverse-uniqueness and pre-activation-side-effect gaps.

### Step 12 — Reviewer completes and retires

- **Actor / Logical Thread:** Reviewer L3.
- **State:** `ACTIVE → RESULT_READY → RETURNING → COMPLETED → RETIRED`.
- **Operation:** create immutable Review Report bound to `snapshot_id`; emit `WorkerResult`/completion receipt.
- **Identity / provenance:** report retains Work Item, snapshot, reviewer child, parent, relevant revision and instruction provenance. RETIRED stops execution but preserves history.
- **Goal / Scope:** bounded Review operation; findings only, no implicit redesign or Candidate mutation.
- **Expected transition:** immutable result is ready for parent delivery.
- **Verdict:** `NOT_IMPLEMENTED`.
- **Evidence:** frozen v4 §7; Lifecycle §§9–12, 15, 20.

### Step 13 — Route Review Result during/after parent rollover

- **Actor / Logical Thread:** router resolves child L3 → parent L1.
- **State:** Reviewer result waits durably if no safe current parent carrier is attached. Old C1/browser tab never receives based on fork-time identity alone.
- **Operation:** resolve `L1.active_conversation_binding` at delivery time, then current carrier/lease; stale epoch events cannot mutate the new binding.
- **Conversation / Carrier:** if L1 rolled from C1 to C3, deliver to C3's leased carrier.
- **Identity / binding / epoch:** routing key is parent Logical Thread; current binding epoch fences C1.
- **Goal / Scope:** parent receives an event-triggered re-anchor before resuming/revising.
- **Expected transition:** correct active parent conversation receives the immutable report once.
- **Verdict:** `GAP`.
- **Reason:** Binding §§17–18 explicitly define the right route, but canonical binding mutation, reverse uniqueness, and single source of truth remain underspecified. Without them, “current” cannot be resolved reliably under a race.

### Step 14 — Primary Design resumes/revises

- **Actor / Logical Thread:** PDLT L1; Human retains acceptance/promotion authority.
- **State:** mechanical `WAIT_REVIEW` clears after delivery; parent reads/reasons and chooses revise/clarify/next boundary. Review Report stays immutable.
- **Operation:** event re-anchor, then explicit GO or revision work. Selected findings may become Review Notes; no automatic Candidate mutation.
- **Identity / provenance:** revised Candidate has its own revision lineage and keeps snapshot/report refs.
- **Goal / Scope:** original Work Item Goal/Scope, plus explicit Human corrections only.
- **Expected transition:** Designer responds to Review without Reviewer or Harness taking semantic authority.
- **Verdict:** `NOT_IMPLEMENTED`.
- **Evidence:** frozen v4 §7; Lifecycle §§11–13; Self-Bootstrap §§7, 12, 15.

## 3. Recovery traces

### 3.1 Service-worker restart

- Existing `noos-shuttle` page-context logic reattaches content-script behavior and cancels pagehide waits: `SUPPORTED` for this narrow capture-runtime behavior.
- Harness recovery is design-supported by durable operation identity, persist-before-actuate, durable logical bindings, attachment reconstruction and lease reassignment, but not implemented: `NOT_IMPLEMENTED`.
- Restart must first reconcile any `DISPATCHING/UNCERTAIN` operation; it must not create a new GO/fork/review operation merely because an in-memory callback disappeared.

### 3.2 Duplicate tab

- The design allows multiple observed carriers but one actuation lease per Provider Conversation; only the lease holder may automate: design sufficient.
- `noos-shuttle` does not implement carrier attachments or leases: `NOT_IMPLEMENTED`.
- Atomic lease transfer must use generation/epoch fencing; old senders cannot actuate after transfer.

### 3.3 Uncertain GO submission

- Durable `operation_id`, pre-submit baseline, one blind dispatch, `UNCERTAIN` reconciliation and manual pause on ambiguity fully define V1 Step Mode behavior: design sufficient.
- Operation ledger/probes are absent from `noos-shuttle`: `NOT_IMPLEMENTED`.

### 3.4 Uncertain fork

- Child intent is persisted first; spawn transitions to `SPAWN_UNCERTAIN`; recovery searches existing tabs/conversations and creates another child only after non-creation is proven: design sufficient.
- Spawn reconciliation and child bindings are absent: `NOT_IMPLEMENTED`.

### 3.5 Parent Design rollover while Reviewer is active

- Child result routes by `parent_thread_id` and resolves the parent's current conversation at delivery time; stale epochs must not reactivate C1. The intended behavior is explicit.
- End-to-end reliability remains `GAP` until the canonical binding mutation/single-truth issues in §5 are closed. This is not a missing return-routing idea; it is a dependency on unresolved binding authority and invariants.

### 3.6 Restart while a child result is `RETURNING`

- The child result and completion receipt are durable before delivery; after service-worker restart the router reloads `RETURNING` work and resolves the parent Logical Thread again. This part is `SUPPORTED` by Lifecycle §§9–12 and the general persist-before-actuate rule.
- The current contracts do not state a delivery-specific idempotency key or recipient-side applied marker. A lost delivery acknowledgement can therefore cause the same Review Result to be inserted twice unless the implementation invents a deduplication rule. This is **GAP-5**, not a semantic-acceptance gap.
- After GAP-5, replay of the same `(result_id, destination logical thread, destination binding generation)` returns the original delivery receipt; semantic acceptance remains a separate Designer/Human decision.

## 4. Explicit 20-point seam checklist

| Check | V1 result |
|---|---|
| Actor / Logical Thread | PDLT owns the semantic spine; each child has one explicit parent and role. `SUPPORTED` by Lifecycle §§1–2, 6, 16. |
| Work Item identity | Stable `work_item_id` owns every operation and child. `SUPPORTED` by Self-Bootstrap §2 and frozen v4 §2. |
| Provider Conversation identity | Replaceable provider identity is distinct from Logical Thread and tab. `SUPPORTED` by Binding §§1–4. |
| Browser Carrier | Tab/window/content-script is disposable attachment, not identity. `SUPPORTED` by Binding §§4–5 and Observation §§7–9. |
| Binding epoch | Monotonic epoch fences delayed stale events. `SUPPORTED` as a rule by Binding §12; implementation is `NOT_IMPLEMENTED`. |
| Actuation lease | One automated writer/lease holder per conversation. `SUPPORTED` by Binding §§10–11 and Idempotency §9; implementation is `NOT_IMPLEMENTED`. |
| Carrier Runtime State | Deterministic runtime states and conservative READY conjunction are defined. `SUPPORTED` by Observation §§3–6, 11, 16. |
| Logical Control State | Orthogonal `CONTINUE/WAIT_*/BOUNDARY_REACHED`; no semantic supervisor. `SUPPORTED` by Self-Bootstrap §§7, 10, 13–14. |
| Submission Operation | Persist-before-actuate, lifecycle, baseline, reconciliation and at-most-one blind dispatch are defined. `SUPPORTED` by Idempotency §§1–8, 16–18. |
| Operation persistence | Operation identity exists before browser action and survives restart. `SUPPORTED` by Idempotency §§2–3; runtime `NOT_IMPLEMENTED`. |
| UNCERTAIN reconcile | Re-read conversation evidence; only proven-not-accepted may retry; ambiguity pauses. `SUPPORTED` by Idempotency §§7–8, 15. |
| Goal / Scope inheritance | Parent Goal/Scope inherited; child adds bounded Operation Goal/Scope; FRESH reviewer gets explicit subset. `SUPPORTED` by Lifecycle §§6–7. |
| Human authority | Work Item scope, Freeze and Promote are Human authority; re-anchor and delivery are not approval gates. `SUPPORTED` by Self-Bootstrap §§5, 7 and frozen v4 §§6, 9, 11. |
| Child creation mode | Sedimentation `FORKED`; Independent Reviewer `FRESH`; distinction is durable. `SUPPORTED` by Lifecycle §7. |
| Result identity / route | WorkerResult routes by child/parent Logical Thread and resolves current parent conversation, never raw tab. `SUPPORTED` by Lifecycle §§10–12 and Binding §§16–18. |
| Parent rollover routing | Current parent binding is resolved at delivery time and stale epochs are fenced, but this depends on unresolved binding GAP-1/3/4. `GAP` at that seam. |
| Restart non-duplication | GO/fork operations reconcile before retry; child intent precedes spawn. `SUPPORTED` by Idempotency §§7, 13 and Lifecycle §§4–5, 16; runtime `NOT_IMPLEMENTED`. |
| Duplicate-tab safety | Multiple observed carriers are allowed, but only one actuation lease may send. `SUPPORTED` by Binding §§10–11; runtime `NOT_IMPLEMENTED`. |
| Provenance / retirement | Result, lineage and conversation history survive `RETIRED`; retirement releases execution only. `SUPPORTED` by Lifecycle §§10, 15–17. |

## 5. Reassessment of the seven v0 “Genuine Gaps”

| Previous claim | Revised finding |
|---|---|
| 1. Work Item→PDLT bootstrap identity/binding/epoch absent | Work Item/Logical identity/bootstrap/epoch are designed. Implementation is absent. Only the canonical binding mutation authority and truth model remain genuine GAPs. |
| 2. Submission ledger / UNCERTAIN absent | **Not a GAP.** Persist-before-actuate, operation lifecycle, reconciliation, per-carrier serialization and fork uncertainty are defined. `NOT_IMPLEMENTED`. |
| 3. Goal re-anchor trigger/reset absent | **Not a GAP.** Sparse counter + event triggers + experimental N are sufficient for V1. Reset occurs on completed anchor, not uncertain dispatch. `NOT_IMPLEMENTED`. |
| 4. Parent/child isolation/join/RETIRED provenance absent | **Not a GAP.** Explicit lifecycle, creation modes, wait/return states, and “retire worker, not history” cover it. `NOT_IMPLEMENTED`. |
| 5. Freeze target / Reviewer independence absent | **Not a GAP.** Frozen v4 exact Snapshot plus FRESH Reviewer inputs cover reproducibility and independence. `NOT_IMPLEMENTED`. |
| 6. Current-carrier resolver absent | Resolver and rollover return route are designed. Implementation is absent, but canonical binding authority/single-truth/inverse uniqueness still block reliable resolution and remain GAPs. |
| 7. Review acknowledgement/revision lineage absent | Semantic acknowledgement/revision lineage is sufficiently defined by immutable Review Report, WorkerResult/receipt and selected Review Notes. `NOT_IMPLEMENTED`; no semantic acceptance state machine is required. A transport-delivery idempotency seam remains GAP-5 below. |

## 5. Genuine V1 design gaps

There are **five** remaining design gaps. Four are narrow binding/activation seams; one is the transport-side idempotent insertion boundary for a returned child result.

### GAP-1 — Canonical active binding mutation has no authority path

Initial bind, rollover and adoption mutate durable Harness state, but the binding contract does not route them through the baseline `Proposal → Policy → Authorized Delta → Reducer → ApplyResult` path. Runtime coordination must not directly write an active binding.

### GAP-2 — Provisional conversation bootstrap lacks pre-activation side-effect fencing

Rollover/fresh/fork flows may submit a bootstrap prompt before active binding commit. If that prompt can call tools, write externally, create proposals or delegate work, old and provisional carriers can execute concurrently. “Do not use tools” in prompt text is not enforcement.

### GAP-3 — Reverse uniqueness is not atomic

The contract requires both one active Conversation per Logical Thread and one active Logical Thread per Conversation, but a thread-local CAS alone cannot stop concurrent `L1→C7` and `L2→C7`. Both preconditions must be checked in one reducer transaction.

### GAP-4 — Active binding has no declared single source of truth

`LogicalThread.active_conversation_ref`, `binding_epoch`, `ProviderConversation.logical_thread_id`, and conversation lifecycle status can contradict each other if independently writable. The contract must name one authoritative relation and make the rest derived projections or lineage metadata.

### GAP-5 — Returned result delivery lacks explicit idempotent receipt semantics

Lifecycle defines `RETURNING` and a completion receipt, but does not explicitly define a durable delivery operation whose replay returns the original delivery receipt and prevents inserting the same `review_result_id` twice after a restart or lost acknowledgement. The generic Submission Operation contract covers Harness actuation in principle, but the child-result delivery deduplication key and recipient-side applied marker are not stated. This is a transport gap, distinct from semantic Review acceptance.

## 6. Minimal proposed additions

1. Define one canonical `ActiveConversationBinding(logical_thread_id, provider_conversation_id, generation)` relation.
2. Define a single authorized compare-and-set operation for initial bind, rollover and adoption:

   ```text
   expected current binding = null | C1@generation
   new binding = C2@generation+1
   AND C2 is not actively bound to another Logical Thread
   ```

   It must pass through Proposal/Policy/Authorized Delta/Reducer and atomically return ApplyResult.
3. Make conversation `ACTIVE/SUPERSEDED`, `LogicalThread.active_conversation_ref`, and reverse lookup derived/indexed views; make historical ownership explicitly lineage-only.
4. Permit pre-activation only by either:
   - reserving/creating a conversation without execution; or
   - adapter-enforced side-effect-disabled bootstrap plus semantic-ingestion quarantine.

   If neither is supported, fail closed, keep the old binding active, and do not speculative-send.
5. Fence browser actuation with `(conversation_ref, lease_generation, binding_generation)`; stale runtime senders are rejected before dispatch.
6. Add a minimal `ResultDelivery` operation keyed by `(result_id, destination_logical_thread_id, destination_binding_generation)`, with persist-before-actuate, `DELIVERING|DELIVERED|UNCERTAIN`, reconciliation, and a durable recipient-side applied marker. Replaying the same key returns the original receipt and never inserts a second result.

No peer Designer, general Agent graph, semantic supervisor, or V2 governance is required.

## 7. Implementation work (not design gaps)

The following are contract-defined implementation work in `noos-shuttle`:

- durable Work Item/Logical Thread/child-worker records;
- deterministic carrier observer for `ATTACHING/READY/GENERATING/STABILIZING/SUSPENDED/RECOVERING/BROKEN`;
- persistent Submission Operation ledger, pre-submit baselines and UNCERTAIN reconciliation;
- tab/conversation attachments, actuation leases, epoch fencing and restart recovery;
- Step Mode GO and sparse Goal Re-anchor counter/hooks;
- idempotent Sedimentation fork and Fresh Reviewer spawn/bootstrap;
- exact Freeze Snapshot and immutable Review Report/WorkerResult receipts;
- parent wait-state clearing and result delivery by current parent Logical Thread binding;
- result-delivery operation/receipt and recipient deduplication after the minimal GAP-5 addition;
- COMPLETED/RETIRED lifecycle with retained provenance.

Existing page-context detection, route/conversation reset, `pagehide` cancellation and generation DOM observation are useful adapter foundations, but they do not yet implement the Harness contracts above.

## 8. V1 readiness assessment

### 8.1 How many genuine V1 design gaps remain?

**Five.** GAP-1 through GAP-4 concern canonical active-conversation binding/activation safety; GAP-5 concerns idempotent transport delivery of a child result.

### 8.2 Which findings are only implementation work?

GO idempotency and UNCERTAIN recovery, sparse Goal Re-anchor, child lifecycle/isolation, Sedimentation completion, frozen exact target, Fresh Reviewer context/independence, RETIRED provenance, immutable Review Result, and the intended parent-rollover-aware route are already defined. They are implementation work, not design gaps, except for the unresolved binding and result-delivery seams above.

### 8.3 Is the design sufficient to start the first implementation experiment?

**Yes, with a narrow boundary.** It is sufficient to start Implementation Slice 0 (carrier observation/binding experiment) and Slice 1 (Human-triggered GO + durable submission reconciliation), provided the experiment does not claim safe binding rollover, worker activation, or result delivery. GAP-1 through GAP-5 must be closed before an experiment claims safe end-to-end fork/rollover/Reviewer return routing or treats those paths as implementation-safe.

Therefore the correct readiness statement is:

> Start the first bounded implementation experiment now; do not claim the complete V1 E2E flow implementation-safe until GAP-1 through GAP-4 are resolved in the Working Design Contracts.
