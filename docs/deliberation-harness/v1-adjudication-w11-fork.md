# V1 Adjudication Record — W11 Fence Model × FORKED Adapter Gap (2026-09-15)

> Authority baseline unchanged: noos_docs @ a49303ca. Narrow design
> clarification; the V1 architecture is not reopened.

## Decision 1 — W11 settle hop / fence ownership: ACCEPT reducer minting

Frozen identity model (do not overload any single counter):

- `operation_id` — logical submission identity; stable for the lifecycle.
- `dispatch_fence_id` — ONE authorized provider execution attempt; an opaque
  durable identity minted by the reducer at claim time, binding
  provider_conversation_ref + binding_generation + carrier_ref +
  lease_generation. Settle hops never re-mint: DISPATCHING →
  OBSERVED_ACCEPTED → COMPLETED all stay @ F17. A new fence is minted only on
  a fresh claim after a policy-permitted re-arm (FAILED_SAFE proven not
  accepted → PREPARED → claim → F18). UNCERTAIN must not be bypassed by
  minting a new fence.
- `operation_revision` — local authoritative state revision for CAS/stale
  fencing; +1 per authoritative hop (r12 DISPATCHING → r13 accepted → r14
  completed).

`settle_submission_operation` carries operation_id,
expected_operation_revision, expected_dispatch_fence_id, target_state,
execution_evidence_ref; the reducer atomically validates revision + fence +
legal transition + evidence-owns-attempt, then bumps the revision with the
fence unchanged. Mint commits crash-consistently with the state and
ApplyResult in one delta; replay of the same delta_id returns the original
ApplyResult and the original fence — never a re-mint.

## Decision 2 — FORKED gap: PARTIAL_ACCEPT, no third creation mode

Two axes plus a policy requirement, kept separate:

- creation_mode: FORKED | FRESH (provenance only).
- context_source: PROVIDER_INHERITED | DURABLE_CONTEXT_PACK |
  TRANSCRIPT_RECONSTRUCTION | MINIMAL_BOOTSTRAP.
- context_fidelity_requirement (policy semantic): INDEPENDENT |
  DURABLE_CONTEXT_SUFFICIENT | TRANSCRIPT_RECONSTRUCTION_REQUIRED |
  PROVIDER_INHERITANCE_REQUIRED.

FRESH + durable pack ≠ FORKED (provenance must never be relabeled). Worker
declares required fidelity; adapter reports capability facts
(supports_native_fork, transcript_export_available, …); the harness selects a
conforming strategy; none → NEEDS_HUMAN / DEFER, never silent degradation.
Sedimentation with only durable context does not conform (defer). Activation
safety (stable identity, preactivation eligibility, canonical bind, lease,
claimed bootstrap, BootstrapReceipt) is not relaxed by any fallback.

## Unified principle

Callers express intent and requirements; authoritative layers create identity
and commit truth; adapters report capability and evidence — none may
fabricate authority or semantic equivalence.

## Implementation mapping

- W11a: reducer three-identity model + settle signature + settle-evidence
  glue (this slice).
- W11b: delivery runtime lockstep (reducer-driven claim permit + settle from
  journal facts).
- W12: child-worker context axes + spawn capability gating.
