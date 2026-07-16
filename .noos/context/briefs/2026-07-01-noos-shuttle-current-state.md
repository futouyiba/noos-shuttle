# NOOS Shuttle Current State Brief - 2026-07-14

## Purpose

This brief is a current-state snapshot for future NOOS Shuttle / NOOS Hub sessions. It is not an active handoff and does not imply a task lifecycle that must be closed.

## Current Git State

- Local branch: `main`
- Local and remote baseline after metadata cleanup: `665e809 Ignore local Claude worktree and NOOS config state`
- Latest product release tag: `v0.1.6` at `aa07af9 Release 0.1.6`
- The `CLAUDE.md` repository guide and local-state ignore rules were committed and pushed after the release tag.
- `.claude/worktrees/`, `.claude/settings.local.json`, `.noos/config.json`, `.noos/local.json`, and `.noos/runtime/` are treated as machine/session-local state.

Always check `git status --short --branch` at session start because this snapshot can become stale.

## Current Product Baseline

### Browser Shuttle

- Captures ChatGPT Handoff, Crystal, and optional transcript Context Packs.
- Browses and selects Vault objects through Hub, with Downloads mirror fallback when Hub is unavailable.
- Supports ChatGPT Project Sources import/export boundaries and reply-scoped generated image download.
- Supports Feishu Markdown export, folder export, category routing, Wiki organization, synchronization, and publishing NOOS Markdown back to Feishu.

### NOOS Hub

- Provides the local control plane and HTTP bridge on `127.0.0.1:17642`.
- Owns pairing/authentication, local Vault ingest/index/browse, adapter health, config/actions, updater flow, and runtime projection support.
- The frontend uses four task-oriented sections: Home, Vault, Adapters, and Settings, plus Help from the top bar.
- Hub UX includes a dashboard, stacked adapter rows, action feedback/toasts, retry behavior, and sleep/resume recovery status.

### LLM Wiki

- Remains vendored under `apps/llm-wiki` as a React 19 + Tauri v2 app.
- Includes ingest queues, project switching/reset, source watching, scheduled imports, retrieval/context budgeting, graph analysis, embeddings/vector search, review, deep research, multimodal extraction, and sleep/resume recovery.

## Recently Completed

### Release 0.1.6

- Release commit: `aa07af9 Release 0.1.6`
- Root, Hub, and release metadata are aligned at version `0.1.6`.
- Feishu library Markdown link preservation and refresh metadata fixes are included immediately before the release.

### Repository Guidance and Local-State Hygiene

- `1fcfde4 Document build, test, and architecture in CLAUDE.md`
  - Added common root/Hub/Wiki commands, single-test examples, release parity, architecture overview, and package-specific development notes.
- `665e809 Ignore local Claude worktree and NOOS config state`
  - Prevents Claude Code worktrees and machine-specific NOOS paths from polluting `git status` or being accidentally committed.

### Hub UX Refactor Lifecycle

- The Hub UX work described in `2026-07-01-hub-ux-refactor.md` is already merged into `main` and has been moved from `active/` to `done/`.
- Its implementation includes dashboard navigation, stacked adapter rows, action feedback, retry behavior, and removal of obsolete routed pages.

## Active Handoffs

There are currently no active repository handoffs. The Project Sources export and reply-image handoff was accepted in headed Chromium on 2026-07-16 and moved to `done/`.

Acceptance evidence covered:

- real extension + Hub Project Sources import with a local Vault Handoff;
- Project Sources export of two visible entries through the real extension/Hub path;
- selected-reply image download with the non-selected reply excluded.

A temporary local Vault Handoff remains as acceptance evidence. Its machine-local key and path are intentionally omitted from this tracked brief.

## Branch and Stash Hygiene

Fully merged remote branches currently visible include:

- `codex/handoff-vault-git-sync`
- `codex/noos-hub-cleanup`
- `codex/solidify-noos-current-state`
- `codex/tauri-sleep-resume-recovery`
- `formerIssues`

They have no commits ahead of `main` and can be deleted intentionally if remote branch cleanup is requested. Do not delete them as part of unrelated work.

A stash remains:

- `stash@{0}: On main: codex local windows hub/build artifacts before pull 2026-07-01`

Inspect it before dropping or applying it; do not assume it is disposable build output.

## Architecture Health and Risks

The repository is broadly healthy: subsystem boundaries are clear, pure TypeScript logic is tested, release/update flows are documented, and generated outputs are ignored.

Primary maintainability hotspots:

- `apps/noos-hub/src-tauri/src/main.rs` combines Hub commands, local HTTP handling, Vault/index behavior, Feishu integration, authentication, and sleep recovery in one large file.
- `src/content/index.ts` combines the Shuttle UI state machine with ChatGPT, Feishu, Vault, Project Sources, artifact, and delivery flows.

These are medium-term refactor candidates, not current release blockers. Refactor them only with characterization tests and scoped plans.

## Recommended Next Steps

1. Run the comprehensive automated verification suite for the current baseline.
2. Complete the logged-in Chrome acceptance pass for the remaining active Project Sources/image handoff.
3. Perform an end-to-end smoke pass across ChatGPT capture, Context Pack, Feishu export/publish, Hub Vault actions, and sleep/resume recovery.
4. Decide whether to clean fully merged remote branches and the old stash.
5. Choose the next product lane:
   - direct Hub binary artifact ingest instead of Downloads mirror;
   - Vault browser pagination, filters, keyboard navigation, and richer metadata;
   - Hub backend/module decomposition;
   - Browser Shuttle content-script decomposition;
   - stronger cross-platform and end-to-end CI.

## Verification Commands

Use the package-specific commands documented in `CLAUDE.md`. The broad automated baseline is:

```bash
npm run typecheck
npm test
npm run build
npm run hub:web:build
npm run wiki:typecheck
npm run wiki:test
npm run sleep:recovery:test
```

Real-LLM tests remain separate and require local test environment configuration.
