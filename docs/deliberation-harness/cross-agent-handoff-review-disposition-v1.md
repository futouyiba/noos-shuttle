# Cross-Agent Handoff v0 Review Disposition

> Review target: `12fccf6024b10b1cc2c9eeece6c56c5bca2e5645`
>
> Independent review: PR #14 comment `5682666985`
>
> Authority baseline: `futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1`
>
> This disposition drives `cross-agent-handoff-escalation-contract-v1.md`.

## Overall verdict

`REQUEST_CHANGES` is accepted. The architecture is retained, but the revision removes one duplicated control plane and tightens authority/resolution semantics.

The resulting model is:

```text
active bounded operation
→ immutable durable Escalation
→ immutable HandoffPacket projection
→ role-aware routing
→ immutable result record/projection
→ deterministic ResolutionPolicy validation
→ crash-consistent ResolutionRecord + Escalation RESOLVED
→ same bounded operation becomes eligible to continue
```

There is no separate durable `ExecutionControl=WAIT_*` state machine. Blocking is derived from OPEN blocking escalations plus existing LogicalControl.

---

## F1 — ACCEPT WITH STRONGER CORRECTION

The review is correct that `resume_authority_ref` was unenforceable.

Rejected detail: a simple rule such as "the returned revision must not predate the escalation's authority era" is insufficient. A newer ref may still be unrelated, on the wrong authority branch, or outside the requested scope.

V1 correction:

1. `HandoffResult` is advisory until `ResolutionPolicy` validates it.
2. Automatic resolution requires deterministic checks of:
   - result identity/fingerprint and exact `escalation_id` binding;
   - every required ref resolves to an immutable durable artifact/observation;
   - authority type/role is permitted for the escalation kind;
   - target/scope/question compatibility;
   - currentness through the canonical authority pointer / explicit supersession chain, not timestamp ordering;
   - policy-specific sufficiency for the exact question.
3. Successful validation creates immutable `EscalationResolutionRecord` containing the winning result, exact authority/evidence basis, validation evidence, policy version, and actor.
4. The ResolutionRecord and `Escalation.status: OPEN→RESOLVED` commit in one crash-consistent local transaction / reducer-equivalent authority boundary.
5. A ref-shaped string or ordinary chat reply never grants resume authority.

Formula remains: `LLM proposes; Policy authorizes; NOOS records.`

---

## F2 — ACCEPT

`Escalation` semantic content and `HandoffResult` content are immutable after creation.

Allowed mutation is limited to explicit lifecycle metadata through authorized transitions.

Evidence→Design conversion is not an in-place `kind` edit:

```text
E11 NEEDS_EVIDENCE
→ evidence falsifies assumption
→ create E12 NEEDS_DESIGN
   supersedes_escalation_id = E11
→ E11 WITHDRAWN(reason = SUPERSEDED, superseded_by = E12)
```

This preserves the exact original question/provenance.

---

## F3 — ACCEPT WITH SCOPE DISTINCTION

`Escalation` is a routing/coordination object; `PendingHumanGate` remains the approval instrument.

For `NEEDS_HUMAN`:

- if the requested Human action authorizes a Proposal, reserved state transition, external write, promotion, or other action already governed by AuthorizationResult/PendingHumanGate, the Escalation MUST reference `gate_id`; Human approval occurs only through that existing path;
- if the request is non-authorization Human input/evidence (for example selecting a product direction or performing a provider/account step), the Escalation may resolve from an immutable Human result/evidence record without inventing a PendingHumanGate;
- secrets/credentials must not be copied into GitHub handoff artifacts.

Thus: `Escalation = route the authority request`; `PendingHumanGate = durable approval instrument when approval semantics apply`.

---

## F4 — ACCEPT, BUT DELETE THE DUPLICATED CONTROL STATE

The review correctly identifies split-brain risk between new `ExecutionControl` and existing `LogicalControl`.

Rather than transactionally synchronizing two control enums, V1 removes durable `ExecutionControl=RUN/WAIT_*`.

The operation-blocking rule is derived:

```text
operation may continue
IFF
LogicalControl == CONTINUE
AND no OPEN blocking Escalation references source_operation_ref
AND all ordinary operation/provider execution gates pass
```

UI/debug surfaces may project:

```text
WAIT(escalation_id, kind)
```

but that projection is not an independent authoritative state.

When `Escalation OPEN→RESOLVED` commits atomically with its ResolutionRecord, the blocker disappears by derivation. No separate WAIT→RUN transaction exists.

Multiple OPEN blocking escalations form a blocker set; resolution of one does not resume the operation while another remains OPEN.

---

## F5 — ACCEPT WITH CONFLICT POLICY REFINEMENT

V1 adds these durability rules:

1. persist the immutable Escalation identity/record before any GitHub/browser/provider post;
2. compile/persist packet identity before transport attempt;
3. GitHub comments are mutable transport surfaces, not immutable authority records;
4. on observation, capture an immutable SourceRef/result snapshot + content fingerprint; later comment edits create a new observation and cannot rewrite an existing resolution basis;
5. commit ResolutionRecord + Escalation RESOLVED atomically;
6. resolution uses CAS / expected OPEN revision so at most one result becomes the winning resolution.

Competing result policy:

- distinct results may coexist as immutable candidates;
- a single sufficient candidate may win only through the atomic ResolutionPolicy commit;
- if conflicting sufficient candidates are known before commit, fail closed to the relevant higher authority/Human rather than choose by arrival time;
- results arriving after RESOLVED cannot rewrite that resolution; a material contradiction opens a new escalation/review instead of mutating the old one.

So V1 does not define semantic merge, but it does define deterministic authority behavior.

---

## F6 — PARTIAL ACCEPT

Accepted: the old `HandoffResult.status` enum duplicated escalation kinds and risked a second result ledger.

Rejected detail: `SUFFICIENT` must not be a destination-authored result status. Sufficiency is decided by source-side `ResolutionPolicy`, not by the answering agent.

V1 result completion status is descriptive only:

```text
COMPLETE
PARTIAL
BLOCKED
FAILED_SAFE
```

`NEEDS_DESIGN / NEEDS_EVIDENCE / NEEDS_HUMAN` are represented by a new/superseding Escalation, usually referenced in `recommended_next_action`.

Unification rule:

- when the destination is a Harness-managed child/logical thread that already produces `WorkerResult`, that WorkerResult is the canonical result identity; the cross-agent resolution payload is carried by/referenced from that WorkerResult and normal ResultDelivery semantics apply;
- do not mint a second independent HandoffResult identity for the same output;
- when the destination is an external/non-worker surface without WorkerResult, NOOS may persist an immutable `HandoffResult` observation as the canonical result record.

Therefore `HandoffResult` is a transport-neutral result shape/projection, not necessarily a separate ledger object.

---

## F7 — ACCEPT

`HandoffPacket` gains explicit lineage:

```text
packet_revision
supersedes_packet_id?
```

A new packet never rewrites what a destination previously received.

---

## F8 — ACCEPT

V0 explicitly allows indefinite visible wait under Human oversight; no automatic timeout escalation is required.

`WITHDRAWN` may be initiated only by the owner/authority of the source operation or by an authorized supersession transition.

Withdrawal does NOT automatically make the source operation runnable. After withdrawal the source still requires one of:

- a superseding OPEN escalation;
- explicit scope/operation re-authorization;
- cancellation/supersession of the source operation.

Automatic timeout→NEEDS_HUMAN policy is deferred.

---

## Consequence for #10

#10 may proceed only with mailbox/identity/dedup/provenance mechanics after this revision is independently re-reviewed.

Until the revised resolution policy is approved, #10/#11/#12 MUST NOT implement automatic resume from a GitHub comment or ordinary ChatGPT answer.

Human-mediated resume remains the safe prototype boundary.
