# Implementation Slice 2: GitHub Mailbox (Issue #10, restricted mailbox/provenance scope)

## Scope and authority boundary

This slice implements [Issue #10](https://github.com/futouyiba/noos-shuttle/issues/10) restricted to the
mailbox/provenance scope the current contract whitelists. Design authority is the current reading path
`docs/deliberation-harness/cross-agent-handoff-escalation-contract-v3.md` (main, independent consolidation
review `APPROVE` at `9ed74f2`), over the V1 authority baseline
`futouyiba/noos_docs@a49303cabf436f3398a596685d36d2792e6a08a1`. Contract §19 authorizes #10 to proceed with:

| §19 whitelist item | Implementation |
| --- | --- |
| Persisted Escalation identity before post | `CrossAgentMailbox.openEscalation` persists the escalation (create-or-get by id + semantic fingerprint) in the local ledger before any transport; `open`/`revise-packet` CLI commands persist first, then render, then optionally post. |
| Immutable packet identity/revision/fingerprint | `compilePacket` mints deterministic `escalationId/packet/rN` ids; the fingerprint covers semantic content (not revision identity), so identical content create-or-gets the latest packet (lost-ack recovery) and changed content mints rN+1 with `supersedesPacketId` lineage. |
| Marker discovery | `extractMarkerBlocks` + `parseEnvelopeJson` + `CrossAgentMailbox.discover(comments)` restart-safely rediscover escalations, latest packet revisions, observed/unobserved result markers, foreign escalations, and malformed/forbidden markers from durable GitHub comments + ledger, with no in-memory state. |
| Create-or-get | Escalations (same id + same fingerprint → existing; different fingerprint → `escalation_fingerprint_mismatch`), packets (content-identical → latest; deterministic id per revision), posts (same commentRef + fingerprint → same post record), and result observations (same result id + fingerprint → no duplicate). |
| Immutable observation capture | `observeComments` freezes `(commentRef, author, observed/comment revision time, content fingerprint, parsed identity)` per marker-bearing comment. An edited comment appends a NEW observation with `editedAfterObservation: true`; history is never rewritten. |
| Result dedup/provenance | Same `(result_id, result_fingerprint)` replays idempotently; same id with a different fingerprint records a `PENDING_TRIAGE` `ResultFingerprintConflict` (the §15 "before RESOLVED: invariant conflict at observation" path — this prototype has no RESOLVED state) instead of silently accepting or dropping it. |

GitHub remains transport only (§15/§18): the Issue is the work-item envelope, Issue/PR comments carry
structured `noos-mailbox` fenced markers (ESCALATION_PACKET / ESCALATION_RESULT), and provenance pins
exact repository/path/commit/blob/PR-head refs (`MailboxProvenance` requires at least one exact revision
anchor and validates 40-hex SHAs and `owner/name#number` refs).

## Hard boundary conformance

- **No `result_kind`, no destination-authored sufficiency field.** Rendering builds envelopes only from
  validated typed records and re-scans the serialized envelope for forbidden keys (`result_kind` exact;
  any key containing `sufficien`) before emitting. Parsing rejects any marker containing a forbidden key
  before it can be imported as a result observation (`FORBIDDEN_FIELD`), and `buildResultEnvelope` output
  is asserted forbidden-field-free in tests. `completion_status` remains descriptive only (contract §3.6).
- **No automatic resume (#11/#12 blocked).** There is no `resolve_escalation`/`withdraw_escalation`, no
  ResolutionRequirementTemplate, no ResolutionPolicy, no WAIT state, and no resume trigger.
  `openEscalation` explicitly rejects `AUTOMATIC_TEMPLATE_BOUND` (`automatic_mode_unavailable`). All
  escalations are `HUMAN_MEDIATED` and remain `OPEN`; every escalation is blocking, and resume happens only
  through the Human-mediated short launch instructions the tool prints.

## Deliverables

- `src/core/cross-agent-mailbox.ts` — pure, self-contained core (erasable-syntax TypeScript, no imports)
  implementing the whitelist semantics above plus `compileLaunchInstructions` (durable refs + short
  instructions only). Every applied commit advances the ledger revision (durable commit fence), so
  interleaved writers lose CAS and retry instead of silently overwriting persisted records; discovery
  verifies live packet CONTENT by recomputing the semantic fingerprint (not just the marker's claimed
  fingerprint field, reported separately as claim integrity), and envelope rendering round-trip-checks
  the fenced marker so text containing ``` is rejected instead of emitting an unparseable marker.
- `tests/cross-agent-mailbox.test.ts` (46 tests) — persist-before-post, create-or-get variants, packet
  revision lineage, envelope determinism and round-trip safety, forbidden-field rejection (including
  smuggled `result_kind`/`is_sufficient` markers), observation freezing, edit conflicts, competing
  results, forced-interleaving concurrency (the lost-update window the revision fence closes),
  discovery cross-checks (content-vs-claim fingerprints, same-revision divergences, unobserved markers,
  foreign packet AND result markers), restart-safety, launch instructions, and the C1–C5 closure suites
  (result tamper matrix, escalation payload integrity, packet-binding enforcement, conflict/anomaly
  create-or-get replay).
- `scripts/noos-mailbox.mjs` + `npm run mailbox` — thin `gh`-backed CLI (`init`, `open`, `revise-packet`,
  `record-post`, `render-result`, `discover`, `observe`, `show`). Comment ingestion uses
  `gh api --paginate --slurp` so multi-page issue comment threads parse correctly. The ledger defaults
  to `.noos/runtime/mailbox/<owner>__<repo>__issue-<n>.json` (gitignored runtime state, single ledger
  per GitHub Issue work item). Node ≥ 23.6 native type stripping imports the core directly; no new
  dependency. `tests/noos-mailbox-cli.test.ts` (7 tests) covers the CLI helpers (argument parsing,
  ledger path derivation, provenance mapping, paginated comment flattening), an end-to-end
  open → discover → render-result → observe → discover flow against a fake `gh`, and C3 integrity-anomaly
  surfacing in operator output.

## Represented loop (acceptance)

```text
npm run mailbox -- open --issue O/R#N ... [--post]     # persist escalation + packet, post marker
  -> prints short destination instruction (refs only)
npm run mailbox -- render-result --escalation ... [--post]   # design side answers with ONE result marker
npm run mailbox -- observe --issue O/R#N              # freeze observations, dedup, surface conflicts
  -> prints short resume instruction (result id + comment ref + "SAME source operation")
```

Every step is durable GitHub refs (issue/comment ids, packet/result ids, fingerprints) plus short launch
instructions; the Human never copies full prompt/result bodies. The same-source-operation resume and the
adjudication's authority effect remain Human-mediated decisions, per contract §19.

## Verification

Executed from repository root on this branch:

```sh
npm run typecheck
npx vitest run tests/cross-agent-mailbox.test.ts        # 46 passed (incl. C1-C5 suites)
npx vitest run tests/noos-mailbox-cli.test.ts           # 7 passed (incl. C3 surfacing)
npm test -- --exclude tests/content-ui-smoke.test.ts    # full suite without the browser fixture
node --check scripts/noos-mailbox.mjs
npm run mailbox -- init/open/show/render-result smoke   # dry flow on a temp ledger (no gh calls)
```

## Independent review and disposition

An independent reviewer reviewed exact commit `f644a46` and returned `REQUEST_CHANGES` with one P1 and
one P2 (review comment preserved on the PR). Disposition, all applied and regression-tested:

- **F1 (P1) commit fence** — `commit()` never advanced the ledger revision, making CAS inert and allowing
  silently lost records under interleaved writers. Fixed: every applied commit advances the revision;
  forced-interleaving test added.
- **F2 (P2) multi-page comments** — `gh api --paginate` output is concatenated JSON arrays, so issues
  with >1 comment page crashed `discover`/`observe`. Fixed with `--slurp` + defensive flattening, covered
  by tests.
- **F3 (P2) test gaps** — added the concurrency test and CLI tests (fake-gh end-to-end flow).
- **F4 (P3) claimed-fingerprint trust** — discovery now recomputes the packet content fingerprint from
  live marker content (`packetFingerprintMatchesLive`) and reports marker self-consistency separately
  (`livePacketClaimIntegrity`).
- **F5 (P3) canonicalization determinism** — key sort switched from locale-aware `localeCompare` to
  codepoint order.
- **F6 (P3) fence-breaking content** — rendering rejects content that cannot round-trip through the
  fenced marker (`marker_unsafe_content`) instead of emitting a truncated/unparseable marker.
- **F7 (P3) foreign result markers** — `ESCALATION_RESULT` markers targeting unknown escalations are
  surfaced in discovery alongside foreign packet markers.
- **F8 (P3) usage text** — `init --ledger` and `open --escalation-id` documented as required (the
  explicit id keeps reruns create-or-get idempotent after a lost post acknowledgement); the core can
  still mint an id when omitted.

The focused re-review of `e75f48c` returned `APPROVE` (F1–F8 all CLOSED) with two new P3 findings, both
also addressed:

- **N1 (P3) same-revision divergent live copies** — discovery now surfaces
  `sameRevisionDivergences` when multiple live packet copies claim the same max revision but diverge in
  content or claimed fingerprint (order-independent); regression-tested in both orders.
- **N2 (P3) foreign-result CLI print** — `discover` prints the result id for foreign result markers
  instead of an undefined work-item parenthetical.

## Primary Design disposition C1–C5 (final-head integrity closure)

Primary Design adjudicated `960ea8b` as not closure-eligible (PR #24 comment `5690471474`, Issue #10
comment `5690472636`): direction and F1–F8 closure accepted, #10 stays mailbox/provenance-only, five
provenance/idempotency findings must close. All five are implemented in this revision:

- **C1 — result identity is the recomputed semantic fingerprint.** `resultContentFingerprintFromWire`
  recomputes the fingerprint from the parsed result payload with the exact field set
  `buildResultEnvelope` fingerprints. Observation identity, dedup, and conflict detection use only the
  recomputed value — never the marker's declared `result_fingerprint`, which is recorded separately
  (`declaredResultFingerprint`) for auditing. A declared≠recomputed mismatch freezes a durable
  `RESULT_FINGERPRINT_CLAIM_MISMATCH` integrity anomaly (`PENDING_TRIAGE`); an edited result retaining
  an old claim produces a fingerprint conflict on recomputed identity, never an idempotent replay.
  Tamper-matrix tests cover: content-edited + retained claim (conflict + anomaly), forged claim over
  identical content (anomaly only, no replay), honest marker (no anomaly).
- **C2 — live Escalation payload integrity.** `escalationContentFingerprintFromWire` recomputes the
  escalation semantic fingerprint (question, blocker, roles, authority basis/refs, evidence refs,
  provenance exact-revision refs, source operation/work item) from the live marker. Discovery reports
  `escalationFingerprintMatchesLedger` (wire content ↔ durable ledger Escalation) and
  `liveEscalationClaimIntegrity` (declared `escalation_fingerprint` ↔ wire content); any mismatching
  live copy forces the flag false — a mutated escalation cannot look clean because the packet subobject
  is intact. No semantic adjudication is added; both signals are deterministic fingerprint comparisons.
  Adversarial tests: question tamper, provenance+role tamper, self-consistent re-declared fingerprint
  over tampered content (claim passes, ledger match fails), honest copy passes both.
- **C3 — CLI surfaces every core integrity anomaly.** `discover` now prints explicit INTEGRITY lines
  for: live escalation payload vs ledger mismatch, escalation fingerprint claim mismatch, packet
  fingerprint claim mismatch, same-revision packet divergences, durable result claim-mismatch anomalies
  (`INTEGRITY ANOMALY [...]`), and `PENDING CONFLICT` records; `observe` prints anomalies and conflicts
  as they are frozen. Covered by a fake-`gh` CLI test asserting the lines appear in operator output.
- **C4 — results bind to an exact source packet.** `source_packet_id` is mandatory and non-empty in
  `buildResultEnvelope` (`source_packet_id_required`), in marker parsing (`invalid_shape` on
  null/omitted), and in the CLI (`render-result --packet` required). At observation, a result targeting
  a locally known escalation must reference a packet of that escalation in the ledger; otherwise a
  durable `RESULT_PACKET_NOT_OF_ESCALATION` anomaly is recorded and surfaced — the observation is
  frozen for audit but never clean. Foreign-escalation results are still surfaced without membership
  validation (no local ledger to validate against), which does not weaken known-escalation validation.
- **C5 — conflicts are create-or-get.** `ResultFingerprintConflict` carries a stable `conflictKey`
  (`escalation|result|recorded|observed`, all recomputed fingerprints); replays of the same conflicting
  fingerprint — across comments or restarts — reuse the existing `PENDING_TRIAGE` record, while a
  genuinely different fingerprint may create a distinct conflict. `MailboxIntegrityAnomaly` records are
  create-or-get by an analogous stable `anomalyKey`. Replay/restart tests pin both.

Boundary unchanged: still no `result_kind`, no destination-authored sufficiency, no
resolution/withdrawal/templates/ResolutionPolicy, no WAIT plane, no automatic resume; every escalation
remains `HUMAN_MEDIATED` + `OPEN`; GitHub remains transport only.

## P3/P4 follow-up (post-merge hygiene PR)

The two non-blocking findings recorded by the focused review of `de2fb5a` are closed in a small
follow-up on top of merge `f6b7b39`:

- **P3** — `observe` prints a `HOLD —` line (route to Human triage) instead of resume boilerplate when
  the escalation of a frozen result carries any `PENDING_TRIAGE` anomaly or fingerprint conflict; the
  gate also covers conflict/anomaly-only outcomes (no new observation). `discover`'s observed flag and
  the reported live-result identity now use the recomputed content fingerprint
  (`DiscoveredResultMarker.resultFingerprint` recomputed, `declaredResultFingerprint` audit-only), so a
  content-identical copy with a forged claim reports as observed and a tampered-content copy stays
  unobserved with its recomputed identity surfaced.
- **P4** — `parseEnvelopeJson` rejects (fail closed, `invalid_shape`) any ESCALATION_PACKET marker whose
  raw wire `resolution_mode`/`status` differ from the canonical `HUMAN_MEDIATED`/`OPEN`; such tampering
  surfaces in discovery as a malformed marker instead of being silently neutralized. Honest markers with
  canonical values round-trip unchanged.

## Known limits

- Single-writer ledger: the CLI store is revision-checked read-then-atomic-rename for one process; the
  core `AtomicMailboxStore` contract supports stronger stores.
- `discover --comment` filtering, PR-comment transports, and cross-machine ledger sharing are not
  implemented; PR-head provenance is carried but a PR-comment fetch command is not provided yet.
- The destination side's result marker is validated for shape and forbidden fields, not for authority
  correctness; adjudicating the content is Primary Design / Human work by design.
- No conformance to §14 post-RESOLVED notices is claimed: this prototype never resolves, so the §15
  pre-resolution conflict path is the only one exercised.
