# W5 Wiring Design — Content-Side Child Result Delivery

> Scope note for the next implementation slice. No contract change: this is the
> runtime composition of already-reviewed modules, mirroring the reviewed
> goal-reanchor probe/dispatch pattern.

## Identity seam (why this note exists)

Three naming sources meet at delivery time:

- content probes derive `logicalThreadId: "thread:${providerConversationRef}"`
  (positional, e.g. `src/content/index.ts` GO/reanchor paths);
- child records carry `parentThreadId` as an arbitrary durable id (`pdlt-l1`);
- work items carry `primaryLogicalThreadId` and a `WorkItemBinding`
  (conversationId/carrier only — no thread↔conversation map).

A parent-page probe therefore cannot match deliveries by content-derived
names. The authoritative resolver is the durable **OperationalStateReducer**
binding: `CurrentConversationBinding(logicalThreadId ↔
providerConversationRef, generation)`. Delivery resolves the parent thread by
reverse lookup ("which logical thread currently owns this conversation"), per
the binding contract — never by name equality with probe-derived ids.

## Runtime flow (mirrors goal-reanchor-runtime)

1. **Probe** — the content script on a READY parent conversation sends
   `NOOS_CHILD_DELIVERY_PROBE` with a claim context (carrier snapshot) and a
   baseline, throttled like `probeGoalReanchor`.
2. **Resolve + prepare** — the worker reverse-looks-up the logical thread via
   the durable reducer binding for the probe's providerConversationRef; lists
   delivery index rows for that parent thread that (a) have no receipt and
   (b) whose transport is absent or PREPARED under a fence matching this
   conversation. For each, `prepareChildDeliveryTransport` (fence from the
   probe context; `retargetChildDeliveryTransport` if a PREPARED transport
   fences an older conversation of the same thread — the reviewed rollover
   path).
3. **Claim + dispatch** — `submissions.claim` (transport authority), then
   `chrome.tabs.sendMessage(NOOS_DISPATCH_DELIVER_CHILD_RESULT, operation)`;
   the content listener validates the fence against its live observation
   (same shape as the reanchor dispatch listener), inserts the payload (the
   result ref), submits, and returns an observation.
4. **Record + reconcile** — worker records DISPATCHING + dispatch receipt;
   later observations reconcile per the submission contract; on
   OBSERVED_ACCEPTED, `mintInsertedOnAcceptance`; when the result-bearing
   parent turn completes, `completeDelivery` (clears the parent wait) —
   ordering per the W2 review note: reconcile → mint → await turn → record
   COMPLETED.
5. **Journal** — every dispatch attempt/ack/acceptance/completion observation
   appends to the ProviderExecutionJournal; settle-from-evidence stays the
   reducer-facing path where control-state settlement applies.

## Guards carried over (no re-derivation)

- One delivery per ResultDeliveryKey (index create-or-get); PREPARED≠INSERTED;
  mint only on ledger-verified OBSERVED_ACCEPTED.
- Rollover before claim ⇒ retarget (thread-fenced); after claim ⇒ blocked
  (execution-owning).
- Content dispatch listener checks `sender.id`, READY state, fence equality
  against the live carrier observation, and refuses when another submission
  is active (same as reanchor).

## Open item for the fork adapter (separate proposal)

Real child SPAWN still needs a provider fork action; `chatgpt-dom.ts` has no
fork/sidechain API today. Until ChatGPT exposes one, `spawnChildWorker`'s
adapter can only be satisfied by the FRESH path (new-conversation creation),
not FORKED. That gap needs its own design proposal (or explicit V1 deferral)
before claiming Step 6 browser-real.
