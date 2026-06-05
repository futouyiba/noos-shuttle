<!-- NOOS:THREAD:BEGIN -->
---
type: noos_thread
version: 0.1
handoff_revision: v1
source_app: codex
source_url: ""
target_agent: main-agent
status: active
created_at: 2026-06-05
title: NOOS Shuttle Project Sources Export and Reply Image Download
tags: [noos-shuttle, chatgpt-project-sources, artifacts, browser-extension, handoff]
preferred_path: .noos/handoffs/active/2026-06-05-project-sources-and-reply-images.md
---

# NOOS Shuttle Project Sources Export and Reply Image Download

## Intent

Hand off the latest NOOS Shuttle browser-extension changes to the main agent so it can continue product review, live Chrome testing, release work, or follow-up implementation.

## Context Summary

Two user-facing needs were addressed in the current working tree:

1. ChatGPT Project sources should be exportable into NOOS instead of only supporting the reverse flow from NOOS into Project sources.
2. ChatGPT-generated images should be downloadable through NOOS Shuttle, but only for a selected/current reply rather than every image on the whole page.

The implementation is local-first and uses the existing extension background messaging and Browser Vault Mirror paths. Hub binary artifact ingest is not yet implemented, so generated image download currently saves through Chrome downloads into the NOOS mirror under Downloads.

## What Changed

### Project sources export

Implemented a new Project page button next to the existing `从 NOOS 导入` / `Import from NOOS` button:

- Chinese label: `导出项目源到 NOOS`
- English label: `Export sources to NOOS`

The export scans the visible ChatGPT Project sources area and saves a sources snapshot package through the existing context-pack save path:

- `README.md`
- `manifest.md`
- `sources/001-*.md` stub files

The package records visible source titles, links when present, source URL, capture time, and provenance.

Important limitation: this v0 does not claim to download original uploaded file bytes from ChatGPT Project sources. The ChatGPT DOM currently exposes visible source entries, not stable original file bytes. The snapshot preserves a reliable inventory that NOOS and agents can use.

### Reply-scoped image download

Added a Shuttle panel button:

- Chinese label: `下载本条回复图`
- English label: `Download Reply Images`

The image download no longer scans the whole page by default. Scope resolution now works as follows:

1. If an image modal or carousel dialog is open, download images from that dialog.
2. If the user has selected text inside a ChatGPT reply, download only generated images inside that selected reply scope.
3. Otherwise, choose the current viewport's closest reply-like container that contains generated images.

Generated image filtering excludes small images, avatar/icon/logo-like images, and caps downloads to 20 images. `blob:` URLs are converted to data URLs in the content script before passing to the background worker. Normal `https:` and `data:` image URLs are passed directly.

Downloaded images go to:

```text
Downloads/NOOS/vault/artifacts/files/chatgpt-images/<date-title>/
```

This is currently Browser Vault Mirror, not direct Hub binary ingest.

## Files Changed

- `src/content/index.ts`
  - Added Project sources export button and snapshot package generation.
  - Added reply-scoped generated image collection and download action.
  - Added scope selection logic for dialog, selected reply, and current viewport reply.
- `src/background/service-worker.ts`
  - Added `NOOS_DOWNLOAD_ARTIFACTS` message handling.
  - Added Chrome downloads mirror save path for artifact images.
- `src/shared/i18n.ts`
  - Added Chinese and English labels/messages for source export and reply image download.
- `tests/content-ui-smoke.test.ts`
  - Added smoke coverage for Project sources export.
  - Added smoke coverage proving image download only uses the selected reply scope.

## Verification

The following checks were run successfully before this handoff:

- `npm run typecheck`
- `npm test -- tests/content-ui-smoke.test.ts`
- `npm test`
- `npm run build`
- `git diff --check`

At handoff creation time, the latest full test run passed:

- 8 test files passed
- 49 tests passed

## Suggested Next-Agent Instructions

1. Inspect the working tree and commit if not already committed.
2. If using the user's Chrome profile, reload the unpacked extension from the repo `dist/` directory.
3. Live-test on a ChatGPT conversation that has multiple generated images in one response:
   - Select text inside the target reply.
   - Click `下载本条回复图`.
   - Confirm only that reply's images download.
4. Live-test on a ChatGPT Project page:
   - Locate Project sources.
   - Click `导出项目源到 NOOS`.
   - Confirm a context-pack-like folder appears in `Downloads/NOOS/vault/context-packs/chatgpt-project-sources/...` or local Vault if Hub import path is used.
5. Consider next implementation step: direct Hub artifact ingest for binary files, so image artifacts can land in `~/.noos/vault/artifacts/files/...` without using Downloads mirror.

## Open Questions

1. Should generated image downloads get a sidecar metadata file per image in v1?
2. Should image artifact export attempt to import the Downloads mirror into Hub automatically when Hub is running?
3. Can ChatGPT Project sources expose stable original file download URLs in some layouts or authenticated APIs, or is visible-source snapshot the correct v0 boundary?
4. Should the reply image button be hidden unless the current page contains candidate images?

<!-- NOOS:THREAD:END -->
