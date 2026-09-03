# Deliberation Harness V1 — Primary Design Companion / Decision Memory

> Reasoning memory curated from the Primary Design sedimentation Candidate at exact source revision `1d8a638b8262e8391df5e3a25b10951e4b85d3f0`.
>
> This file is not an authoritative Contract. When wording or conclusions differ, the authoritative contracts and the final E2E readiness confirmation win. The current confirmation records the authoritative `futouyiba/noos_docs` snapshot separately; the Candidate's source revision is provenance only.

## Durable rationale

### Semantic state and Harness state have different owners

The Agent and durable documents own design meaning: current claims, rationale, rejected alternatives, evidence interpretation, and open questions. NOOS owns operational continuity: Work Item and Logical Thread identity, carrier/binding and lease generations, SubmissionOperation, worker lifecycle, routing, receipts, and recovery. Keeping one semantic brain avoids a second, conflicting interpretation layer in the control plane.

### Conversation is a replaceable carrier

Logical Thread, Provider Conversation, and Browser Carrier are distinct. This preserves semantic continuity across rollover, reload, duplicate tabs, service-worker restart, and provider context limits. A tab or provider conversation becomes a durable logical identity only if a future provider-native primitive offers stronger semantics and a deliberate mapping is chosen.

### One binding truth, separate readiness

`CurrentConversationBinding` answers which provider conversation is the current continuation carrier. Reverse lookup and presentation status are projections. Binding does not imply execution readiness: bootstrap receipt, READY carrier, canonical lease, Logical Control, and unresolved operations remain independent gates. This lets a committed rollover remain correct even if bootstrap later fails.

### Authority must be claimed at the reducer boundary

The check-then-click pattern is vulnerable to TOCTOU races. Dispatch claim, binding switch, and lease transfer must compete in the same atomic reducer authority boundary; runtime observations are evidence, not authority to begin actuation. `DISPATCHING`, `OBSERVED_ACCEPTED`, and `UNCERTAIN` continue to own unresolved execution side effects, so they block rollover/lease movement.

### Reuse transport identity and preserve semantic authority

Child-result delivery specializes `SubmissionOperation` rather than introducing a parallel protocol. `ResultDeliveryKey=(result_id,destination_logical_thread_id)` stays independent of binding generation because rollover changes the destination carrier, not the logical delivery. `INSERTED` and `COMPLETED` are transport/runtime facts; neither accepts review findings, mutates Candidate, or grants `CONTINUE`.

### Conservative execution and epistemic worker modes

Step Mode (explicit Human GO, one dispatch, observe/reconcile, stop at READY) bounds uncertainty while browser/provider behavior is learned. Sedimentation is FORKED to recover latent conversation reasoning; independent review is FRESH to preserve epistemic independence. Context inheritance follows the worker's purpose.

## Rejected alternatives

| Alternative | Why attractive | Counterexample / cost | Current direction | Reopen condition |
|---|---|---|---|---|
| NOOS as semantic supervisor / duplicate semantic truth | stronger automation and dashboards | semantic interpretation in the control plane creates authority ambiguity and a larger correctness surface | Agent-managed meaning; NOOS-managed operations | durable docs plus Agent reasoning repeatedly fail to preserve semantic continuity, or autonomous fan-in becomes a concrete requirement |
| Tab or Provider Conversation as Logical Thread identity | simple local mapping | reload, duplicate tabs, rollover, and provider limits break continuity and routing | Logical Thread owns continuity; conversations/tabs are carriers | provider-native durable thread semantics become available and materially better |
| `ACTIVE` means both current owner and executable-ready | fewer states | post-commit bootstrap failure and stale UI readiness become ambiguous | binding and readiness are separate | implementation proves the separation infeasible or too costly |
| Check binding/lease/READY, then click | easy adapter code | rollover can commit between check and actuation | atomic reducer dispatch claim and fence | evidence shows atomic authority cannot be implemented in the runtime |
| Prompt-only preactivation quarantine | works with ordinary Agent turn | prompt compliance cannot fence tools, connectors, or authority-bearing refs | IDENTITY_FIRST, technical transport-only quarantine, or Human-assisted adoption; otherwise fail closed | provider exposes a real technical quarantine primitive or a different safe establishment path |
| Separate ResultDelivery state machine | delivery has distinctive acknowledgements | duplicates recovery/fencing semantics and can diverge from SubmissionOperation | `DELIVER_CHILD_RESULT` specialization | existing operation cannot represent required delivery/recovery semantics |
| Delivery key includes binding generation | appears to version every attempt | `(result,g7)` and `(result,g8)` duplicate one logical return after rollover | key excludes carrier/generation | semantic identity of a result delivery itself changes (no current evidence) |
| Finish all design before implementation | feels safer | delays the dominant provider/runtime learning after readiness | bounded Slice 0/1 experiments | implementation evidence exposes a contract seam |
| Unconstrained GPT Work as parallel Primary Designer | broad exploration is fast | missing durable context produced the first false GAP report; authority becomes diffuse | bounded worker envelope with exact inputs, scope, authority, output, stop condition | deliberately open a new design exploration with explicit authority |

## Implementation assumptions and recall checklist

- Provider conversation identity can be observed and reconstructed reliably enough for binding; reload and duplicate tabs remain distinguishable.
- READY/GENERATING/STABILIZING and route changes can be inferred conservatively from real signals.
- Message-count/head/fingerprint evidence supports conservative reconciliation; ambiguous cases remain usable when paused for Human recovery.
- At least one safe activation/adoption workflow is practical; otherwise Human-assisted adoption is acceptable for the early slice.
- Step Mode friction is acceptable while it improves observability and bounds uncertainty.
- A worker bootstrap receives the correct authority-ranked refs, not merely some project context. The v0 dogfood failure showed that missing contracts cause internally reasonable but globally wrong GAP conclusions.

Return to Primary Design with facts, reproduction, affected contracts, options, and the reason a bounded worker cannot choose when any assumption materially fails. Do not reopen settled direction because an implementation shortcut is locally simpler.

## Omission pass additions

The Candidate's omission pass was supplemented with two durable reminders that are easy to lose when only contracts are read:

1. **Provenance is a correctness dimension.** A substantively correct review bound to an exact revision where the target file is absent is not valid governance evidence. Review packets must retain exact path, revision/blob where practical, dependency snapshot, and verdict scope.
2. **Runtime completion is layered.** Child `RESULT_READY`, parent insertion, parent turn completion, and semantic acceptance are separate events. Mechanical wait clearing must stop at the contract-defined runtime boundary and never infer semantic approval.

## Already durable / intentionally not duplicated

The following are already adequately expressed by the authoritative contracts and final E2E confirmation: canonical binding and reverse uniqueness; generation and lease fencing; preactivation eligibility; SubmissionOperation idempotency and reconciliation; child lifecycle and parent routing; ResultDeliveryKey/create-or-get/fingerprint invariants; exact frozen Review Target and Human Freeze/Promote authority; Current/Companion references; and the five former GAP closures. This file preserves why those rules matter, not their full mechanics.
