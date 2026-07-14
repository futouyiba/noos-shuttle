# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository-specific workflow

This repository uses NOOS handoffs for AI-to-AI work transfer.

If `.noos/runtime/current/READ_ME_FIRST.md` exists, read it before starting. For NOOS runtime tasks, use projected sources under `.noos/runtime/current/sources/`, do not scan the full NOOS Vault unless explicitly instructed, produce a concise plan before implementation, and write the result summary to `.noos/runtime/current/RESULT_SUMMARY.md`.

When a task mentions a handoff, NOOS Thread, or `.noos/handoffs/active/`, use the `noos-consume-handoff` skill if available. If it is not installed, read `.noos/skills/noos-consume-handoff/SKILL.md` and follow the workflow there.

Project-local Claude Code skills can be installed under `.claude/skills/`. User-level Claude Code skills can be installed under `~/.claude/skills/`.

## Common commands

Run commands from the repository root unless noted.

### Root Browser Shuttle / release tooling

- `npm install` — install root dependencies.
- `npm run build` — build the browser extension bundle with Vite.
- `npm run dev` — watch-build the browser extension bundle.
- `npm run typecheck` — TypeScript check for root `src/`, `tests/`, and `vite.config.ts`.
- `npm test` — run root Vitest tests.
- `npm test -- tests/filename.test.ts` — run one root test file.
- `npm run package:extension` — package the browser extension.
- `npm run package:release` — package release artifacts.
- `npm run review:intake` — run the review intake CLI (`scripts/review-intake.mjs`).

### NOOS Hub desktop app

- `npm --prefix apps/noos-hub install` — install Hub app dependencies.
- `npm run hub:web:build` — TypeScript check and Vite build for Hub frontend.
- `npm run hub:build` — build Hub frontend and Rust backend binary.
- `npm run hub:dev` — run NOOS Hub through Tauri dev.
- `npm run hub:run` — build Hub frontend then `cargo run` the Tauri backend.
- `npm run hub:bundle` — build signed/packageable Hub bundle through `scripts/noos-hub-bundle.mjs`.
- `npm run hub:sleep-recovery:test` — run Rust sleep recovery tests for Hub.

### LLM Wiki app vendored under `apps/llm-wiki`

- `npm --prefix apps/llm-wiki install` — install LLM Wiki dependencies.
- `npm run wiki:typecheck` — TypeScript build check for LLM Wiki.
- `npm run wiki:test` — run LLM Wiki mocked Vitest suite (`test:mocks`).
- `npm --prefix apps/llm-wiki run test:mocks -- src/lib/context-budget.test.ts` — run one LLM Wiki mocked test file.
- `npm --prefix apps/llm-wiki run test:llm` — run real-LLM tests; these depend on local test environment secrets in `.env.test.local`.
- `npm run wiki:build` — typecheck and Vite build LLM Wiki frontend.
- `npm run wiki:dev` — run LLM Wiki through Tauri dev.
- `npm run wiki:sleep-recovery:test` — run Rust sleep recovery tests for LLM Wiki.
- `npm run wiki:vendor-check` — run vendor/chunk verification script.

### Sleep/resume and local launch helpers

- `npm run sleep:recovery:test` — run both Hub and LLM Wiki sleep recovery Rust tests.
- `npm run sleep:status` / `npm run sleep:preflight` / `npm run sleep:readiness` — sleep/resume diagnostic scripts.
- `npm run hub:launch`, `npm run hub:status`, `npm run hub:logs`, `npm run hub:stop` — manage NOOS Hub via launch script.
- `npm run wiki:launch`, `npm run wiki:status`, `npm run wiki:logs`, `npm run wiki:stop` — manage LLM Wiki via launch script.

### Release verification parity

The GitHub release workflow verifies with:

```bash
npm run typecheck
npm test -- --exclude tests/content-ui-smoke.test.ts
bash -n scripts/noos-install.sh
bash -n scripts/noos-doctor.sh
bash -n scripts/noos-find-crystal.sh
bash -n scripts/noos-import-browser-vault.sh
bash -n scripts/noos-sync-handoffs-git.sh
bash -n scripts/noos-hub-bundle.sh
bash -n scripts/package-extension.sh
bash -n scripts/package-release-artifacts.sh
```

## High-level architecture

This repository packages NOOS browser capture, local vault/control-plane tooling, and an embedded LLM Wiki desktop application.

### Root browser shuttle (`src/`, `tests/`, `vite.config.ts`)

The root TypeScript project builds a Chrome extension-style Browser Shuttle:

- `src/content/index.ts` injects the NOOS Shuttle UI into supported pages. It handles ChatGPT handoff/crystal capture, Feishu wiki actions, vault object browsing/import, user settings, and the floating UI state machine.
- `src/content/chatgpt-dom.ts` and `src/content/chatgpt-transcript.ts` isolate ChatGPT DOM interactions and transcript capture.
- `src/core/` contains pure capture/formatting logic: NOOS Thread parsing, Crystal extraction, context packs, prompt templates, frontmatter, and safe filenames. Most root tests exercise these pure modules.
- `src/background/service-worker.ts` is the browser extension background bridge. It routes content-script messages to NOOS Hub's local HTTP API on `127.0.0.1:17642`, pairs/stores a Hub token, and falls back to Downloads mirror writes when the Hub is unavailable.
- `src/storage/` provides delivery adapters (clipboard, downloads, NOOS Vault; GitHub adapter is present but not central to the local Hub flow).
- `src/shared/` holds browser-runtime helpers and localized UI strings.
- Root tests in `tests/` cover capture, formatting, Hub status/rendering, Feishu background actions, and smoke behavior. Prefer adding tests around pure `src/core` functions when possible.

The root `vite.config.ts` is not the app config; it builds extension entry points from `src/content/index.ts` and `src/background/service-worker.ts` into stable asset names.

### NOOS Hub (`apps/noos-hub`)

NOOS Hub is a lightweight Tauri v2 desktop control plane for local NOOS state:

- Frontend is plain TypeScript/Vite rather than React. `apps/noos-hub/src/main.ts` renders the shell, routes sections, calls Tauri commands, and handles update/sleep-recovery UI.
- Page renderers live in `apps/noos-hub/src/pages/`; shared HTML escaping helpers are in `src/ui/html.ts`, health/status types in `src/types.ts`, and update banner/dialog rendering in `src/update/render.ts`.
- The Tauri backend is `apps/noos-hub/src-tauri/src/main.rs`. It exposes local health/config/vault/action commands to the frontend and packages with Tauri updater support.
- Hub package scripts are under `apps/noos-hub/package.json`; root scripts wrap the common build/run/bundle flows.

### LLM Wiki (`apps/llm-wiki`)

`apps/llm-wiki` is a full React 19 + Tauri v2 desktop app for building and querying an LLM-maintained personal wiki:

- `apps/llm-wiki/src/App.tsx` is the app bootstrap: persisted settings, last-project loading, project switching, clip watcher, queue restoration, source-watch/scheduled-import setup, and sleep/resume recovery.
- `src/components/` is organized by feature surface: layout, chat, editor/preview, graph, sources, lint, review, settings, search, and project dialogs.
- `src/stores/` (Zustand) holds project/wiki/chat/review/update state; reset project-specific state before loading another project to prevent cross-project leakage.
- `src/lib/` contains the core wiki behavior: ingest queue/cache, LLM clients/providers, retrieval and context budgeting, graph relevance/insights, embedding/vector helpers, deep research, persistence, scheduled import, source lifecycle, file sync, and path/language utilities.
- `src/commands/` wraps Tauri IPC from the frontend. Backend command implementations live in `apps/llm-wiki/src-tauri/src/commands/`.
- `src-tauri/src/lib.rs` registers Tauri plugins/commands, starts the clip server, manages CLI subprocess state, applies proxy config, and implements sleep/resume backend status. Rust command modules cover filesystem/project operations, Claude/Codex CLI subprocess streaming, vector store access, file sync, and image extraction.
- LLM Wiki follows the Karpathy-style three-layer wiki project structure: immutable `raw/sources/`, generated `wiki/`, and schema/purpose/config files. App-private state is stored under `.llm-wiki/` inside a wiki project.

### NOOS metadata and scripts

- `.noos/` contains checked-in NOOS configuration, skills, agent registry, handoff/crystal folders, and runtime metadata. Do not treat the entire NOOS Vault as source code for normal tasks; follow the runtime/handoff rules above.
- `scripts/` contains shell and Node helpers for NOOS install/doctor/open/sync, sleep-resume diagnostics, Hub/Wiki launchers, release packaging, and extension project verification.
- `.github/workflows/release.yml` publishes release artifacts on `v*` tags, packages extension/NOOS skills, and conditionally signs NOOS Hub macOS updater artifacts.

## Development notes

- This is a multi-package repository without npm workspaces; use `npm --prefix ...` for app-local scripts.
- Keep Windows path behavior in mind. Existing code often normalizes paths to forward slashes for app data and browser-extension payloads.
- Root and app test suites use different Vitest versions/configurations. Run tests from the package whose code changed.
- Avoid scanning `apps/llm-wiki/node_modules/`; it is present in the tree and will overwhelm broad searches.
- Real LLM tests in LLM Wiki are intentionally separate from mocked tests and may require local API configuration.
