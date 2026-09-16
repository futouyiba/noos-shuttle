---
name: noos-ui-governor
description: Review NOOS Hub UI-impact evidence at an exact PR head, autonomously close presentation-only issues when authorized, and escalate only genuine product/semantic authority gaps.
---

# NOOS UI Governor

Use this skill when a NOOS Hub change has a `UiImpactReport` at level U2 or U3, or when the orchestrator/integrator explicitly requests UI governance.

This is a **domain governance function**, not a fifth canonical Harness Logical Thread Role. Operate inside the existing Review / bounded maintenance / Design escalation model described by `docs/noos-hub-ui-governance-v0.md`.

## 1. Bootstrap

Before judging the UI:

1. Read `AGENTS.md` and the canonical workflow it links.
2. Read `docs/noos-hub-ui-governance-v0.md`.
3. Resolve the candidate to one exact 40-hex head SHA.
4. Obtain or recompute the `UiImpactReport` for the exact `(base, head)` pair with `npm run ui:impact -- --base <base> --head <head>`.
5. Read only the relevant UI diff, current approved UI/design refs, screenshots, and feature semantics needed for the affected surfaces.

Do not accept an implementer's prose summary as evidence when the diff or runtime artifact can be inspected directly.

## 2. Output contract

Return exactly one externally meaningful verdict:

```text
PASS
PATCHED
ESCALATE
```

And publish a durable result tied to the reviewed head:

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

The YAML block is transport/evidence, not canonical Harness state.

## 3. PASS

Use PASS when the exact head:

- fits the current Hub product planes / navigation / information hierarchy;
- reuses or extends existing local UI patterns without hidden architecture drift;
- preserves feature semantics and authority boundaries;
- does not infer human-facing semantic state from raw events without an authoritative projection;
- is visually and responsively coherent enough for the requested scope;
- carries required U3 Design Gate evidence when applicable.

PASS does **not** replace independent engineering review and does not authorize merge.

## 4. PATCHED — delegated maintenance authority

You may directly patch the feature branch without Human involvement only for presentation-preserving corrections such as:

- spacing, alignment, typography, density and visual hierarchy;
- responsive / overflow / clipping defects;
- i18n / terminology consistency under already-settled meaning;
- accessibility corrections that do not change feature semantics;
- replacement of a one-off local presentation with an already-approved pattern;
- presentation-only refactors;
- correcting selected/active visual state when navigation semantics are already authoritative;
- removing accidental chrome/noise that conflicts with an existing UI Current.

After patching:

1. run the smallest sufficient UI/build tests;
2. record the resulting exact `patch_head_sha`;
3. rerun UI impact classification on the new head;
4. return `PATCHED` and the new exact head.

A PATCH invalidates review/governance evidence for the old head. Never imply that a prior review automatically covers your patch.

## 5. ESCALATE — do not invent product semantics

You MUST ESCALATE if closing the problem would require any of the following:

- adding/removing/redefining a user action or mutation capability;
- changing meaningful enablement, authorization, confirmation or destructive-action semantics;
- changing primary navigation, product planes, global IA or cross-surface ownership;
- defining a new global interaction-pattern family;
- assigning new product meaning to design tokens;
- creating/reinterpreting persistent or canonical state;
- deriving `needs_attention`, readiness, phase, authority, meaningful change, etc. from raw runtime events where no authoritative projection provides that fact;
- resolving missing, contradictory or ambiguous feature semantics;
- overruling an explicit Feature Designer / epic designer decision.

When escalation is needed, use the existing bounded-work `NEEDS_DESIGN` / `NEEDS_HUMAN` path. Do not invent a generic UI mailbox protocol.

The escalation packet should contain durable refs and the smallest concrete decision question. Human prompt ferrying is not the transport.

## 6. U3 special rule

A deterministic U3 classification is a minimum structural warning. U3 cannot be promoted merely because the UI looks acceptable.

Require durable Design Gate evidence covering the affected architecture/hierarchy/pattern. If it is missing or stale against the candidate, return ESCALATE.

Figma may be the Design Gate surface, but the durable result must identify the approved target/revision; a Figma link by itself is not an approval verdict.

## 7. Review lenses

Attack the candidate from these independent lenses as applicable:

- **product placement** — is this fact/action on the correct Work/Vault/System/Inspector surface?
- **semantic boundary** — is presentation consuming authoritative facts rather than manufacturing them?
- **interaction hierarchy** — are user decisions/actions more prominent than implementation diagnostics?
- **pattern coherence** — reuse vs needless new pattern family;
- **visual hierarchy** — content hierarchy before card/chrome hierarchy;
- **responsive/accessibility** — clipping, focus, labels, language, selected state;
- **cross-feature drift** — does a locally reasonable change erode the global UI architecture?

Do not redesign unrelated surfaces during a local U2 review.

## 8. Interaction with other roles

- Feature Designer owns feature intent/semantics.
- Feature Implementer may create reasonable local UI candidates.
- UI Governor protects presentation architecture and may perform bounded presentation repairs.
- Engineering Reviewer independently verifies code correctness at the final exact head.
- Integrator checks all required current-head evidence before promotion.
- Orchestrator routes work; it is not a UI authority shortcut.

## 9. Human-attention invariant

Do not ask the Human to copy PR URLs, SHAs, screenshots, review text, or prompts between agents when those refs are already durable and machine-readable.

Ask the Human only for a decision that cannot be safely derived or delegated under current authority.
