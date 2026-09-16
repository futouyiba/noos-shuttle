# NOOS Hub UI Governance v0 — Zero-copy Impact Routing + Delegated UI Governor

> Status: **Design / Implementation Candidate** — repo-local experiment, not yet promoted authority  
> Parent issue: `noos-shuttle#36`  
> Scope: NOOS Hub UI changes inside `futouyiba/noos-shuttle`  
> Canonical cross-agent workflow remains `futouyiba/noos_docs/docs/agent-workflow.md`. If this document conflicts with that workflow or an authoritative Harness contract, the authoritative contract wins.

## 0. Problem

NOOS Hub will keep gaining small product features. Many of those features will touch UI, but requiring a Human to manually copy prompts, PR links, exact SHAs, screenshots, review results, and next-step instructions between Feature Designer, Implementer, UI Owner, Reviewer, Integrator, and Orchestrator would make the governance layer the throughput bottleneck.

The desired operator experience is instead:

```text
Human states intent
        ↓
Feature work proceeds
        ↓
UI impact is detected automatically
        ↓
UI governance is routed automatically
        ↓
PASS / bounded PATCH / real escalation
        ↓
review + integration continue on exact head
        ↓
Human appears only for irreducible judgment
```

Core operating goals:

```text
No manual routing.
No manual context ferrying.
Default local autonomy.
Escalate only irreducible judgment.
```

This document defines the smallest governance layer that can move the repo toward that behavior **without inventing a parallel authority system or pretending the current Harness can already auto-resume cross-agent escalations**.

---

## 1. The key architectural decision: UI governance is not a fifth Harness Role

The current Harness role model already has:

```text
Control
Design
Review
Integration
```

`UI Governor` is therefore **not** introduced as a fifth canonical Logical Thread Role.

It is a **domain governance function** that may be executed by different existing roles depending on the operation:

| UI governance operation | Existing role / mechanism |
| --- | --- |
| deterministic impact classification | non-agent tool / CI evidence producer |
| UX consistency review | Review Thread with UX/product dimension |
| bounded presentation-only correction | delegated maintenance worker / implementation worker |
| structural UI design | Design Thread / epic designer |
| review reconciliation | Integration Thread |
| routing / scheduling | Control / orchestrator |

This keeps role taxonomy stable and makes UI governance an application of the existing Harness rather than a competing orchestration model.

---

## 2. The second key decision: ordinary UI updates are not Cross-Agent Escalations

The current Cross-Agent Handoff / Escalation contract defines Escalation as an authority-aware interruption/resume protocol for the **same bounded work identity**. It is explicitly not generic agent messaging.

The current GitHub mailbox implementation is also intentionally restricted: Human-mediated escalations remain `OPEN`; result delivery does not itself authorize semantic continuation; automatic resume remains outside the implemented slice.

Therefore this governance MUST NOT do:

```text
Every PR changed UI
→ create NEEDS_DESIGN escalation
→ mailbox packet
→ wait for result
→ Human resumes
```

That would overload Escalation semantics and create more ceremony than the UI change itself.

Instead:

```text
normal UI change
→ UiImpactReport (derived evidence)
→ governance review / bounded patch

only if actual design / semantic authority is missing
→ existing NEEDS_DESIGN / NEEDS_HUMAN Escalation
```

A `UiImpactReport` is observation/evidence. It is not Work Item state, authority, a reducer transition, or an implicit approval.

---

## 3. End-to-end flow

```text
Feature Designer / Feature Implementer
               │
               │ normal feature branch + PR
               ▼
       exact implementation head H1
               │
               ▼
      UI Impact Detector (deterministic)
               │
               ▼
         UiImpactReport(H1)
          /       |        \
        U0        U1       U2 / U3
        │         │          │
        │         │          ▼
        │         │     UI Governance Function
        │         │       /    |     \
        │         │     PASS  PATCH  ESCALATE
        │         │       │     │       │
        │         │       │     │       └─ existing bounded-work escalation
        │         │       │     │
        │         │       │     └─ new exact head H2
        │         │       │            ↓
        └─────────┴───────┴──── exact-head independent review
                                      ↓
                                Integrator gate
                                      ↓
                                   merge
```

The important property is that **the Human is not the transport** between these boxes.

---

## 4. Impact levels

### U0 — NONE

No meaningful user-facing Hub UI impact.

Typical examples:

- backend-only implementation;
- pure protocol/core logic with no Hub UI surface change;
- unrelated docs.

Default route:

```text
record report → no UI governance work
```

### U1 — LOW

Low-risk UI-associated change with no structural/action/authority change.

Typical examples:

- review screenshots / visual evidence only;
- UI tests only;
- assets only;
- narrow copy correction under an existing locale and semantic meaning;
- explicit reuse of an already-approved local pattern without changing action/state semantics.

Default route:

```text
record report → lightweight/asynchronous check; do not require Human
```

The deterministic v0 classifier is intentionally conservative: when it cannot prove a change is U1, it raises the minimum to U2.

### U2 — LOCAL_DELTA

A real local UI delta that does not, by itself, alter global product architecture.

Typical examples:

- adding or changing a local Hub page surface;
- local layout / interaction affordance changes;
- local responsive behavior;
- a local user action surface whose feature semantics already exist authoritatively;
- a new local presentation mapping from an existing projection.

Default route:

```text
UI governance required
→ PASS or bounded PATCH without Human by default
→ ESCALATE only if semantics/authority are missing
```

### U3 — ARCHITECTURE_DELTA

Structural/product-wide UI change.

Hard examples:

- primary navigation or route topology;
- global shell / product plane boundaries;
- cross-surface information hierarchy;
- a new global interaction pattern;
- design-token semantics with product-wide meaning;
- UI changes requiring new canonical/persistent state;
- UI attempting to derive a human-facing semantic state from raw runtime events without an authoritative projection;
- feature semantics too ambiguous to know what the UI should mean.

Default route:

```text
hold promotion
→ explicit Design Gate / epic designer evidence
→ then implementation / review
```

A model may raise a classification above the deterministic minimum. It may not lower a hard-triggered minimum without durable rationale and evidence.

---

## 5. UiImpactReport

The detector emits a durable, exact-revision observation:

```yaml
ui_impact_report:
  schema: noos.ui-impact.v0
  base_sha: <40 hex>
  head_sha: <40 hex>
  level: U0 | U1 | U2 | U3

  ui_files: []
  surfaces: []

  risk_flags:
    navigation_changed: false
    shell_changed: false
    global_styles_changed: false
    user_action_surface_changed: false
    responsive_changed: false
    copy_surface_changed: false
    review_evidence_only: false

  reasons: []
```

Properties:

- deterministic for the same `(base_sha, head_sha, detector_version)`;
- exact-head anchored;
- evidence only;
- restart-safe because it can be recomputed from Git history;
- does not claim semantic correctness;
- does not authorize merge or continuation.

The detector should prefer false-positive escalation of UI review over silently classifying a structural change as low risk.

---

## 6. UiGovernanceResult

When U2/U3 requires governance, the governance function returns a result tied to the exact reviewed head:

```yaml
ui_governance_result:
  schema: noos.ui-governance-result.v0
  reviewed_head_sha: <40 hex>
  impact_level: U2 | U3
  verdict: PASS | PATCHED | ESCALATE

  findings: []
  current_ui_refs: []

  patch_head_sha: <40 hex | null>
  escalation_ref: <durable ref | null>
  design_gate_refs: []
```

Semantics:

### PASS

The reviewed exact head fits current UI architecture and does not require governor-owned repair.

### PATCHED

The governor applied only changes inside its delegated presentation-maintenance authority. `patch_head_sha` becomes the new candidate head.

**Any patch invalidates review evidence for the prior head.** Normal exact-head incremental review rules apply.

### ESCALATE

The governor cannot safely close the issue inside delegated authority. It creates/references an existing bounded-work `NEEDS_DESIGN` or `NEEDS_HUMAN` Escalation and does not invent an answer.

`ESCALATE` is not failure. It is correct routing of authority.

---

## 7. Delegated UI maintenance authority

A UI Governor may autonomously patch only when semantics remain unchanged.

### Allowed without Human

- spacing, alignment, typography and visual hierarchy corrections;
- responsive / overflow / clipping fixes;
- i18n and terminology consistency under already-defined meaning;
- accessibility corrections that do not change feature semantics;
- replacing one-off local presentation with an already-approved pattern;
- presentation-only refactors;
- removing accidental card/chrome/noise that violates an existing UI Current;
- correcting active/selected visual state when navigation semantics are already authoritative.

### Must escalate

- add/remove/redefine a user action or mutation capability;
- change when an action is enabled, authorized, confirmed, or destructive in a semantically meaningful way;
- change primary navigation, product planes, global IA, or cross-surface ownership;
- define a new global interaction-pattern family;
- create new design-token semantics with product meaning;
- create or reinterpret persistent/canonical state;
- infer `needs_attention`, phase, readiness, authority, meaningful change, etc. from raw events when no authoritative presentation projection provides it;
- resolve contradictory or missing feature semantics;
- change a requirement owned by the Feature Designer / epic designer.

A useful test is:

> If the patch changes **what the product means or allows**, rather than only **how an already-defined meaning is presented**, it is outside delegated UI maintenance authority.

---

## 8. Relation to Feature Designer / Implementer

Feature agents are allowed to implement reasonable local UI directly. They do not need to stop and manually ask a central UI Owner for every row, label, or local layout.

But they do not obtain new UI architecture authority by doing so.

Their normal responsibility is:

```text
implement bounded feature
→ expose authoritative feature semantics/projection
→ produce candidate UI where needed
→ let automatic UI impact routing run
```

The UI governance layer then catches cross-feature consistency and architecture drift asynchronously.

This is intentional eventual consistency at the product-presentation layer, bounded by hard U3 triggers.

---

## 9. Ordering with engineering review

Default order for a UI-impacting implementation:

```text
implementation candidate
→ self-tests
→ UiImpactReport
→ UI governance PASS/PATCH/ESCALATE
→ exact-head independent engineering review
→ Integrator
```

Why UI governance precedes final engineering review:

- a governor PATCH changes the code head;
- reviewing engineering correctness before that patch would cause unnecessary re-review churn;
- the existing exact-head gate naturally handles the final candidate.

If later engineering review itself causes UI changes, the detector reruns on the new head and UI governance is re-evaluated incrementally.

There is no hidden “approved once forever” state.

---

## 10. Integrator gate

This v0 adds a repo-local UI gate on top of, not instead of, the existing independent-review gate.

Before promoting a Hub UI PR:

```text
U0
→ no UI governance result required

U1
→ impact evidence required; UI result optional unless raised by reviewer/integrator

U2
→ current-head UiGovernanceResult required
→ PASS or PATCHED(final head reviewed after patch)

U3
→ current-head UiGovernanceResult required
→ Design Gate evidence required
→ final exact head still requires independent engineering review
```

The Integrator must reject stale UI governance evidence exactly as it rejects stale engineering review evidence.

No governance marker can authorize a merge by itself.

---

## 11. Figma policy

Figma is the **strategic UI Current / design repository**, not a transaction log for every code edit.

### U0 / U1

No Figma update required.

### U2

Figma is optional. Use implementation screenshots / local design artifacts when sufficient. Promote a new reusable pattern into Figma only if it has become part of the product design language.

### U3

Figma / equivalent durable Design Gate is required before promotion when the change affects current Hub architecture, hierarchy, shell, product planes, or a global interaction pattern.

The desired lifecycle is:

```text
Figma CURRENT
  + structural delta
→ reviewed Candidate
→ Design Gate
→ implementation
→ screenshots vs target
→ promote updated CURRENT
```

Avoid accumulating `final-v2-final2` frames with no current pointer.

---

## 12. Periodic consolidation — next slice, not v0 runtime

Local autonomy creates useful throughput but eventually produces presentation drift. A later `UI Curator` / consolidation loop should periodically inspect recent UI-impacting changes for:

- duplicate pattern families;
- near-duplicate CSS / components;
- spacing / type / token drift;
- terminology and i18n divergence;
- action hierarchy drift;
- runtime vocabulary leaking into human-facing surfaces;
- repeated responsive defects;
- code ↔ Figma Current divergence.

Safe cleanup can become an autonomous maintenance PR. Structural drift becomes U3 and returns to Design Gate.

The Curator is also a governance function, not a new Harness Role.

---

## 13. Transport and automation strategy

### v0: GitHub is the routing/evidence surface

For a PR, UI impact is derivable from Git facts and should be published automatically as one stable machine-readable report/comment.

This removes the Human tasks:

```text
"this PR touched UI"
"here is the SHA"
"please review these files"
```

The governor consumes exact refs directly.

### Later: Harness subscribes to the same artifact schema

When NOOS can automatically spawn/route external workers reliably, the same `UiImpactReport` can become a trigger:

```text
U2 → spawn UX Review / UI Governor worker
U3 → spawn Design escalation workflow
```

No schema migration is required because the report was never authority.

### Escalation remains reserved

Only an actual blocking authority/design question crosses into the current Escalation contract.

This prevents generic PR notification traffic from polluting the durable interruption/resume protocol.

---

## 14. v0 implementation slice

This candidate is paired with a deliberately small implementation:

1. deterministic `ui-impact` CLI;
2. pure classifier tests;
3. root `npm run ui:impact` entry;
4. PR workflow that computes and publishes UI impact evidence;
5. project-local `noos-ui-governor` skill defining PASS/PATCH/ESCALATE behavior;
6. repo guidance telling agents and Integrator how to consume the evidence.

### Explicit non-goals

- no new canonical Harness object;
- no new reducer/state/event type;
- no generic message bus;
- no fake automatic resolution of HUMAN_MEDIATED Escalations;
- no automatic external Claude Code spawn in this slice;
- no full periodic curator implementation yet;
- no requirement that every local UI edit go through Figma;
- no weakening of exact-head independent engineering review.

---

## 15. Dogfood plan

The first useful test is not a synthetic architecture demo; it is real Hub PRs.

Classifier fixture expectations:

```text
backend-only diff                         → U0
review screenshots / UI tests only       → U1
feature-local Hub page / local CSS        → U2
main shell / routes / global IA           → U3
```

Then dogfood these questions:

- Does the report remove manual handoff work, or merely add another document?
- Are U2 false positives cheap because governance is autonomous?
- Does any important U3 change slip through as U2?
- Can the governor PATCH without stealing Feature/Design authority?
- Are PASS/PATCH/ESCALATE enough, or do we need another externally meaningful verdict?
- Does the Integrator have enough exact-head evidence to make the gate mechanical?
- Which residual Human steps can be removed next?

Only after real evidence should this Hub-specific pattern be generalized into `noos_docs` as a reusable domain-governance model.

---

## 16. One-line governance invariant

> **Feature agents may evolve local UI; deterministic evidence routes the change; UI governance may repair presentation but not invent product semantics; only real authority gaps escalate; every result remains exact-head and independently reviewable.**
