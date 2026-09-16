# Bounded Continuation Run v0 — Working Design Candidate

> Status: `WORKING DESIGN CANDIDATE`
>
> This document records Primary Design reasoning for a possible post-Slice-1 Deliberation Harness capability. It is **not** a V1 authority contract, does not supersede `futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1`, and does not change `v1-primary-design-current.md`.
>
> Current V1 remains implementation-led. This candidate should advance only after Human-GO/runtime evidence is strong enough to justify bounded automatic continuation.

## 1. Problem

In long-running design conversations, the Human often performs a repetitive but semantically meaningful action:

```text
Assistant completes a turn
→ the current Goal is still open
→ the Assistant has not reached a Human/review/evidence boundary
→ Human sends: go
→ the same deliberation continues
```

The desired capability is not a browser macro that clicks Send N times. It is a bounded Harness operation that can replace this repetitive Human continuation action while preserving Goal/Scope authority, stop boundaries, runtime idempotency, and provenance.

Product projection may be:

```text
[ Go ]
[ Go ×5 ]
[ Go ×10 ]
[ Go ×20 ]
```

The domain primitive is **Bounded Continuation Run (BCR)**.

## 2. Core definition

A Bounded Continuation Run is a Human-authorized budget of at most `N` new continuation user turns within the same Logical Thread, Current Goal/Scope basis, and Provider Conversation binding.

```text
Go ×10
≠ click Send ten times

Go ×10
= authorize at most ten new continuation submissions,
  each re-evaluated after the preceding Assistant turn
```

`N` is a **budget**, not authority to bypass semantic or runtime gates.

The budget authorizes only continuation turns. It does not grant:

- semantic decision authority;
- Goal or Scope mutation authority;
- review/promotion/merge authority;
- unrestricted tool authority;
- rollover authority;
- authority to create new Work Items or optional design scope.

## 3. Design principle

The default continuation payload remains the empirically effective literal:

```text
go
```

The Harness should not make every continuation message “smarter.” Its job is to know:

1. when a plain `go` is still safe;
2. when a short re-anchor is useful;
3. when continuation must stop.

This preserves local reasoning momentum while allowing the Harness to enforce boundedness and scope discipline.

## 4. Existing authority reused

BCR must reuse existing Deliberation Harness mechanics rather than create parallel control planes:

- `LogicalThread` / `LogicalThreadControl`;
- `CurrentConversationBinding`;
- `ActuationLeaseAuthority`;
- Browser Runtime Observation (`READY / GENERATING / STABILIZING / ...`);
- `SubmissionOperation`;
- `DispatchFence`;
- uncertain-submission reconciliation;
- Human/Review/Evidence/Worker gates;
- existing Goal / Scope / Authority Basis where available.

BCR orchestration belongs to the NOOS Hub / Harness control plane. Shuttle/browser code remains Observe + Actuate transport, not the owner of continuation semantics.

## 5. Minimal durable identity

BCR introduces one new runtime identity:

```text
ContinuationRun
- run_id
- logical_thread_id
- provider_conversation_ref
- binding_generation

- goal_ref / run-local goal snapshot ref
- scope_ref / run-local scope snapshot ref
- authority_basis_ref?

- max_continuations
- consumed_continuations

- last_consumed_assistant_turn_ref?
- pending_submission_operation_id?

- plain_go_streak
- frontier_revision
- current_focus_ref?

- reanchor_policy_version
- status
- end_reason?
- revision
- created_at
```

Suggested lifecycle:

```text
CREATED
ACTIVE
ENDED
CANCELLED
FAILED_SAFE
```

`ENDED` does not mean the Goal is complete. Meaning comes from `end_reason`.

Each actual continuation still uses the existing `SubmissionOperation`, adding linkage such as:

```text
parent_continuation_run_id
continuation_index
continuation_mode = PLAIN_GO | SOFT_REANCHOR_GO
submission_origin = HARNESS_CONTINUATION | HARNESS_REANCHOR
```

There is at most one in-flight continuation submission per Run.

## 6. Budget semantics

`max_continuations` counts new automated user continuation turns accepted by the Provider.

```text
PREPARED          → budget not consumed
DISPATCHING       → not yet proven consumed
OBSERVED_ACCEPTED → budget consumed
```

The budget does not count successful Assistant replies. If a continuation user turn is accepted and later generation fails, that authorization has still been consumed.

Budget exhaustion terminates the Run:

```text
Run = ENDED / BUDGET_EXHAUSTED
Goal = still IN_PROGRESS (unless independently judged satisfied)
```

A later Human `Go ×N` creates a **new** ContinuationRun rather than refilling the old Run. This preserves Human authorization provenance.

## 7. Goal, Closure Frontier, and local reasoning

### 7.1 Goal/Scope remain authority

Current Goal / Scope / Authority Basis remain the semantic authority.

For managed threads, BCR uses existing durable Goal/Scope refs.

For legacy ordinary chats lacking an explicit managed Goal object, Run initialization may derive a **run-local Goal/Scope snapshot**. That snapshot is valid only for this Run and is not automatically promoted into Logical Thread authority.

The Run may not silently redefine its Goal/Scope. If Goal redefinition is required, stop.

### 7.2 Closure Frontier

BCR may maintain a run-local **Closure Frontier**: the unresolved obligations that must be closed for the current Goal to be considered complete.

This is not a Plan and not authority.

```text
Goal / Scope / Authority
        ↓ constrain
Closure Frontier
        ↓ current focus
Working Agent reasoning
```

A Closure item is about **what must become resolved**, not **how to resolve it**.

```text
ClosureItem
- closure_item_id
- statement
- parent_closure_item_id?
- origin = INITIAL | REFINED_FROM_PARENT
- status = OPEN | SATISFIED | REFINED | OBSOLETE
- basis_turn_ref?
```

The active frontier is the set of required OPEN leaf items.

### 7.3 Refine, do not silently expand

The Working Agent may reveal a more precise breaker while investigating an existing Closure item.

Allowed:

```text
C17 OPEN
→ refine into C17.1 + C17.2
```

Only if the child obligations are necessary to answer their parent.

Not allowed:

```text
interesting new topic
→ silently becomes required work
```

Every newly required Closure item must have lineage to a parent Closure item or explicit Goal completion criterion. Otherwise it is an optional extension / scope-expansion candidate and automatic continuation stops.

### 7.4 Current Closure Focus

Normally only one Closure item is the local continuation focus.

The Harness owns the fact that this focus is the current unresolved obligation; it does **not** own the Working Agent’s reasoning method, investigation strategy, experiment choice, or detailed next action.

The Working Agent remains free to decide how to close the focus.

## 8. Continuation Evaluator boundary

The external Continuation Evaluator is a semantic classifier / state projector, not a Planner and not an authority source.

It may interpret and canonicalize what the Working Agent has established. It may not invent methods, experiments, artifacts, comparisons, or required tasks that are absent from the Assistant response / frozen Closure basis.

Suggested assessment:

```text
ContinuationAssessment

goal_status:
  IN_PROGRESS
  SATISFIED
  UNCERTAIN

focus_status:
  OPEN_ADVANCING
  SATISFIED
  REFINED
  BLOCKED
  STALLED_SUSPECTED
  UNCERTAIN

scope_relation:
  WITHIN_SCOPE
  OPTIONAL_EXTENSION
  OUT_OF_SCOPE
  UNCERTAIN

dependency:
  NONE
  NEEDS_HUMAN
  NEEDS_REVIEW
  NEEDS_EVIDENCE
  NEEDS_EXTERNAL
  UNCERTAIN

anchor_need:
  NONE
  SOFT
  REBASE_SUSPECTED

next_action_hint?: optional
next_action_basis?: EXPLICIT | ENTAILED | NONE
confidence:
  HIGH | MEDIUM | LOW
```

An explicit `next_action` is **not required** for continuation. If the current Closure Focus remains OPEN and is advancing, a plain `go` may be sufficient even when the Assistant did not state a formal next step.

A next-action hint, when present, must be extractive/entailed, never a generated plan.

## 9. Deterministic continuation policy

V0 should bias toward precision over recall. Low/medium confidence returns control to the Human.

A simplified authorization rule:

```text
AUTO_CONTINUE iff

Run.status == ACTIVE
AND budget_remaining > 0
AND goal_status == IN_PROGRESS
AND focus_status IN { OPEN_ADVANCING, REFINED }
AND scope_relation == WITHIN_SCOPE
AND dependency == NONE
AND confidence == HIGH
AND LogicalThreadControl == CONTINUE
AND no Human/Review/Evidence/Worker gate blocks
AND authority/binding basis is still current
AND no Human intervention has occurred
AND runtime dispatch gates pass
```

Any uncertainty that can create semantic drift should stop rather than guess.

## 10. Focus transition rules

When the current Closure Focus remains OPEN, the same focus continues.

When it is SATISFIED:

```text
exactly one eligible open successor
→ deterministic focus transition
→ next continuation uses soft re-anchor

multiple possible successors
→ END / NEXT_FOCUS_UNRESOLVED

no open frontier item
→ GoalClosureCheck
```

The Harness must not choose between multiple design questions. That would cross into planning/prioritization authority.

When a focus is materially REFINED into child obligations, the next continuation uses a soft re-anchor.

## 11. Completion semantics

Keep these layers separate:

1. **Assistant Turn completion** — Provider/browser observation fact.
2. **Closure Focus completion** — current obligation resolved.
3. **Closure Frontier completion** — no required OPEN leaf obligations remain.
4. **Goal completion** — Goal/Scope completion evaluation.
5. **ContinuationRun termination** — this bounded operation ends for any reason.

Frontier closure is strong evidence but not automatically Goal authority. When the last required item closes, perform a Goal Closure Check.

A Run-local Goal closure assessment may end BCR with `GOAL_SATISFIED`; it does **not** automatically close a GitHub Issue, merge/promote an artifact, or perform another durable governance transition.

## 12. End reasons

V0 may use reasons such as:

```text
GOAL_SATISFIED
BUDGET_EXHAUSTED

WAIT_HUMAN
WAIT_REVIEW
WAIT_EVIDENCE
WAIT_EXTERNAL

NEXT_FOCUS_UNRESOLVED
OPTIONAL_SCOPE_EXTENSION
SCOPE_DRIFT
STALLED

GOAL_CLOSURE_UNCERTAIN
FRONTIER_INCOMPLETE
GOAL_REDEFINITION_REQUIRED

AUTHORITY_CHANGED
CONVERSATION_REBASE_REQUIRED

USER_CANCELLED
USER_INTERVENTION

SUBMISSION_UNCERTAIN
RESPONSE_CORRELATION_UNCERTAIN
CARRIER_FAILURE
```

Human Stop produces `CANCELLED / USER_CANCELLED`. A semantic Human intervention cancels the active Run; remaining budget is not resumed automatically.

Uncertain side effects / unrecoverable execution ambiguity produce `FAILED_SAFE` and do not auto-resume in V0.

## 13. Plain Go and re-anchor policy

Default continuation:

```text
go
```

Soft re-anchor is context maintenance, not authority mutation.

Suggested V0 policy parameter:

```text
max_plain_go_streak = 3
reanchor_on_focus_change = true
reanchor_on_frontier_refinement = true
```

The value `3` is a dogfood hypothesis, not a contract invariant.

Soft re-anchor should be short and reference **Current Authorized Goal / Current Closure Focus**, not blindly repeat the original Turn-0 prompt.

Example semantics:

```text
Current Goal: <short current goal>
Current Closure Focus: <short unresolved obligation>
Keep current Scope; do not expand optional follow-ups.
Stop if completion or a new Human/review/evidence boundary is reached.
```

## 14. Re-anchor transport and provenance

Provider UI transport must not be confused with semantic origin.

A message sent through a Provider “user” composer may originate from:

- Human;
- Harness continuation policy;
- Harness re-anchor policy.

NOOS must preserve the true origin in its own ledger.

Conceptually separate:

```text
ContinuationDispatch
- user_payload = "go"
- harness_reanchor_payload?
- rendered_transport_payload
```

If a Provider exposes a dedicated Harness/system/additional-context channel, project the re-anchor there.

For ChatGPT Web / Provider UI that only exposes the user composer, fall back to a clearly delimited synthetic payload, e.g.:

```text
go

[NOOS Re-anchor]
...
[/NOOS Re-anchor]
```

The transcript transport role remains `user`, but NOOS provenance records it as Harness-generated.

Soft re-anchor must not mutate Goal/Scope/Authority or introduce new Closure obligations. It only restates already-current state.

A true State Rebase is **not** a continuation mode in V0. If Goal/Scope authority, Provider Conversation binding, or other semantic basis requires rebase, end the active Run and hand control to the appropriate rebase/rollover path.

## 15. Browser/runtime integration

BCR never defines Provider readiness itself. It consumes the existing Browser Runtime Observation contract.

`Carrier == READY` is necessary but insufficient for dispatch.

Before processing the next turn BCR must prove:

```text
previous SubmissionOperation
→ was accepted
→ produced/correlates to a new Assistant Turn
→ that Assistant Turn is stable
→ that Assistant Turn has not already been consumed by this Run
```

BCR must not inspect half-generated replies during `GENERATING` or `STABILIZING`.

### Binding vs Carrier

The Run pins:

```text
logical_thread_id
provider_conversation_ref
binding_generation
```

It does **not** pin `carrier_ref / lease_generation` for the entire Run. Browser carriers are replaceable physical execution surfaces.

Each dispatch reacquires/checks the current ACTIVE `ActuationLeaseAuthority` and uses the existing `DispatchFence`.

If the `CurrentConversationBinding` changes during the Run, V0 ends with a rebase-required reason rather than automatically crossing to a new Provider Conversation.

### Stable Assistant turn identity

Browser observation should expose an `AssistantTurnObservation` or equivalent stable turn identity:

```text
assistant_turn_ref
provider_conversation_ref
predecessor_user_turn_ref?
content_fingerprint
observed_complete_at
```

Provider message IDs are preferred. DOM nodes/selectors are not semantic identities.

The correlation `SubmissionOperation S_i → Assistant Turn T_i` must be proven or conservatively reconciled. If it cannot be uniquely established, stop/fail safe rather than guessing.

### Exactly-once consumption

Consumption should be idempotent under an identity such as:

```text
(run_id, assistant_turn_ref)
```

A crash after evaluating a turn must not lead to the same turn authorizing two next submissions.

The reducer/application boundary should atomically verify the pending source submission, reject already-consumed turns, apply any run-local frontier delta, advance the last-consumed turn, clear pending submission state, and advance Run revision before authorizing the next `SubmissionOperation`.

## 16. Restart / carrier recovery

BCR reuses existing SubmissionOperation reconciliation:

- `PREPARED`: handle under normal submission rules;
- `DISPATCHING / UNCERTAIN`: reconcile observable conversation state; never blind retry;
- `OBSERVED_ACCEPTED`: wait for/correlate the stable Assistant response;
- recovered completed turn: consume exactly once.

A browser/tab sleep or replaceable carrier recovery may continue the Run only after a resync barrier verifies:

1. same Provider Conversation and binding generation;
2. last consumed turn can still be located/reconciled;
3. pending Submission outcome is known or conservatively handled;
4. no unknown Human-authored user turn occurred since the Run boundary;
5. current carrier is READY with a valid actuation lease.

If a previously unknown Human user turn appears in the transcript tail, cancel as `USER_INTERVENTION`.

V0 should not automatically create/open a replacement provider conversation after a true conversation rollover/closure.

## 17. Shadow-first rollout

Do not begin with autonomous `Go ×20`.

Recommended ladder:

```text
A. Offline labeled fixtures
B. Live Shadow Mode (evaluate, never actuate)
C. Assisted Continue (recommend Go/Stop, Human clicks)
D. Bounded Auto: Go ×5
E. Go ×10 / ×20 after evidence
F. Run-until-boundary only after separate design/evidence
```

Shadow Mode must not mutate `ThreadControl`, create continuation submissions, or claim authority. It is observation only.

Normal shadow assessments may remain ephemeral. Persist/durably record those that become decision-relevant, anomaly evidence, fixture candidates, or actual auto-actuation receipts.

## 18. Evaluation priorities

The primary safety error is a **false continue**, not a false stop.

Important metrics:

- False Continue Rate;
- False Stop Rate;
- Planner Intrusion Rate;
- Anchor Miss Rate;
- Human correction after automatic continuation;
- drift/stall after soft re-anchor vs plain-go sequences.

Blocking negative cases (`NEEDS_HUMAN`, `NEEDS_REVIEW`, `GOAL_SATISFIED`, clear scope drift, required Goal redefinition) should target zero false-continue in the initial fixture gate.

## 19. Explicit v0 non-goals

Do not include in BCR v0:

- unbounded `Run until boundary`;
- automatic Goal creation/redefinition;
- automatic Scope expansion;
- automatic Work Item fork;
- automatic next-focus selection among multiple valid candidates;
- automatic Provider Conversation rollover;
- automatic promotion/merge/Issue closure;
- complex semantic progress scoring;
- a second Browser Runtime or Submission idempotency implementation;
- a full task planner / plan DSL.

## 20. Current design assessment

The design appears architecturally compatible with existing NOOS Harness contracts because it mostly composes already-settled runtime seams.

The remaining uncertainty is now concentrated less in architecture and more in evidence:

1. can the Continuation Evaluator classify real design-turn boundaries with sufficiently low false-continue rate?
2. does periodic/event-triggered soft re-anchor improve drift without harming local reasoning momentum?
3. can Slice-0/1 provider observation reliably correlate a durable submission with a stable Assistant turn across reload/recovery?
4. what minimal run-local Closure Frontier representation proves useful in real conversations without becoming a second Plan authority?

These are better answered by fixture/shadow/provider experiments than by further free-form Primary Design elaboration.
