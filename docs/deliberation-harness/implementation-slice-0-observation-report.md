# Slice 0 Observation Report — Issue #1

## Verdict and scope

`SLICE_0_PARTIAL_PROVIDER_VERIFICATION`

This 2026-09-09 continuation implements and tests the browser observation scope of [Issue #1](https://github.com/futouyiba/noos-shuttle/issues/1). Real ChatGPT access returned HTTP 403 with no visible composer in a fresh browser. Authenticated provider scenarios remain **NOT_VERIFIED**. Fixture success must not be promoted to provider success. Slice 1 was not started; independent conformance/evidence review is still required before Issue closure.

## Exact authority and implementation inputs

Authority order: authoritative contracts > Final E2E > Current > Companion/Decision Memory.

Design authority is `futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1`, read through the GitHub contents API at that exact revision:

- `docs/deliberation-harness/browser-runtime-observation-contract-v0.md`
- `docs/deliberation-harness/logical-thread-conversation-carrier-binding-contract-v0.md`
- `docs/deliberation-harness/current-conversation-binding-contract-v1.md`

Current/reasoning input snapshot: `noos-shuttle@39019ff7292361ec6087329aadb3600c525c21f8`:

- `docs/deliberation-harness/v1-final-e2e-readiness-confirmation.md`
- `docs/deliberation-harness/v1-primary-design-current.md`
- `docs/deliberation-harness/v1-primary-design-companion-decision-memory-v0.md`
- `docs/noos-shuttle-page-context-events.md`

These four files are unchanged between the pinned snapshot and the implementation base. The clean, fetched main baseline for this continuation was `06855cd97f0a0068b0eceb8d6f540bb76891fba4`, already containing `be8ca62e59171704887e227e1caa1ec40b9eac57` and the first hardening/report correction. The PR records the exact submitted revision. No other branch was merged and no active handoff or runtime Vault was consumed: the GitHub Issue is the work envelope.

## Existing implementation inventory and reuse

| Existing path | Responsibility and reuse |
| --- | --- |
| `src/background/service-worker.ts` | MV3 message handler; existing read-only handshake derives `browser-tab:<tabId>` from trusted top-frame sender metadata. No background mutation added. |
| `src/content/index.ts` | Existing content bootstrap, page-context snapshot, history/popstate hooks, 1-second route fallback, pagehide/pageshow and UI reset. Extended this path rather than replacing the browser adapter. |
| `src/content/chatgpt-dom.ts` | Existing generation-control probing reused alongside explicit visible stop-control and assistant-output evidence. |
| `src/content/runtime-observer.ts` | Existing normalization, timed quiet window, source epoch, suspension and local observation ledger hardened. |
| `tests/content-ui-smoke.test.ts` | Existing Vite + Playwright fixtures extended, with no new testing framework. |
| Page bridge / debug | Isolated-world history wrapping cannot see every main-world route change; polling resamples the live URL. `noos:runtime-observation` is a metadata-only output, not a trusted input or canonical registry. |

## Changes in this continuation

- Initial static assistant content establishes a baseline instead of producing a false GENERATING event. Initial observation is published immediately.
- Assistant subtree structural mutations and replacement of the entire observed `main` root reset the generation/quiet heartbeat even when text is unchanged. This conservatively includes provider post-processing and remounts; initial static attach still establishes a baseline.
- Only the known ChatGPT main composer (`#prompt-textarea`) contributes readiness evidence. Read-only, disabled, inert, non-editable, hidden or missing main composers cannot be replaced by historical editors or other textboxes. Unknown provider markup stays non-READY until supported by adapter evidence.
- Missing/malformed identity probes cannot crash normalization or yield READY.
- Two callbacks in the same millisecond can invalidate READY on changed route/generation evidence; they cannot advance the quiet timer. Older timestamps remain rejected.
- Added `conversationIdentitySource` (`provider-route` / `unavailable`) and `carrierIdentityState` (`execution-local` / `browser-tab`). Failed handshakes remain explicitly provisional and retry at most once per five seconds while unattached.
- Debug events receive a copy, so listeners cannot mutate ledger state through event detail.
- Added a bounded, reproducible real-extension fixture experiment and a separate provider access probe. No prompt is sent by either script mode. CDP is used only by the experiment to stop/check the extension worker, never as a runtime dependency or provider network interception mechanism.

## Observation model and limits

`Browser Carrier != Provider Conversation != Logical Thread`.

An observation includes provider origin, route path, optional route-extracted provider conversation ref, identity source/state, transient carrier locator, content execution instance, composer presence/interactivity, stop/generation evidence, assistant-output heartbeat, role-specific message counts, visible error evidence, timestamp, source epoch, quiet/error start and runtime state.

`provider + providerConversationRef` identifies the observed provider conversation within this adapter. The bare ref is not a globally unique Logical Thread ID. No title is used as identity. Carrier refs are transient browser-session locators; tab IDs may be reused across browser restarts. A random execution-local ref is not proof of a distinct browser tab. Confirmed duplicate-tab evidence must use successful sender handshakes.

READY requires resolved identity, stable route, interactive composer, no generation/error evidence and a continuous two-second quiet window. Route stability itself initially takes two seconds. A one-second assistant activity heartbeat precedes the quiet window. These are experimental thresholds, not provider guarantees. Missing identity stays ATTACHING unless positive generation is observed. Visible provider errors remain RECOVERING for 15 seconds before BROKEN; this is bounded resampling, not automatic reload. Pagehide latches SUSPENDED until pageshow resumes observation.

Route/DOM callbacks resample the current page synchronously. No external asynchronous observation payload is applied to a registry. `acceptEvent` is a local identity/epoch predicate, not an integrated durable fence. Debug events can be forged by page code; they are suitable for controlled experiments only and must not authorize future actuation. The deliberate forged event in the fixture trace is followed by a fresh C2 observation proving that it did not overwrite the ledger.

Remaining limitations: heuristic route/selectors; up to one polling interval before main-world navigation is observed; post-processing can conservatively resemble generation; same-URL account/content changes can escape identity detection; no durable browser-restart correlation, canonical binding, lease, or dispatch authority. Reattaching after extension reload uses a page reload; hot reinjection into an existing healthy UI is not claimed as a supported independent observer replacement mechanism.

## Automated verification

Executed from repository root:

```sh
npm run typecheck
NOOS_TEST_BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm test
NOOS_TEST_BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npx vitest run tests/content-ui-smoke.test.ts
npx vitest run --exclude tests/content-ui-smoke.test.ts
npm run build
node --check scripts/slice-0-observation-experiment.mjs
git diff --check
```

Before independent review, the full suite passed **88 tests in 14 files** on `102750c`. After the two review fixes, the content browser suite passed **21 tests**, and the other 13 test files passed **69 tests**, for **90 verified tests** on the corrected tree. Typecheck and extension build passed. Observer tests cover timed state transitions, malformed/missing probes, unresolved generation, same-millisecond changes, older/duplicate observations, source changes, duplicate representation, suspension, error recovery and execution reconstruction. Background tests exercise real handler registration with trusted sender fixtures, duplicate tabs, worker-module reconstruction, and rejection of missing-tab/subframe attachment. Browser tests cover static attach, structural output activity, route changes, read-only composer, debug-copy isolation, failed-handshake retry, decoy editors beside a blocked/missing main composer, and repeated identical-content root replacement.

The initial read-only test failed because the existing fixture uses contenteditable rather than textarea; the test now explicitly replaces that composer with a read-only textarea and passed. This was test setup, not evidence about ChatGPT.

## Reproducible browser experiments

```sh
npx playwright install chromium
npm run build
node scripts/slice-0-observation-experiment.mjs
node scripts/slice-0-observation-experiment.mjs --provider
```

The fixture uses Chrome for Testing 147.0.7727.15, a real unpacked MV3 extension version 0.1.6, an isolated temporary profile and fulfilled ChatGPT-shaped pages. A dead proxy blocks unrelated Hub/network activity. It records no user content. Results and transition traces are written under `.tmp/slice-0/`; reviewed copies accompany this report under `evidence/issue-1-*.json`.

Ordinary installed Chrome 151.0.7922.173 did not load the command-line extension (no worker after ten seconds). Installing the Playwright browser resolved this environment constraint. The first worker-stop probe used target closure without a confirmed stopped lifecycle and was rejected as evidence; the final experiment uses the ServiceWorker lifecycle domain and requires an explicit stopped event, a subsequent running event and loss of a volatile JavaScript marker after reattach. The CDP target locator can remain unchanged across worker restart and is not execution identity.

The separate provider probe uses a fresh profile without fixtures, credentials or existing browser state. At `2026-09-09T02:34:34.247Z`, Chrome for Testing received **HTTP 403**, title `请稍候…`, route `/`, **zero visible composers**. An earlier installed-Chrome probe at `2026-09-09T02:29:32.963Z` produced the same status/title/composer count. This is provider-access/environment evidence only, not identity or execution behavior.

## Required scenarios

| Scenario | Automated / real-extension fixture evidence | Authenticated ChatGPT |
| --- | --- | --- |
| 1 Existing attach | Route identity; ATTACHING → STABILIZING → READY; no fabricated GENERATING on static attach | NOT_VERIFIED |
| 2 Generation | READY → GENERATING → STABILIZING → READY with stop control and output mutation; structural same-text mutation also invalidates READY | NOT_VERIFIED |
| 3 Reload | Same sender carrier and conversation ref; different content execution instance; quiet window rebuilt | NOT_VERIFIED |
| 4 Same-tab C1 → C2 | Same carrier, new ref/epoch; first new-route state non-READY; fresh sampling after forged old debug event remains C2 | NOT_VERIFIED |
| 5 Duplicate tab | Distinct actual sender tab refs, equal provider/ref pair | NOT_VERIFIED |
| 6 New identity | Fixture represents unresolved identity, generation while unresolved and later route identity; fixture sequence is not provider timing evidence | NOT_VERIFIED |
| 7 Restart/reattach | Worker stop/restart plus page reattach exercised by experiment; module reconstruction and pagehide/pageshow ledger behavior covered by tests | NOT_VERIFIED on provider; extension reload and browser restart remain manual |

Read each fixture PASS only within the mock-provider boundary; raw recorded results are in the evidence JSON.

## Human-assisted steps still required

Use an authenticated ChatGPT tab with the reviewed extension build. Install this page DevTools listener before each scenario and before first message on a new conversation:

```js
window.noosSlice0 = [];
window.addEventListener("noos:runtime-observation", e => {
  window.noosSlice0.push(JSON.parse(JSON.stringify(e.detail)));
});
// After the scenario:
copy(JSON.stringify(window.noosSlice0, null, 2));
```

1. **Existing C1:** wait for READY and retain route/ref source and transition timestamps. Record browser/extension version and wall-clock time.
2. **Real generation:** manually send one ordinary short message; record stop control, composer interactivity, last output activity and the full READY → GENERATING → STABILIZING → READY trace. Identify any premature READY or contradictory probes.
3. **Reload C1:** export before reload, reload and reinstall the listener, then compare the same provider ref/carrier with a new execution instance. Initial events may precede the manual listener; use a DevTools-preserved/init capture for a complete attach trace.
4. **C1 → C2 in one tab:** navigate via the actual provider UI, retain a trace before and after, and verify increasing source epoch, non-READY during transition and no later old-ref observation from the adapter.
5. **Duplicate C2:** duplicate the tab, capture both, and require `carrierIdentityState=browser-tab`, different carrier refs and equal provider/ref pair. No lease is issued.
6. **New conversation:** record the pre-message route/ref, manually send once and timestamp first stable ref versus generation/Agent executability and URL transition. Verify candidate IDENTITY_FIRST or transport-only establishment through actual capability evidence; lack of a ref in one DOM trace does not prove no primitive exists. A normal “do not use tools” prompt is not quarantine. If neither safe mechanism is available, Human-assisted adoption is the valid fallback; no automated adoption was implemented.
7. **Restarts:** stop the worker using extension diagnostics and reattach/reload; separately reload the extension and page; then test browser restart/reopen if needed. Reconstruct provider identity without treating reused tab IDs or old execution instances as durable authority.

Attach sanitized traces and per-scenario PASS/FAIL/NOT_VERIFIED findings to Issue #1 or its PR for independent review. No private conversation text is needed in the observation evidence.

## Findings and classification

| Class | Expected / observed; reproduction and evidence | Implementation consequence | Design consequence |
| --- | --- | --- | --- |
| IMPLEMENTATION_BUG | Static attach should not imply activity; previous route initialization set mutation time to now. Static attach fixture reproduced a GENERATING event without output changes. | Baseline without heartbeat; regression asserts no initial GENERATING. | None. |
| IMPLEMENTATION_BUG | READY requires interactive composer; previous checks allowed read-only textarea. Reproduce with readOnly=true after stable route. | Expanded negative interactivity checks; browser regression. | None. |
| IMPLEMENTATION_BUG | Post-processing must restart quiet; same-text subtree replacement was invisible to text comparison. | Mutation callback records structural activity; browser regression. | None. |
| IMPLEMENTATION_BUG | Fresh contradictory evidence must invalidate READY; equal-millisecond samples were dropped. | Accept same-time evidence without advancing quiet; unit regression covers route and generation. | None. |
| IMPLEMENTATION_DETAIL | Handshake failure is not proof of tab identity; malformed probes/debug listeners must not corrupt the ledger. | Explicit provenance, read-only retry, validation and copied output; unit/browser tests. | None. |
| IMPLEMENTATION_DETAIL | Real provider page required for semantic timing evidence; both fresh-browser probes returned HTTP 403/no composer. Reproduce with `--provider`; evidence JSON. | Mark provider scenarios NOT_VERIFIED and supply manual steps. | No demonstrated contract contradiction. |

No new authenticated provider facts were established. No evidence-backed CONTRACT_MISMATCH or PRODUCT_TRADEOFF requires reopening Primary Design. Automated evidence validates observation identity separation, conservative local stabilization and reconstructible runtime attachment within the tested fixture boundaries, not provider durability, safe preactivation or future dispatch safety.

## Independent review corrections

An independent reviewer, starting from Issue/authority inputs without the implementation conversation, reviewed exact commit `102750c8c9ff5775ce46064398c58279a60c4a1a` and returned **REQUEST_CHANGES** with two P2 findings. The [full first-round review](https://github.com/futouyiba/noos-shuttle/pull/2#issuecomment-5595758986) is preserved in the PR.

- A leading historical textarea could be chosen instead of a read-only main composer, falsely preserving READY. The adapter now uses only the known main-composer marker; absent or unsupported markup remains non-READY. The new regression covers read-only and missing main composer with another editable textarea present, then recovery.
- Replacing `main` with an identical clone every 100 ms preserved the old quiet window even across multiple polls. Root replacement now invalidates that window through the output heartbeat. The new regression requires non-READY throughout 4.5 seconds of repeated remounts, followed by STABILIZING and a new quiet window before READY.

Both were `IMPLEMENTATION_BUG`, not provider facts or contract mismatches. These are uncovered gaps in the previous Slice 0 hardening, not claims that the reviewed commit introduced both bugs. The original fixtures did not cover these cases; their PASS does not negate the counterexamples. The final independent review disposition is recorded against the exact corrected commit in the PR comments; it does not upgrade missing provider evidence or constitute a different GitHub account's native approval.

## Acceptance assessment and next boundary

| Issue criterion | Assessment |
| --- | --- |
| 1 Same provider conversation reload re-identification | PASS in extension fixture; NOT_VERIFIED on ChatGPT |
| 2 Same carrier C1 → C2 detection | PASS in extension fixture; NOT_VERIFIED on ChatGPT |
| 3 Two carriers / one conversation | PASS with real sender metadata in fixture; NOT_VERIFIED on ChatGPT |
| 4 Distinguishable READY / GENERATING / STABILIZING | PASS in unit/browser/extension fixtures; NOT_VERIFIED on ChatGPT |
| 5 Observer restart reconstruction | Tested worker/page reattach in extension fixture; remaining provider/extension reload steps above |
| 6 New-conversation stable identity timing | NOT_VERIFIED; no safe establishment claim |
| 7 No tabId / title / single selector as semantic thread identity | PASS by implementation inspection; no Logical Thread mapping introduced |
| 8 Stale page/route observations cannot overwrite newer route | PASS for current synchronous sampling/ledger boundary; debug stream remains untrusted and no cross-process registry is claimed |
| 9 No Slice 1 semantics | PASS by diff review |

Recommendation: obtain the missing authenticated evidence and independent conformance review before treating Slice 0 as provider-validated or closing Issue #1. Do not start Slice 1 as part of this work. No automated GO, SubmissionOperation, reducer, canonical binding mutation, actuation lease, rollover, workers, result delivery, Freeze or Promote behavior was added.
