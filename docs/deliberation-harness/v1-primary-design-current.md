# Deliberation Harness V1 — Current

> Current phase record; authoritative mechanics remain in the contracts and the final E2E confirmation.

## Phase

V1 is `READY_FOR_BOUNDED_V1_IMPLEMENTATION_EXPERIMENT`.

The corrected E2E pass closed the five known implementation-blocking design seams. `Known implementation-blocking V1 Design GAP = 0` means those identified seams have closure contracts and review evidence; it does not claim that implementation has no bugs or unknown risks.

The working mode is now **implementation-led learning**. New design work reopens only when a bounded slice supplies concrete evidence that a contract assumption is false, contracts cannot be implemented together, a semantic/authority choice is unresolved, or a materially different product tradeoff is required.

## Next slices

1. **Slice 0:** browser observation and carrier/binding experiment (identity stability, reload/duplicate-tab behavior, and READY/GENERATING/STABILIZING evidence).
2. **Slice 1:** Human-triggered GO with durable submission, atomic dispatch claim, acceptance observation, and conservative reconciliation.

Later worker, rollover, and child-result delivery slices should follow evidence from these experiments.

## Operating posture

Keep the Primary Design conversation scarce: use it for genuine cross-contract decisions and authority questions. Use bounded implementation and review workers for slices, evidence, and curation. Do not expand V1 design merely to postpone provider/runtime learning.

See [V1 Primary Design Companion / Decision Memory](v1-primary-design-companion-decision-memory-v0.md) for durable rationale, rejected alternatives, assumptions, and reopen triggers.
