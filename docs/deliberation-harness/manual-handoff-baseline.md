# Manual Design ↔ Implementation Handoff — Current Baseline (2026-09-17)

> Status: Dogfood evidence / research note
>
> Research item: `noos-shuttle#8` (parent `#7`)
>
> Successor to `cross-agent-handoff-manual-dogfood-baseline-v0.md` (2026-09-15): that note captured how the loop was *discovered* (traces A/B, pre-spec clipboard era). This note captures how the loop *actually runs today*, after the cross-conversation workflow spec (`futouyiba/noos_docs` `docs/agent-workflow.md`, v0.3.x @ `a3d33514cc3c` at the time of writing) and its Appendix B cipher/marker protocol were adopted and dogfooded.
>
> Method: every step is anchored to real dogfood events on this repository (issue/PR/comment/commit refs). Nothing here is aspirational. Verbatim quotes are marked as such. Dates follow the repo's local (+08) convention (matching commit dates); GitHub renders comment timestamps in UTC.

## 1. What changed since the v0 baseline

| Dimension | v0 era (≤2026-09-15) | Now (2026-09-17) |
| --- | --- | --- |
| Durable coordination | ad-hoc: chat transcripts + pasted packets | GitHub issue/PR threads; machine-written markers with provenance lines — exercised on this repo to date: `REVIEW:` (PRs `#34` `#42` `#43`) and `INTEGRATED:` (PR `#42`); `DESIGN:` and `IMPLEMENTED:` are defined in spec B.3 but have no verbatim instance on this repo's threads yet |
| Trigger transport | human types full instructions | cipher triggers (`dispatch` / `implement #N` / `review PR#N` / `design <ref>` / `merge PR#N` / `fix PR#N`), pointers only, spec Appendix B |
| Impl-side routing | human copy/paste between windows | machine-carried: cross-session messages between local Claude Code sessions, incl. local automation sessions acting for the orchestrator (the dispatch that started task `#8` arrived this way and left no GitHub-side `impl:` record — anchored here only by this admission) |
| ChatGPT-side design transport | human clipboard, "verdicts relayed via the operator" (`v1-adjudication-record.md`) | unchanged — still the human/connector boundary |
| Merge gating | trust in the operator | hard gate: independent-review APPROVE + exact-head identity, checked by a resident integrator session |
| Wake-up | none | `noos-watch` watcher skill (PR `#42`, merged `990037c`) polls markers and notifies |

The loop is the same *shape* v0 described — authority-aware mid-execution escalation and return — but the transport/context-routing burden has partially moved from the human into protocol + tooling. Where the human remains load-bearing is catalogued in §5.

## 2. The cast and where it runs

| Role | Runs where (observed) | Evidence |
| --- | --- | --- |
| Human operator | authorizes dispatches/merges, arbitrates ambiguity, carries the ChatGPT boundary | every thread below starts from an operator authorization |
| Orchestrator | local session; writes task issues, splits, dispatches `implement #N` | issue `#8` DISPATCH comment `5705430301` (2026-09-17, "用户在本会话明确授权 dispatch #8") |
| Implementation task | Claude Code in an isolated branch/worktree (main checkout belongs to the integrator, spec §3.4) | PRs `#34` `#37` `#38` `#41` `#43` |
| Independent reviewer | in-session fable subagent spawned after a delegation record, or a separate session | PR `#43` comments `5705121839` (delegation) → `5705382348` (verdict, provenance `relayed by impl`) |
| Epic designer | ChatGPT-side design conversation; verdicts reach GitHub via human relay | PR `#34` designer rounds; `v1-adjudication-record.md` |
| Integrator | resident session on the main checkout | PR `#43` comment `5705431032`; PR `#42` `INTEGRATED:` marker |
| Watcher | `noos-watch` skill polling markers | PR `#42` (merged `990037c`) |

Channels in actual use, in preference order (spec §4.4): direct local session-to-session messages; GitHub thread comments with `role:` prefixes as the cross-platform fallback; `.noos/` vault handoffs (`agent-registry.json`, `handoffs/`, `skills/`) as the legacy/local path — currently dormant for this workflow (last active handoffs predate the spec era; see §8).

## 3. Happy path: dispatch → implement → review → integrate

Freshest complete instance: PR `#43` (merged `d1ba73b`, 2026-09-17). Each numbered step has its durable anchor.

1. **Dispatch.** Operator authorizes the orchestrator session; orchestrator writes/uses a task issue with a `DISPATCH` comment stating constraints, authority refs, and acceptance (issue `#8` comment `5705430301`), then delivers the cipher — here a cross-session `implement #8` from an automation session.
2. **Implement.** The implementation session reads the full issue thread (adjudication refs included), works on its own branch, runs minimal sufficient verification, commits (AGENTS.md「验证」). Draft PR opened (`gh pr create --draft`).
3. **Delegate review.** A delegation record is posted *before* any verdict: `rev: review PR#43` (comment `5705121839`). This is what makes the later marker valid under spec B.3.
4. **Independent review.** Isolated reviewer context; must not trust the implementer's self-report: re-derives root causes, builds its own adversarial harnesses, re-runs the suite. Verdict lands as a first-line marker `REVIEW: <verdict> @ <head-sha>` plus a provenance second line (comment `5705382348`). In-session subagent reviewers are disclosed as such (`（rev: relayed by impl, 委派: impl）`), with behavioral independence stated in the body — spec §1.2(a).
5. **Evidence in PR body.** After APPROVE, body gains the review-evidence link + exact reviewed head SHA (PR `#43` body; spec §1.3).
6. **Integrate.** Resident integrator verifies marker/provenance/delegation/three-way head identity, archives review intake locally (`.review-intake/`, not committed), merges, re-runs verification, builds/deploys where applicable, posts `INTEGRATED: <summary + build timestamp> @ <merge-sha>` — the only verbatim-marker instance so far is PR `#42` (comment `5705065170`, `@ 990037c`); PR `#43`'s landing record (comment `5705431032`) carries the same content in merge-record heading form rather than marker syntax.
7. **Close the task issue.** Acceptance criteria re-checked before closing (spec §4.2); implementation posts `IMPLEMENTED: PR#M` with provenance on the task issue.

## 4. Exception paths

### 4.1 `NEEDS_DESIGN` escalation (proposal → adjudication → return)

Observed canonical instance, 2026-09-15 (`v1-adjudication-record.md`):

- Implementation produced two bounded proposals (`v1-design-proposal-result-delivery-lane.md`, `v1-design-proposal-reducer-model.md`) instead of silently choosing between conflicting contract readings.
- Adjudication returned *decisive sentences quoted verbatim*, e.g. there is "no second transport protocol and no second authoritative ledger ('two tables at most, one protocol')", and the reducer is "the State Store's operational/control-state reducer" — not a Provider Execution Journal.
- The authority baseline moved to `futouyiba/noos_docs @ a49303cabf436f3398a596685d36d2792e6a08a1`; verdicts were "relayed via the operator, treated as final".
- Return-to-same-operation held: implementation resumed under the adjudication (commit `0fd2de1` and the reducer line), no second task was created.

Amendment loops on the contract line ran as focused re-reviews anchored at exact SHAs: both the N1–N5 and the M1–M3 rounds ran on issue `#16`'s thread, with the designer dispositions landing on PR `#14` (e.g. comment `5683705450`); issue `#15` carries only the earlier Primary Design closure.

Feature-PR variant: PR `#34` went through three designer correction rounds (`dade6c1c97…` → `69604f8b13…` → `384f6dc932…`) before the review delegation fired (`rev: review PR#34`, comment `5704882964`).

### 4.2 `REQUEST_CHANGES` → fix → incremental re-review

PR `#38`: round-1 REQUEST_CHANGES @ `3537da9` — the verdict itself left no first-line marker comment; its durable carrier is the merge record (`5704836899`), itself an instance of the in-session relay friction catalogued in §8 — then implementer disposition comment (`5704608127`) → round-2 incremental APPROVE @ `f874766` (`5704772633`). Any commit after a reviewed head re-triggers incremental review (spec §1.3).

### 4.3 Approved head moved (design-approval invalidation)

PR `#34`: the designer close-out APPROVE @ `384f6dc` predated a merge of main `10ca5e1` (single conflict in `main.ts`), moving the head to `7aa3fb2` and invalidating the approval. A narrow incremental re-review scoped to the merge itself attested "0-line diff" on every approved UI file, a `main.ts` delta of "exactly one hunk, +3 comment lines", and concluded "the conflict resolution is purely mechanical … approval effect is restored on this proof + the Designer close-out APPROVE @ `384f6dc`" (comment `5704915942`) — the invalidation clause applied proportionally instead of re-invoking the designer.

### 4.4 Reviewer/designer technical disagreement

Spec §2.5 defines the reflux path (objection + evidence → designer re-adjudication → human operator as final arbiter; "designer 不得裁定'失败证据算通过'"). Defined but not yet exercised in a live thread on this repo — recorded here as untested protocol surface.

## 5. What the human still does (role vocabulary from issue `#8`; compare v0 §5's fuller seven-job list)

| v0 role | Current state |
| --- | --- |
| Router | partially automated: orchestrator sessions + cipher pointers route impl-side work; the human still routes *across* platforms (ChatGPT ↔ local) and arbitrates ambiguity (B.2: "其它真歧义时，接收方向授权通道确认，不猜") |
| Context compiler | mostly protocolized: task issues carry goal/scope/constraints/authority refs; reviewers/ implementers compile their own context from durable refs instead of pasted transcripts |
| Authority resolver | still human-in-the-loop at adjudication time; mechanically supported by SHA-anchored baselines (e.g. `a49303ca`) that make "which authority is current" checkable |
| Transport | machine-carried impl-side (cross-session messages, markers); **still human at the ChatGPT design boundary** (clipboard/connector) |
| Authorization | new, explicit role: ciphers and markers are *not* authorization — spec B.0.3 verbatim: "评论是记录介质，不是授权介质"; dispatch/merge authority comes only from the human or an explicitly delegated session channel |

## 6. Artifacts in actual use

- `AGENTS.md` (repo root): role table, cipher index, verification matrix, deploy-channel norms.
- Workflow spec, SHA/version-anchored when cited: `noos_docs` `docs/agent-workflow.md` (v0.3.x); authority baselines like `a49303ca`.
- Proposal / amendment / adjudication documents under `docs/deliberation-harness/` (quoted verbatim when decisive).
- Task issue + `DISPATCH` comment; PR (draft-first); delegation, verdict, and record comments with the B.3 marker grammar and provenance lines.
- `.review-intake/` archives (integrator-local, intentionally uncommitted).
- `.noos/`: `agent-registry.json` (per-agent delivery preferences), `AGENT_COORDINATION.md`, `handoffs/active|done`, `skills/`.
- Ephemeral session channels (cross-session messages) — pointers only; all content lives in the durable artifacts above.

## 7. Observed failure modes (current era)

1. **Single GitHub identity cannot formally approve.** "GitHub rejects a formal APPROVE on one's own pull request" — noted verbatim in two PR `#34` review submissions (`5703761488`, `5704085484`), and recorded as a Chinese paraphrase in the issue `#35` review record; verdicts therefore ride comment markers. Spec B.3 acknowledges this: markers are an audit protocol, not a security boundary.
2. **Stale authority refs.** v0 trace A (adjudication discovered part of the "conflict" was a stale snapshot). Mitigation in current practice: SHA-anchored citations; dispatch comments list exact authority refs.
3. **Evidence misattribution.** A flaky test failure can be blamed on an unrelated PR unless the reviewer verifies it against main first — issue `#35`'s reviewer explicitly confirmed the delivery-runtime flake "为 main 上已存在的 flaky、与本 PR 无关" before absolving PR `#34`; the same flake later cost three separate verification runs (PR `#38` comments `5704608127`/`5704836899`) until root-caused in PR `#43`.
4. **Manual provenance assembly.** The three-way identity check (marker `@sha` = PR-body head = merged head) is assembled by hand in every PR body; a mismatch anywhere invalidates the merge gate (spec B.3 "门禁不依赖推导").
5. **Authorization-channel discipline under automation.** Bypass-mode automation sessions can dispatch ciphers; acceptance relies on B.0.3/B.0.6 (records are not authorization; sensitive actions need in-session confirmation from the human or a delegated channel with a delegation record).
6. **Head-movement churn.** Every post-approval commit — even a mechanical merge — invalidates the reviewed head and costs an incremental review round (PR `#34` §4.3).

## 8. Observed friction

- Clipboard work persists at exactly one boundary: ChatGPT-side design verdicts in/out.
- In-session reviewer relay: the implementer session relays the isolated reviewer's verdict; provenance lines must say so, and the independence claim rests on disclosed behavior rather than mechanical isolation.
- Multi-round latency: PR `#34` needed 3 designer rounds + nit round + mechanical-merge re-review; PR `#38` needed 2 review rounds.
- Duplicated coordination surfaces: `.noos/AGENT_COORDINATION.md` and the vault-handoff path predate the spec era and have drifted from the GitHub-thread workflow that actually runs (§2); the registry board is not maintained as part of the loop.

## 9. Provenance requirements (carried from v0 §9, tightened by current practice)

Every step that changes feasibility must be able to answer: *which operation asked, at which exact revision, against which exact authority, answered by which adjudication, and did the work resume under it.* Concretely, current practice requires:

- delegation record preceding every verdict marker (B.3);
- marker `@ <sha>` = PR-body exact head = head at merge, all three identical (§1.3/B.3);
- provenance second line mandatory — a marker without it is invalid;
- authority citations SHA-anchored; decisive adjudication sentences quoted verbatim, never paraphrased into new meaning (spec §2.3).

## 10. Non-goals

This note documents; it does not propose. In particular it does not: automate any part of the loop, weaken the human authorization boundary, treat transported text as authoritative state (v0 §12 still applies), or invent governance authority for harness-level promotion/closure (spec §0 scope exclusion). It also does not retro-declare the marker protocol a security boundary (B.3 explicitly denies this).

## 11. Delta conclusion

v0 concluded the manual workflow was "authority-aware mid-execution escalation and return between durable work roles across heterogeneous AI surfaces." After the spec/marker/watcher adoption, that characterization still holds — but the human's remaining irreplaceable jobs have narrowed to: **authorization, cross-platform (ChatGPT-boundary) transport, ambiguity arbitration, and final-arbiter escalation**. Everything else — durable record, routing on the impl side, wake-up, identity checking — now has a protocol or tool carrying it, with the audit trail to prove it worked.
