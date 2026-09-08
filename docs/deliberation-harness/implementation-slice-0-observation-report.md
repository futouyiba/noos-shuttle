# Slice 0 Observation Report

## 1. Exact inputs / design snapshot

Implementation base: `39019ff7292361ec6087329aadb3600c525c21f8`; first implementation: `be8ca62e59171704887e227e1caa1ec40b9eac57`.
Design authority: `futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1`.
Inputs: browser-runtime-observation-contract-v0, logical-thread-conversation-carrier-binding-contract-v0, current-conversation-binding-contract-v1; local Current, Companion, Final E2E readiness and page-context-events.
This 2026-09-08 revision corrects overstatements in the first report: a predicate alone was not integrated stale-event fencing, two calls were not a timed quiet window, and the original mutation/route probes were constants.

## 2. Existing implementation inventory

| Capability | Assessment | Slice action |
| --- | --- | --- |
| Content page-context watcher | Existing route polling and UI reset; isolated-world history wrapping alone is insufficient | Reuse current-route sampling and polling |
| Capture-specific mutation/stop detection | Useful but previously separate from observation | Add assistant-output mutation sampling |
| Background message handler | Provides trusted sender tab metadata | Add read-only carrier handshake |
| pagehide | Cancelled capture waits only | Latch SUSPENDED; pageshow explicitly resumes |
| Logical binding/leases | Not implemented | Remain outside Slice 0 |

## 3. Changes implemented

Timed 2-second quiet window; reset on identity/route change, generation, missing composer or invalid probes. Duplicate/out-of-order timestamps do not advance the ledger. Generation remains observable when conversation identity is unavailable. Assistant text changes are sampled through a main-region MutationObserver plus existing polling; only metadata is emitted, not message text. Message counts no longer double-count articles.

The background handshake supplies `browser-tab:<tabId>`, a transient browser-session carrier locator. Separate `executionInstanceRef` identifies the content observer. If the handshake fails, the random carrier ref is only an execution-local placeholder, not a confirmed tab identity. Window movement does not redefine conversation identity. A browser restart may reuse tab IDs: these refs are not durable and must not be compared across browser sessions.

Callbacks synchronously resample the current URL/DOM; no external page-context event payload writes the ledger. `acceptEvent` is a helper only, not proof of a cross-process fenced registry. No canonical binding, lease, GO, submission or reducer was added.

## 4. Observation model

Carrier/execution instance, provider origin, route path, optional provider conversation ID, resolved/unresolved identity, composer presence/interactivity, stop control, assistant text activity, role-specific counts, error probe, route stability, observation time, source epoch, quiet start and operational state.

The 2-second threshold is experimental. Visible provider error surfaces outside message bodies are resampled for 15 seconds in RECOVERING before BROKEN; no automatic reload is performed. Replacing the main region reattaches the mutation observer on the next poll. Route identity still comes from existing heuristic URL patterns. READY is local operational evidence, never authorization.

## 5. Automated tests

Commands:

```sh
npm run typecheck
NOOS_TEST_BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npx vitest run tests/runtime-observer.test.ts tests/content-ui-smoke.test.ts tests/background-feishu-actions.test.ts
npm run build
git diff --check
```

Nine observer unit cases cover timed stabilization, duplicate/out-of-order observations, C1→C2 reset, missing identity, missing boolean signal, generation before identity, suspension/resume, same-tab reload instance fencing and bounded error resampling.
Browser fixtures cover existing UI flows plus actual emitted observation transitions after assistant output insertion and SPA navigation. Fixture evidence is not ChatGPT provider verification.
The continuation ran the observer suite, 17 browser tests (including the new state regression), and one existing background test with installed Chrome. No provider content is embedded in these fixtures. The browser-download attempt stalled and was stopped once installed Chrome proved usable.

## 6. Real provider experiments

2026-09-08: launched installed Chrome via Playwright in a fresh isolated headless context and navigated to `https://chatgpt.com/`. Navigation reached a Cloudflare challenge URL; composer count was zero. No authenticated conversation was available and no prompt was sent. This proves only that this attempted environment could not reach a usable provider surface. It says nothing about identity establishment or generation timing.

## 7. Scenario-by-scenario results

| Scenario | Automated evidence | Real provider result |
| --- | --- | --- |
| Existing conversation attach | Fixture can reach READY after stabilization | NOT_VERIFIED |
| Generation | Output rendering triggers GENERATING and quiet recovery | NOT_VERIFIED |
| Reload | New ledger can resolve same ID | NOT_VERIFIED |
| C1 → C2 in same tab | Browser regression checks non-READY on change and recovery | NOT_VERIFIED |
| Duplicate tab | Separate ledgers can share conversation ID; sender handshake uses distinct tab locators | NOT_VERIFIED |
| New conversation identity | Missing identity is represented; generation can still be observed | NOT_VERIFIED |
| Restart/reattach | Ledger reconstruction and suspension tested; handshake can be served by restarted worker | NOT_VERIFIED |

Human reproduction: load the built `dist/` extension, reload an authenticated ChatGPT conversation, open page DevTools and run:

```js
window.noosSlice0 = [];
window.addEventListener("noos:runtime-observation", e => window.noosSlice0.push(e.detail));
```

Wait for READY; send a short ordinary message and preserve the trace with `copy(JSON.stringify(window.noosSlice0, null, 2))`. Navigate C1→C2 and repeat. Export before reload, then reinstall the listener after reload; compare carrier, execution instance and provider ref. Duplicate the tab and capture both traces. Stop the extension service worker in extension diagnostics and reload a page to repeat the handshake; reload the extension and page for a fresh content instance. Record exact browser/extension versions and wall-clock times.

For a new conversation, capture before any message, manually submit once, and record the first resolved provider ref relative to generation and route change. Inspect whether any documented, technically enforced non-executable establishment primitive exists; absence in a DOM trace alone cannot prove none exists. Do not use a prompt as quarantine. Human-assisted adoption may be required.

## 8. New provider facts

No authenticated ChatGPT behavior verified. The challenge encountered by the fresh automated browser is environment evidence only.

## 9. Contract assumptions validated

Automated evidence supports identity-field separation and conservative local timed stabilization. It does not validate provider identity durability, canonical lease selection, transport-only establishment, or future dispatch safety.

## 10. Contract mismatches / unresolved evidence

No demonstrated design contradiction. Remaining adapter limitations include polling latency, provider-specific selector coverage, and rendering activity that may conservatively resemble generation. A background-wide durable observation registry and browser restart correlation are not present. No external asynchronous observation messages are consumed in this slice; callbacks resample current state. Do not treat the helper predicate as integrated cross-process stale-message protection for a future registry.

## 11. Slice 0 acceptance assessment

| Criterion | Assessment |
| --- | --- |
| 1 Same conversation after reload | NOT_VERIFIED on real provider |
| 2 Same carrier C1→C2 | Automated browser evidence; NOT_VERIFIED on real provider |
| 3 Two carriers / one conversation | Unit representation; NOT_VERIFIED on real provider |
| 4 Core runtime transitions | Unit/browser fixture evidence; NOT_VERIFIED on real provider |
| 5 Observer restart | Unit reconstruction only; NOT_VERIFIED in extension lifecycle |
| 6 New conversation identity timing | NOT_VERIFIED |
| 7 No semantic identity from carrier/DOM | PASS by code inspection; refs remain observations |
| 8 Old observation rejection | Local timestamp/epoch tests only; cross-process lifecycle NOT_VERIFIED |
| 9 No Slice 1 semantics | PASS by code inspection |

The first report's unconditional PASS labels were too broad. Slice 0 has not passed acceptance; real extension lifecycle and provider evidence remain necessary. Current verdict: `SLICE_0_PARTIAL_PROVIDER_VERIFICATION`, limited to the implemented local observation surface and explicitly pending browser-assisted lifecycle scenarios.

## 12. Recommendation for Slice 1

Do not start Slice 1. Complete browser lifecycle verification and record authenticated provider traces first. If these reveal missing adapter behavior, continue Slice 0 implementation before conformance review. Future registry consumers must apply instance/epoch fences and must not infer authority from these observations.
