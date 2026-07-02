# NOOS Shuttle Current State Brief - 2026-07-01

## Purpose

This brief is a current-state snapshot for future NOOS Shuttle / NOOS Hub sessions. It is not an active handoff and does not imply a task lifecycle that must be closed.

## Current Git State

- Local branch: `main`
- Local HEAD: `524fb0d Improve NOOS Hub readability flow`
- Remote baseline: `origin/main` at `38f1369 Merge NOOS Hub cleanup`
- Local `main` is ahead of `origin/main` by 1 commit.
- Worktree has uncommitted changes in:
  - `apps/noos-hub/src-tauri/src/main.rs`
  - `apps/noos-hub/src/main.ts`
  - `scripts/noos-install.sh`

Treat those uncommitted files as user or in-progress changes unless explicitly instructed otherwise.

## Recently Completed

### Release Baseline

- Release tag: `v0.1.4`
- Release commit: `ac06d89 Release 0.1.4`
- Published assets included extension zip, agent skills tar, and Hub source tar.
- Signed Hub binary/updater artifacts were not produced in that release because signing secrets were not available at the time.

### Hub Packaging and Updater

- `5ef10a6 Fix NOOS Hub Windows build preparation`
  - Added/restored Windows `icon.ico`.
  - Kept the Hub bundle resource path for the built NOOS Shuttle extension.
  - Replaced `hub:prepare-extension` with a Node script for better Windows compatibility.

- `ad4820a Document Hub updater signing workflow`
  - Added `docs/noos-hub-updater-signing.md`.
  - Added `scripts/noos-hub-bundle.sh`.
  - `npm run hub:bundle` now supports signed updater artifacts when a Tauri signing key is configured.
  - Without a signing key, local bundle builds disable updater artifacts but still produce a runnable Hub app.

### Feishu Bidirectional Flow

- Earlier base: `1413328 Add Feishu MD export and folder actions`
  - Feishu document export to Markdown.
  - Optional Wiki organization.
  - Folder-opening actions from the Hub/extension flow.

- Recent merge: `0bd7694 Merge Feishu Markdown publish surface`
- Feature commit: `5900221 Add Feishu Markdown publish surface`
  - Added NOOS Vault Markdown selection from Feishu pages.
  - Added publishing selected NOOS Markdown as a new Feishu document.
  - Added confirmed overwrite for the current Feishu document.
  - Hub command: `feishu.publishMarkdown`.
  - Hub reads only Markdown files inside `~/.noos/vault`.
  - Publish implementation uses `lark-cli docs +create/+update` with stdin, not shell-string command construction.

### Hub Cleanup and Safety

- Merge: `38f1369 Merge NOOS Hub cleanup`
- Included commits:
  - `7c551d1 Harden Hub vault index writes`
  - `ad4820a Document Hub updater signing workflow`
  - `5236c05 Refactor Hub UI pages and status rendering`

Key outcomes:

- Vault index writes now use stricter JSON reads and atomic file replacement.
- Corrupt `keys.json` / `objects.json` is rejected instead of being silently overwritten.
- Hub UI code was split out of a large `main.ts` into page renderers, status helpers, shared types, update render helpers, and vault file action helpers.
- Recent Vault file actions no longer inject raw local paths into rendered HTML `data-run` attributes; paths are bound through DOM data after render.
- Hub UI tests were added for renderers, status helpers, and vault file action binding.

### Context Pack and Transcript Background Layer

- Merge: `6640d0e 合并 NOOS Context Pack transcript capture`
- Feature commit: `94ce47b Add NOOS context pack transcript capture`

Key outcomes:

- ChatGPT handoff capture can also capture a full transcript from the currently rendered DOM.
- Outputs include:
  - `transcript.full.md`
  - `manifest.yaml`
  - `transcript.index.json`
  - `key-excerpts.md`
  - `decision-capsule.md`
  - `execution-digest.md`
- Context packs are written into `~/.noos/vault/context-packs/` through Hub.
- DOM capture filters ChatGPT sidebar, composer, toolbar, menu, copy/share/voice controls, and hidden branches.
- The design explicitly does not pretend completeness when ChatGPT virtualizes long conversations; manifest completeness should remain `partial` when the full scroll range cannot be verified.

### Sleep / Resume Recovery

Sleep/resume recovery has been completed and merged into `main` in earlier work.

Key conclusions:

- NOOS Hub and LLM Wiki both need explicit recovery logic on macOS after long sleep/wake cycles because they combine WebView, localhost services, file watchers, polling, and background work.
- Product strategy is:
  - recover in place first;
  - relaunch only as fallback;
  - long-term split Hub into `noos-core` background service plus `hub-ui`, so UI/WebView failure does not block Vault ingest or localhost APIs.

## Active Handoffs

Current active handoff file:

- `.noos/handoffs/active/2026-06-05-project-sources-and-reply-images.md`

This appears to be a historical handoff for already implemented Project sources export and reply-scoped image download work. It should not be moved to `done/` unless lifecycle cleanup is explicitly requested.

## Remaining Branches

Known branches still present after merges:

- `codex/noos-hub-cleanup`
- `codex/feishu-publish-markdown`
- `codex/noos-context-pack-doc`
- `codex/tauri-sleep-resume-recovery`
- `codex/solidify-noos-current-state`
- `codex/handoff-vault-git-sync`

Merged branches can be kept as history references or cleaned up later.

## Product Position

NOOS Shuttle has moved from a browser capture tool toward a local operating layer:

- browser extension captures and saves context;
- Hub owns local Vault, adapter health, update flow, and local write channel;
- Context Pack gives agents a richer background layer;
- Feishu is becoming a bidirectional knowledge surface;
- sleep/resume recovery and atomic index writes make the local system more resilient.

## Recommended Next Steps

1. Decide whether to push local commit `524fb0d` and handle the current uncommitted Hub/install changes.
2. Reload the unpacked NOOS Shuttle extension from `dist/` after any extension build.
3. Run an end-to-end smoke pass:
   - ChatGPT handoff capture;
   - full transcript context pack capture;
   - Feishu export to NOOS;
   - NOOS Markdown publish to Feishu;
   - Hub Vault index write and recent file actions;
   - Hub bundle with and without signing key.
4. Consider lifecycle cleanup:
   - archive the historical active handoff if it is fully complete;
   - delete or retain merged feature branches intentionally.
5. Continue product work on the closed loop:
   - Vault;
   - Wiki;
   - Crystal;
   - Handoff;
   - Runtime Projection;
   - chatbot/agent context feeding.
