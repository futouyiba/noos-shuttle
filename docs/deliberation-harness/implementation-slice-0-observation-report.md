# Slice 0 Observation Report

## 1. Exact inputs / design snapshot

- Implementation repository: `futouyiba/noos-shuttle`, base observed at the working tree before this slice.
- Design snapshot: `futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1`.
- Direct contracts read: Browser Runtime Observation v0, Logical Thread / Provider Conversation / Browser Carrier Binding v0, Current Conversation Binding v1.
- Local implementation context read: `v1-primary-design-current.md`, `v1-primary-design-companion-decision-memory-v0.md`, `v1-final-e2e-readiness-confirmation.md`, and `noos-shuttle-page-context-events.md`.

## 2. Existing implementation inventory

| Existing capability | Reliable enough? | Missing for Slice 0 | Action |
| --- | --- | --- | --- |
| SPA route/page-context watcher | Yes for local reset decisions | No carrier observation record | Reused and connected to ledger |
| Heuristic provider conversation ID from URL | ChatGPT-focused; not universal | Explicit resolved/unresolved state | Normalized as provider identity evidence |
| Generation stop-control detection | Useful strong signal | Multi-signal runtime state | Reused as a strong probe |
| MutationObserver generation wait | Useful for capture flow | Reusable observation model | Kept in existing capture path; model accepts mutation probe |
| `pagehide` cancellation | Present | Recovery/suspension evidence | Emits SUSPENDED observation |
| Service-worker/background tab lifecycle | No durable Harness binding | Out of Slice 0 implementation scope | Reported as human/runtime follow-up |

## 3. Changes implemented

- Added `src/content/runtime-observer.ts` with a provider-neutral probe snapshot, normalized `CarrierObservation`, conservative state derivation, source epoch fencing, and a restart-safe (in-memory) observation ledger.
- Connected the ledger to the existing page-context watcher. Runtime observations are emitted as `noos:runtime-observation` debug events; this is observation only and does not mutate canonical Logical Thread or CurrentConversationBinding state.
- `pagehide` now records SUSPENDED after cancelling capture waits. Route/conversation changes increment `sourceEpoch`, preventing old page-instance events from being accepted.
- No SubmissionOperation, lease authority, automatic rollover, reducer, or Slice 1 semantics were added.

## 4. Observation model

The model distinguishes `carrierRef` (new runtime execution instance), `providerConversationRef` (provider route identity when resolved), and the absent Logical Thread identity. A carrier keeps its ref across SPA route changes but receives a new source epoch; a page reload creates a new ledger/carrier instance while the provider conversation can resolve to the same ref.

State derivation is conservative: provider errors are `BROKEN`; missing identity or unstable route is `ATTACHING`; stop-control or output mutation is `GENERATING`; contradictory/non-interactive composer evidence is `STABILIZING`; only a subsequent quiet observation promotes to `READY`.

## 5. Automated tests

`tests/runtime-observer.test.ts` covers quiet-window promotion, generation, missing identity, route/conversation changes, duplicate carriers, stale epoch rejection, restart reconstruction, malformed/contradictory signals, and provider errors.

Results: `npm run typecheck` PASS; focused runtime-observer tests PASS. Existing Playwright smoke tests could not launch because the local Chromium executable is not installed (`npx playwright install` was not run).

## 6. Real provider experiments

No independent real ChatGPT Web session was available in this execution environment. The implementation emits inspectable runtime events for a human-assisted run, but no provider behavior is claimed as verified from synthetic DOM tests.

## 7. Scenario-by-scenario results

| Scenario | Result | Evidence / remaining action |
| --- | --- | --- |
| 1 Existing conversation attach | CODE_READY_FOR_EXPERIMENT | URL identity, attach and stabilization are instrumented; human must verify timing on ChatGPT Web. |
| 2 Generation | CODE_READY_FOR_EXPERIMENT | Stop-control and mutation probes are modeled; human must capture READY → GENERATING → STABILIZING → READY traces. |
| 3 Reload | CODE_READY_FOR_EXPERIMENT | New content-script ledger/carrier is created; same provider ref can be re-observed. Human verification required. |
| 4 Same-tab C1 → C2 | AUTOMATED_UNIT_VERIFIED | Route/conversation change increments source epoch; stale prior observation is rejected. |
| 5 Duplicate tab | AUTOMATED_UNIT_VERIFIED | Independent ledgers yield distinct carrier refs with the same provider conversation ref. Lease selection remains Slice 1+. |
| 6 New conversation identity establishment | NOT_VERIFIED | Requires human ChatGPT Web experiment before first submit and during route establishment. |
| 7 Observer restart/reattach | CODE_READY_FOR_EXPERIMENT | New ledger reconstructs identity from current probes; service-worker restart needs browser-assisted verification. |

## 8. New provider facts

None asserted. Selector and route behavior remain implementation evidence, not provider facts, until a real run is recorded.

## 9. Contract assumptions validated

- Browser Carrier, Provider Conversation, and Logical Thread are represented separately.
- Runtime readiness is multi-signal and orthogonal to semantic control.
- Stale source epochs cannot overwrite a newer route/conversation observation.
- Duplicate carriers can be represented without inventing lease authority.

## 10. Contract mismatches / unresolved evidence

No contract mismatch found. Real-provider timing, new-conversation identity establishment, duplicate-tab behavior in ChatGPT Web, and service-worker restart recovery remain unverified rather than treated as PASS.

## 11. Slice 0 acceptance assessment

1. Same conversation reload re-identification — **NOT_VERIFIED** (code ready).
2. Same carrier C1 → C2 identity change — **PASS** (unit evidence).
3. Duplicate tabs as two carriers + one conversation — **PASS** (unit evidence).
4. READY / GENERATING / STABILIZING transition — **PASS** (deterministic unit evidence; provider timing unverified).
5. Observer restart reattach — **NOT_VERIFIED** (reconstruction unit evidence only).
6. New conversation identity timing — **NOT_VERIFIED**.
7. No tabId/URL/DOM selector mistaken for semantic identity — **PASS**.
8. Stale old observation cannot overwrite new route — **PASS**.
9. No Slice 1 semantics — **PASS**.

## 12. Recommendation for Slice 1

Remain at `SLICE_0_PARTIAL_PROVIDER_VERIFICATION`. Run the human-assisted ChatGPT Web scenarios above, archive event traces, and only then begin Slice 1's durable binding/lease/submission work. Do not infer identity-establishment timing or provider stabilization thresholds from this report.
