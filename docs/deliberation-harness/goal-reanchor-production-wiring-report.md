# Goal Re-anchor production wiring

The Goal branch imports the previously reviewed submission implementation from `ee4876e` (ten paths reported by review intake against `origin/main`). It retains the existing service-worker authority, dispatch receipt and recovery mechanisms. No branch merge or push is performed.

The production path is now:

1. The content observer sends a READY carrier probe to the service worker.
2. The worker resolves the active, bound Work Item from `noosWorkItemInbox`; callers cannot supply Goal, Scope or generation evidence.
3. The worker counts only completed GO operations belonging to the primary logical thread, backed by stable completed assistant evidence. The ledger requires both a runtime verifier and completion evidence; a caller's `substantive` or `verified` flag alone never advances it.
4. At experimental N (default 5), or a persisted authorized Work Item Goal/Scope change, the worker persists the anchor identity before executing it through SubmissionOperation prepare/claim.
5. A worker-to-content message actuates the provider composer only after the content script rechecks current identity and execution fence. The worker records the dispatch receipt.
6. Existing observation and recovery reconcile transport completion. A later probe resets the durable counter only when the anchor submission is COMPLETED. Repeated probes and worker reload do not resend completed or uncertain anchors.

The browser smoke loads the actual built content and service-worker bundles. Only Chrome APIs and the provider DOM are simulated. It checks automatic dispatch without a Human approval dialog, receipt persistence, completion reset, repeated-probe deduplication and worker reload. A separate production coordinator test advances a real SubmissionOperation through completion, verifies unfinished GO is excluded, and checks uncertain recovery preserves the operation identity.

## Remaining composition work

This change wires experimental-N and authorized Work Item scope updates. Dedicated compaction, rollover, Review-return and Sedimentation-return producers belong to their respective lifecycle implementations; the core trigger vocabulary does not prove those producers are implemented. Work Item creation/binding remains supplied by the reviewed Work Item slice. Canonical binding/lease composition still requires the integration branch and independent review.

## Validation

- TypeScript check passed.
- Full suite: 17 files / 155 tests passed, including the built-bundle browser smoke.
- Added production coordinator authority/recovery test: 1 additional test passed separately.
- Extension build, extension package and diff check passed.
