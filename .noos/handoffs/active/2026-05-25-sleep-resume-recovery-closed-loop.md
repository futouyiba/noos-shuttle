<!-- NOOS:THREAD:BEGIN -->
---
type: noos_thread
version: 0.1
handoff_revision: v1
source_app: codex
source_url: ""
target_agent: codex
status: active
created_at: 2026-05-25T11:59:00+08:00
title: Sleep Resume Recovery Closed Loop for NOOS Hub and LLM Wiki
thread_title: Sleep Resume Recovery Closed Loop for NOOS Hub and LLM Wiki
lookup_key: 20260525-sleep-resume-recovery-closed-loop
tags:
  - noos
  - handoff
  - tauri
  - sleep-resume
  - hub
  - llm-wiki
  - git
---

# Sleep Resume Recovery Closed Loop for NOOS Hub and LLM Wiki

## Current State

The original sleep/resume recovery task is complete and committed on branch
`energyBetter`.

Implementation commit:

```text
af04e8a 实现 Hub 与 LLM Wiki 休眠恢复验证
```

This commit includes:

- Vendored `apps/llm-wiki` into the `noos-shuttle` repo so it is managed by the local git index.
- NOOS Hub sleep/resume recovery state and UI reporting.
- LLM Wiki sleep/resume watcher recovery state and UI reporting.
- Hub watchdog/launcher recovery support.
- Real sleep/resume validation scripts:
  - readiness
  - preflight
  - guided runner
  - LaunchAgent/Terminal arm wrapper
  - post-wake checks
  - status gate
  - objective audit
- Documentation for Hub and LLM Wiki sleep/resume recovery.

The previous active handoff
`.noos/handoffs/active/2026-05-25-tauri-sleep-resume-recovery.md`
should be treated as implemented by commit `af04e8a`.

## Verification Evidence

Real macOS sleep/wake validation passed.

Latest real preflight:

```text
/Users/songfu/.noos/reports/noos-sleep-resume-preflight-20260525T011554Z.txt
Validation session: sleep-resume-20260525T011554Z-92486
Hub PID before sleep: 48478
LLM Wiki PID before sleep: 65509
```

Latest real acceptance:

```text
/Users/songfu/.noos/reports/noos-sleep-resume-acceptance-20260525T035549Z.txt
Validation session: sleep-resume-20260525T011554Z-92486
Sleep: 2026-05-25 11:40:35 +0800
Wake:  2026-05-25 11:40:39 +0800
Hub PID after wake: 48478
LLM Wiki PID after wake: 65509
```

Post-wake checks passed:

- Hub health endpoint responded after wake.
- Hub CPU settled at `0.0%`.
- Hub local handoff write probe was accepted and verified.
- Hub local crystal write probe was accepted and verified.
- LLM Wiki CPU settled at `0.0%`.
- LLM Wiki source watcher created and observed a fresh post-wake probe.

Final gates passed:

```sh
npm run sleep:self-test
npm run sleep:status
npm run sleep:audit
git diff --check && git diff --cached --check
```

`npm run sleep:audit` exited `0` with:

```text
ok      LLM Wiki is under noos-shuttle git management
ok      Real sleep/resume evidence is complete
ok      Objective evidence is complete
```

The temporary armed validation runner was stopped after acceptance completed:

```text
npm run sleep:arm:status
Plist exists: no
Runner process(es): none
```

## Important Fix During Validation

The first post-wake attempt exposed a parser bug in the validation scripts.
The `pmset -g log` parser was fixed in:

- `scripts/noos-sleep-resume-acceptance.sh`
- `scripts/noos-sleep-resume-guided-test.sh`
- `scripts/noos-sleep-resume-status.sh`

The fix:

- does not treat `Wake Requests` as a real wake event.
- avoids `pipefail` false negatives from exiting Python before `pmset` finishes writing.
- reports the latest ordered Sleep -> Wake/DarkWake pair inside the validation window.

## Local Runtime State

At the time of handoff:

- Branch: `energyBetter`
- Latest implementation commit: `af04e8a`
- Hub was observed as pid `48478` during validation.
- LLM Wiki was observed as pid `65509` during validation.
- The external validation runner is stopped.
- `.noos/runtime/current/RESULT_SUMMARY.md` was updated with detailed progress, but it is runtime-local and may be ignored by git.

## Suggested Next-Agent Instructions

Use `$noos-consume-handoff` to read this handoff and continue from the current
repo state:

```text
.noos/handoffs/active/2026-05-25-sleep-resume-recovery-closed-loop.md
```

Then:

1. Confirm `git status --short`.
2. Confirm whether commit `af04e8a` is present locally.
3. If the user wants sharing outside this machine, push branch `energyBetter` or open a PR according to their instruction.
4. If doing a review, start with:
   - `apps/noos-hub/src-tauri/src/main.rs`
   - `apps/noos-hub/src/main.ts`
   - `apps/llm-wiki/src-tauri/src/lib.rs`
   - `apps/llm-wiki/src/App.tsx`
   - `scripts/noos-sleep-resume-*.sh`
   - `docs/noos-hub-power-profile.md`
   - `docs/llm-wiki-sleep-resume-recovery.md`
5. Re-run `npm run sleep:audit` if fresh assurance is needed.

## Open Follow-Ups

- Decide whether to push `energyBetter` to the remote and/or open a PR.
- Decide whether the older implemented handoff
  `.noos/handoffs/active/2026-05-25-tauri-sleep-resume-recovery.md`
  should remain active for historical context or be moved to done.
- Consider splitting future work into a smaller follow-up branch for any product polish after review.
<!-- NOOS:THREAD:END -->
