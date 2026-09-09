# Slice 0 — Authenticated ChatGPT Provider Verification (Issue #3)

## Verdict

`SLICE_0_PARTIAL_PROVIDER_VERIFICATION`

Authenticated real-provider runs are now completed for attach, ordinary generation, reload, same-tab navigation, duplicate tabs, extension reload/page reattach, and worker restart. New-conversation route/identity timing is measured, including a reproducible implementation bug fixed here. The remaining gap is capability evidence: this experiment cannot attest a provider-native transport-only/non-executable establishment primitive, or the precise server-side beginning of reasoning relative to identity allocation. Neither is inferred from output text or a “do not use tools” prompt. Keep Issues #1 and #3 open. Slice 1 was not started.

## Provenance and environment

- Work envelope: [Issue #3](https://github.com/futouyiba/noos-shuttle/issues/3), [Issue #1](https://github.com/futouyiba/noos-shuttle/issues/1), [PR #2](https://github.com/futouyiba/noos-shuttle/pull/2), including both reviewer comments, observation report and fixture/provider evidence.
- Original implementation tested: merge `b2de596c75fbfeabeb4373e9408b93f9569d30f4`; reviewed implementation `1f96c23a3672ada2e74c986f1f1861d2c0384836`.
- Design authority: `futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1`, browser-runtime-observation v0, logical-thread/conversation/carrier-binding v0, current-conversation-binding v1. Current, Companion, Final E2E and page-context events were also read.
- Chrome 151.0.7922.173, macOS, extension 0.1.6. Human logged into a dedicated persistent Chrome profile and selected an existing conversation. Its visible composer and persisted user/assistant messages were confirmed. No credentials or cookies were read or copied.
- The earlier claim that command-line launch had loaded the extension was incorrect. The actual extension inventory was empty. Loading the unpacked `dist` directory through Chrome's extensions UI, followed by restarting the dedicated profile without `--disable-extensions-except`, produced an ENABLED extension with the correct path. Page events and trusted browser-tab handshakes then worked.
- CDP on loopback was used by the external experiment for init listeners, UI interactions and worker diagnostics. No provider network interception/private API was used, and no CDP runtime dependency was added to Shuttle.
- Original merged-build traces: [issue-3-authenticated-provider.json](evidence/issue-3-authenticated-provider.json).
- Corrected-build traces, build SHA-256 and restart results: [issue-3-fixed-provider.json](evidence/issue-3-fixed-provider.json). The correction is the source/test delta in this PR; original evidence must not be mistaken for corrected-build evidence.
- UUIDs in exported artifacts are deterministic aliases, including execution-instance UUIDs. Carrier tab refs and timestamps remain intact; equality/inequality and WEB route prefixes are preserved. No private conversation text, titles, tokens or profile data is committed.

## Results

| Required scenario | Result | Evidence and limit |
| --- | --- | --- |
| 1 Existing attach | PASS | `traces.attach`: route-based identity and trusted browser-tab carrier; ATTACHING → GENERATING (initial provider rendering) → STABILIZING → READY. Hydration mutations conservatively resemble generation; no semantic inference. |
| 2 Real generation | PASS | `traces.generation`: ordinary follow-up on the new test conversation; exact collapsed sequence READY → GENERATING → STABILIZING → READY. No sampled READY has positive stop/mutation/error signals. This is a bounded observation, not proof against all provider pauses. |
| 3 Reload | PASS | `traces.reload`: same conversation/carrier, changed execution instance and rebuilt quiet window. Corrected new conversation also passes `reloadTrace`, establishing the final new ID survives reload. |
| 4 Same tab C1 → C2 | PASS | Real provider sidebar link click, not history mocking. `traces.sameTabNavigation`: same carrier, changed ref, increased sourceEpoch, transition starts non-READY; subsequent observations do not return to C1. No artificial delayed event was injected. The current adapter samples synchronously, so this is not a cross-process durable fence proof. |
| 5 Duplicate tab | PASS | `traces.duplicate` versus `reload`: equal provider/ref, distinct confirmed browser-tab carriers. No lease or dispatch authority is claimed. |
| 6 New conversation identity timing and safe establishment | NOT_VERIFIED (partial) | Ordinary UI route timing verified below; provisional-ID bug fixed and reproduced. Exact backend reasoning onset and provider-native transport-only capability remain unverified. No conformance receipt can be issued. |
| 7 Observer restart / reattach | PASS | Merged build: `extensionReloadAndPageReattach` after Chrome extension reload callback. Corrected build: `workerTrace` plus confirmed stopped/running lifecycle and loss of a volatile worker marker. Conversation ID reconstructs and READY returns without old observer memory. Independent hot reinjection and full browser-restart identity continuity are not claimed. |

## New-conversation timing

A normal message was submitted in a fresh ChatGPT conversation, outside the user's existing conversation. Prompt: “请用中文写一段约150字的文字，解释为什么天空看起来是蓝色的。” This is an ordinary semantic turn, not a quarantine or bootstrap operation. A second normal message tested generation from READY. The corrected-build repeat used a five-sentence rainbow explanation.

A metadata-only sampler checked route, stop presence, message counts and assistant character counts every 20 ms and retained changes. Sampling intervals are nominal; timestamps describe first observations, not exact server events.

| Event | Epoch milliseconds | Relative to send-key invocation |
| --- | --- | --- |
| Before submit: `/`, zero messages, no stop | 1788965003069 | -84 ms |
| Send-key invocation | 1788965003153 | 0 |
| First observed `/c/WEB:…`, stop=true | 1788965003336 | +183 ms |
| WEB route, user/assistant containers present | 1788965003590 | +437 ms |
| First observed final `/c/<provider-id>`, stop=true | 1788965004195 | +1042 ms |

The final ID arrived after normal submission and after the UI already exposed active generation. Assistant character count at that point can include status text, so it is not evidence of when actual model reasoning began. Identity allocation may also precede route visibility. The data establishes neither exact server-side order nor a general absence of other provider capabilities.

The corrected repeat directly observed a WEB route with `state=GENERATING`, `conversationIdentityState=unresolved`, followed by a formal provider ref and READY. Reload preserves that formal ref. See `trace` and `reloadTrace` in corrected evidence.

## Findings and consequences

### IMPLEMENTATION_BUG — provisional WEB route advertised as resolved

- Expected: resolved provider conversation identity must not silently promote an observed temporary client locator to the stable provider ref used for re-identification.
- Observed: original `newSubmit` trace reports `providerConversationRef=WEB:…`, `conversationIdentityState=resolved`, then replaces it with another ID within the same first submission.
- Reproduce: with merged extension enabled, start a new ChatGPT conversation, capture before first submit, send a normal message and retain WEB → formal-ID route events.
- Correction: only the runtime observation adapter withholds WEB-prefixed refs. RouteRef remains visible; positive generation signals still yield GENERATING while identity is unresolved. Other page-context/capture behavior is unchanged.
- Validation: regression holds a quiet WEB route for 4.5 seconds and requires ATTACHING/unresolved; generation remains unresolved; formal-ID arrival advances epoch and requires stabilization before READY. Real corrected-provider repeat confirms the same behavior.
- No premature READY was observed on the transient WEB route in the original run. This is an identity-reporting defect with a potential readiness risk if the route persists quietly, not an observed duplicate send or binding corruption.
- Design consequence: none; this is adapter hardening within existing contracts, not a new binding policy.

### PROVIDER_FACT — visible identity establishment follows normal submission on tested path

The tested ordinary new-chat UI did not expose a stable route identity before submit and exposed stop-generation state before the formal ID. That ordinary workflow is insufficient evidence for IDENTITY_FIRST. A prompt-only attempt is not Mode B. Current Binding v1 already provides Human-assisted adoption fallback; this does not contradict the contract or require redesign.

### IMPLEMENTATION_DETAIL — rendering can resemble generation

The initial authenticated attach briefly reports GENERATING while existing assistant DOM hydrates, before stabilization. This is conservative operational output activity, consistent with the adapter's documented scope; it is not a claim that a fresh semantic turn was submitted.

## Reproduction

1. Build the exact source revision with `npm run build`. In a dedicated Chrome profile load repository `dist` via `chrome://extensions/` → Developer mode → Load unpacked. Confirm the extension inventory is ENABLED and points to that directory; command-line flags alone are not evidence of installation.
2. Human authenticates ChatGPT in that profile. Use an existing conversation for read-only attach/reload/duplicate; use a separate new conversation for the normal test prompts above.
3. Register the metadata listener **before navigation/first submission**, using an init script on the test browser context. A manual late-installed console listener may miss attach or transient identity events:

   ```js
   window.noosTrace = [];
   window.addEventListener('noos:runtime-observation', event => {
     window.noosLatest = JSON.parse(JSON.stringify(event.detail));
     window.noosTrace.push(window.noosLatest);
   });
   ```

4. Wait for READY, export the trace, reload and compare provider/ref, carrierRef and executionInstanceRef. Open the same URL in another tab and require different confirmed carriers. Submit a normal message from READY, then record through the final quiet window.
5. For C1 → C2, click the provider's actual sidebar conversation link in the same tab. Require advancing sourceEpoch, no immediate READY at the change and no return to the old ref in subsequent samples. Do not treat forged debug events as internal observer events.
6. For new-chat timing, sample the path and visible generation/message metadata before the first send; preserve transient WEB paths instead of filtering them out of evidence. Repeat after the correction.
7. Reload the extension using Chrome diagnostics, then reload the page with a pre-navigation listener. For the worker path, use CDP `ServiceWorker.enable`, require `running`, set a volatile marker, call `ServiceWorker.stopWorker`, require `stopped`, reload the provider page, require `running`, marker absence and reconstructed identity/READY. Do not equate an unchanged CDP target locator with surviving worker memory.
8. Export only metadata; alias private IDs consistently before publishing. Browser profile directories, cookies and built assets remain untracked.

## Validation and remaining action

- `npm run typecheck`: PASS.
- Relevant Vitest suites: content UI 22, runtime observer 14, background observation 2 — **38 tests PASS**.
- `npm run build`, `git diff --check`: PASS.
- Real-provider results are listed separately above; fixture tests do not upgrade provider capability claims.

Remaining work is narrowly capability-level: obtain an explicit provider capability/version contract or reproducible non-executable identity-establishment mechanism that can attest Mode A or all Mode B requirements, or obtain an explicit acceptance of Human-assisted adoption as the supported scope. If exact server-side reasoning/identity ordering is required, browser route/DOM observation alone is insufficient. No further password entry or extension setup is needed for the completed browser scenarios. Until that scope/evidence question is resolved, do not declare SLICE_0_PASS or close Issue #1.

No GO, SubmissionOperation, Reducer/dispatch claim, canonical CurrentConversationBinding write, lease, rollover, worker/reviewer/result-delivery runtime or Slice 1 feature was implemented.
