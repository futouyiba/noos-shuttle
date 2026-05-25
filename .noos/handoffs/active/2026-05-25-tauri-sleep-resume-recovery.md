<!-- NOOS:THREAD:BEGIN -->
---
type: noos_thread
version: 0.1
handoff_revision: v1
source_app: codex
source_url: ""
target_agent: codex
status: active
created_at: 2026-05-25T00:09:23+08:00
title: Tauri Sleep Resume Recovery for NOOS Hub and LLM Wiki
thread_title: Tauri Sleep Resume Recovery for NOOS Hub and LLM Wiki
lookup_key: 20260525-tauri-sleep-resume-recovery
tags:
  - noos
  - tauri
  - sleep-resume
  - hub
  - llm-wiki
---

# Tauri Sleep Resume Recovery for NOOS Hub and LLM Wiki

## Current Situation

NOOS Hub and the LLM Wiki app both showed high-CPU or unresponsive behavior after long macOS sleep/resume cycles.

Observed examples:

- NOOS Hub appeared as unresponsive in Activity Monitor after roughly 10 hours of sleep.
- The local Hub `/health` endpoint timed out while the process consumed high CPU.
- The LLM Wiki Tauri process was also observed consuming very high CPU after a long runtime.
- Current stopgap work added a wall-clock sleep guard that exits after a long sleep gap, plus a Hub launcher watchdog. That prevents endless CPU burn, but it is not acceptable as the final product behavior because the user can wake the machine and find the Hub unusable.

The next implementation should be done in a separate branch or separate worktree. Do not continue this feature directly on `main`.

## Confirmed Product Direction

The desired behavior is:

1. Sleep/resume should not permanently break Hub, Shuttle, Vault, or Wiki workflows.
2. The app should first try to recover in place after wake.
3. If in-place recovery fails, it may relaunch itself as a fallback.
4. Long term, NOOS Hub should evolve toward a background core plus a UI shell:
   - `noos-core` owns localhost API, Vault ingest, index, outbox, Wiki bridge, and runtime projections.
   - Hub UI is allowed to reload or crash without taking down the local write channel.

## Task

Implement a robust sleep/resume recovery strategy for NOOS Hub first, then apply the same pattern to LLM Wiki if the repo is available in the worktree.

The work should replace the crude "sleep gap means exit" behavior with an explicit recovery state machine.

Recommended state machine:

```text
running
  -> suspended
  -> resumed
  -> recovering
  -> healthy

recovering
  -> degraded
  -> relaunching
  -> healthy
```

## Implementation Requirements

### NOOS Hub

- Detect resume through both:
  - frontend Tauri events such as `tauri://suspended` and `tauri://resumed`
  - backend wall-clock gap detection, because the WebView may itself be frozen
- On resume, do not immediately exit.
- Enter a `recovering_from_sleep` state.
- Clear or invalidate cached health state.
- Re-check the localhost write service at `127.0.0.1:17642`.
- If healthy, refresh Hub UI state and mark the system healthy.
- If unhealthy, attempt to restart or rebind the local write path.
- If repeated recovery attempts fail or CPU remains abnormal, relaunch the Hub as a fallback.
- Keep Shuttle auto-ingest as the top priority: after wake, the browser extension should again be able to save Handoff and Crystal objects into the local Vault.

### LLM Wiki

If working in the LLM Wiki repo, apply the same conceptual pattern:

- Restart or resubscribe file watchers after wake.
- Restart clipboard watcher if needed.
- Resume scheduled import and health polling without accumulating duplicate intervals.
- Perform an explicit rescan after wake because file system watcher events may be lost during sleep.
- Prefer in-place recovery; relaunch only after recovery fails.

## Constraints

- Do not implement this directly on `main`.
- Do not make model/API calls mandatory for recovery.
- Do not rely only on frontend WebView events.
- Do not leave a behavior where the app simply exits after every long sleep without a relaunch path.
- Do not expose the whole NOOS Vault to unrelated agents while testing.

## Acceptance Criteria

- After a real macOS sleep and wake cycle, NOOS Hub remains usable or recovers automatically.
- `/health` responds after wake.
- Hub CPU settles back to a low steady state after wake.
- Shuttle can save to local NOOS Vault after wake without manual process killing.
- If recovery fails, the user sees or receives a clean relaunch rather than a hung high-CPU process.
- The implementation includes a way to test the recovery path without waiting overnight, such as a short debug threshold or test-only trigger.
- Documentation explains the sleep/resume behavior and the fallback strategy.

## Suggested Next-Agent Instructions

1. Start from branch `codex/solidify-noos-current-state` or create a new worktree from it.
2. Read this handoff before editing.
3. Inspect the current stopgap implementation in:
   - `apps/noos-hub/src-tauri/src/main.rs`
   - `apps/noos-hub/src/main.ts`
   - `scripts/noos-hub-launch.sh`
   - `docs/noos-hub-power-profile.md`
4. Replace the exit-only sleep guard with an in-place recovery coordinator.
5. Run Hub Rust checks, TypeScript checks, unit tests, and a manual sleep/resume simulation.
6. Write back a result summary before handing off again.

## Open Questions

- Whether the NOOS Hub relaunch fallback should use a Tauri process relaunch API, the external launcher watchdog, or both.
- Whether LLM Wiki should be fixed in the same branch or in its own repository branch after NOOS Hub proves the pattern.
- Where to place the eventual `noos-core` background service boundary.
<!-- NOOS:THREAD:END -->
