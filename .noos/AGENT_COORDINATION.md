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
| Shuttle Vault import picker | implemented v0.2 | Codex | Large picker has virtual folders, search, multi-select, and shared feed action |
| ChatGPT Project Sources import | implemented v0.2 | User + Codex | Current chat and Project Sources share the same selected-object feed path |
| Hub ingest and local Vault | in progress | Codex | Hub saves Handoff/Crystal and returns local path/key; browse endpoint added |
| Runtime Projection for agents | smoke-tested | Codex | Real Crystal was projected into `.noos/runtime/current/` and consumed by Codex |
| Object model docs | in progress | Codex | See `docs/noos-vault-object-model.md` and system definition doc |

## Latest Context

- The user confirmed importing material into ChatGPT Project Sources has worked.
- The current weakness is selection UX when recent objects do not contain the desired Handoff or Crystal.
- The product needs a larger, folder-like Vault selection window.
- The selection area must support multi-select.
- Clicking a Vault item must not reset the Shuttle panel scroll position.
- Auto Copy / Auto Download / Auto Save to Vault toggles are too large and should stay compact.
- For knowledge organization, the current recommendation is virtual folders plus search rather than arbitrary user-managed physical folders.
- Hub now exposes `/v1/vault/browse` for authorized browser-side Vault browsing.
- Shuttle's larger Vault picker uses Hub folders/search when available and keeps recent-object import compact.
- A real Vault Crystal with key `20260521-noos-ai-64e4` was projected into a runtime task and read by Codex before implementation work.

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

- Do not assume the recent-object list is enough for real Vault navigation.
- Hub-owned Vault browse/search now exists. Next durable step is pagination/richer filters and surfacing the same object browser in Hub UI.
- Avoid making physical path the user-facing identity. Use `lookup_key` and object metadata.
- For ChatGPT Project Sources, prefer attaching Markdown files instead of pasting long content into the input box.
- If improving the picker, add keyboard navigation, richer metadata rows, and server-side pagination before Vault object counts grow large.
