# NOOS Agent Coordination Board

This file is the shared coordination surface for multiple agent windows working on this repository. Keep it concise and factual. Do not put secrets, tokens, private account data, or full Vault dumps here.

## Current Objective

Make NOOS Shuttle and NOOS Hub reliable as a local-first context shuttle:

- Chatbot to Vault: capture Handoff and Crystal from ChatGPT and save them into NOOS Vault.
- Vault to Chatbot: browse/select Handoff and Crystal from Vault and attach them to ChatGPT chat or Project Sources.
- Vault to Agent: project selected context into `.noos/runtime/current/` for Codex / Claude Code / OpenCode.
- Agent to Vault: write clear result summaries that Hub can later ingest as Result or Crystal.

## Current Product Decisions

- Handoff = what to do next.
- Crystal = what has been distilled.
- Result = what this run produced.
- Artifact = what concrete file, image, table, or payload was carried.
- Shuttle should only inject, capture, show compact UI, and call Hub.
- Hub owns ingest, indexing, browsing, packaging, routing, and projection.
- Vault is long-lived local storage.
- Runtime Projection is temporary context for agents.
- Remote upload and Git sync require explicit user confirmation.
- Copy and Download remain fallback paths.
- Physical Vault folders are Hub-managed by object type and status in v0.
- User-facing organization should use virtual folders, search, tags, collections, latest lists, and source filters.

## Active Workstreams

| Workstream | Status | Owner Window | Notes |
| --- | --- | --- | --- |
| Shuttle Vault import picker | implemented | — | Virtual folders, search, multi-select, and shared feed action are on `main` |
| ChatGPT Project Sources import/export | acceptance pending | — | Implementation is on `main`; logged-in Chrome export regression remains |
| Reply-scoped generated image download | acceptance pending | — | Implementation is on `main`; verify selected/current-reply scope in logged-in Chrome |
| Hub ingest and local Vault | implemented | — | Hub saves, indexes, browses, and returns local Vault objects |
| Runtime Projection for agents | smoke-tested | — | Selected context can be projected into `.noos/runtime/current/` |
| Hub UX refactor | completed | — | Dashboard, four-section navigation, stacked adapters, toast/retry feedback are merged |
| Repository baseline verification | in progress | Claude Code | Running root, Hub, Wiki, and sleep/recovery checks after v0.1.6 metadata cleanup |

## Latest Context

- Product release baseline is `v0.1.6` at `aa07af9`; later docs/ignore commits are on `main`.
- The Hub UX refactor is merged and its handoff has moved to `done/`.
- The remaining active handoff is the Project Sources export and reply image work because logged-in Chrome acceptance is not yet recorded.
- Hub owns local Vault browsing through `/v1/vault/recent` and `/v1/vault/browse`; Shuttle keeps a compact recent list plus the larger picker.
- User-facing Vault organization continues to prefer virtual folders, search, tags, collections, latest lists, and source filters over arbitrary physical folder management.
- `.noos/runtime/current/` is temporary agent context and may be absent when no runtime task is active.
- See `.noos/context/briefs/2026-07-01-noos-shuttle-current-state.md` for the refreshed current-state snapshot.

## Coordination Protocol

When an agent starts work:

1. Read `AGENTS.md`.
2. Read this file.
3. Read `.noos/runtime/current/READ_ME_FIRST.md` if present.
4. Check `git status --short`.
5. Do not overwrite unrelated dirty changes.
6. Add a row or update a row in "Active Workstreams" only if you are actively changing that area.

When an agent changes code:

1. Keep edits scoped.
2. Record important implementation notes under "Implementation Notes".
3. Run the smallest relevant verification.
4. Record test results under "Verification Log".
5. Do not move active handoffs to done unless the user asks.

When an agent finishes:

1. Update "Handoff Notes For Next Agent".
2. Write or update `.noos/runtime/current/RESULT_SUMMARY.md` when working inside a runtime task.
3. Leave clear remaining issues.

## Implementation Notes

- Shuttle compact panel should show only latest objects and an obvious `Browse Vault` entry.
- The larger picker should become a virtual folder browser:
  - Latest
  - Handoffs / Active / Done / Archived
  - Crystals / Active / Curated / Archived
  - Results / Inbox / Accepted
  - Artifacts
  - Collections
  - Sources
- v0 compact panel renders grouped lists from Hub `/v1/vault/recent`.
- v0 larger picker calls Hub `/v1/vault/browse` with `folder` and `q` query parameters.
- The same `feedSelectedVaultObject` path handles current-chat injection and Project Sources attachment/download fallback.
- Selected objects should be attached as Markdown files when possible.
- Key input remains fallback, not the primary UI.

## Verification Log

| Date | Agent | Check | Result |
| --- | --- | --- | --- |
| 2026-05-22 | Codex | `npm run typecheck` | passed |
| 2026-05-22 | Codex | `npm test -- tests/content-ui-smoke.test.ts` | passed |
| 2026-05-22 | Codex | `cargo check --manifest-path apps/noos-hub/src-tauri/Cargo.toml` | passed |
| 2026-05-22 | Codex | `npm run build` | passed |
| 2026-05-22 | Codex | `scripts/noos-project-runtime.sh /Users/songfu/.noos/vault/crystals/active/20260521-noos-ai-64e4.md 20260522-vault-to-codex-smoke` | passed |
| 2026-05-22 | Codex | Read `.noos/runtime/current/READ_ME_FIRST.md`, `TASK.md`, `CONTEXT_PACK.md`, `FILE_MAP.md` and wrote `RESULT_SUMMARY.md` | passed |
| 2026-05-22 | Codex | Chrome extension reload through `chrome://extensions` | completed; live ChatGPT tab became temporarily unresponsive after reload |

## Handoff Notes For Next Agent

- The only active handoff is `.noos/handoffs/active/2026-06-05-project-sources-and-reply-images.md`; its remaining gap is logged-in Chrome acceptance, not implementation.
- Do not assume the recent-object list is enough for real Vault navigation; use Hub-owned browse/search for larger collections.
- Avoid making physical path the user-facing identity. Use `lookup_key` and object metadata.
- For ChatGPT Project Sources, prefer attaching Markdown files instead of pasting long content into the input box.
- If improving the picker, prioritize server-side pagination, richer filters/metadata, and keyboard navigation.
- Do not apply or drop `stash@{0}` without inspecting it first.
- Current architecture hotspots are `apps/noos-hub/src-tauri/src/main.rs` and `src/content/index.ts`; treat decomposition as planned product work, not opportunistic cleanup.
