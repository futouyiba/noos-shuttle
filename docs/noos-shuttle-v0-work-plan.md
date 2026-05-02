# NOOS Shuttle v0 Work Plan

Source design: `docs/noos-shuttle-v0-design-breakdown.md`

## Milestone 1: Local Extension Skeleton

Goal: load an unpacked browser extension and inject a visible floating control on ChatGPT.

Tasks:

- Create `noos-shuttle/` app directory.
- Add Chrome extension `manifest.json`.
- Add TypeScript build setup.
- Add content script entry.
- Inject a fixed-position floating button.
- Add minimal CSS isolation to avoid ChatGPT style collisions.

Acceptance:

- Extension can be loaded from `chrome://extensions`.
- Button appears on ChatGPT pages.
- Button does not shift page layout.

## Milestone 2: Generate Thread

Goal: click a menu action to insert the NOOS handoff prompt into ChatGPT input.

Tasks:

- Add compact popover with Generate, Capture, Save / Deliver, Settings.
- Implement ChatGPT input-box detection.
- Store the v0 prompt template in code.
- Insert the prompt into the input box.
- Default to manual submit.
- Add setting placeholder for auto-submit.

Acceptance:

- User can click Generate Thread and review the inserted prompt before sending.
- If the input box is not found, the UI shows a clear error.

## Milestone 3: Capture Thread

Goal: detect generated NOOS Thread markdown from the current conversation.

Tasks:

- Implement marker-based extraction:
  - `<!-- NOOS:THREAD:BEGIN -->`
  - `<!-- NOOS:THREAD:END -->`
- Support zero, one, or many detected threads.
- Parse title from `# Thread:`.
- Optionally parse YAML frontmatter.
- Show a preview panel inside the popover.

Acceptance:

- Capture returns the correct thread block when markers exist.
- No-marker and multiple-marker states are handled deliberately.
- Raw markdown is preserved for delivery.

## Milestone 4: Deliver Thread

Goal: save captured thread without depending on GitHub.

Tasks:

- Define `StorageAdapter`.
- Implement `ClipboardAdapter`.
- Implement `DownloadAdapter`.
- Add filename generation from date and title.
- Add placeholder `GitHubAdapter`.
- Add delivery error states and fallback buttons.

Acceptance:

- Captured thread can be copied.
- Captured thread can be downloaded as `.md`.
- GitHub is visible as future/disabled or placeholder behavior, without blocking copy/download.

## Milestone 5: Prototype Hardening

Goal: make the local prototype credible enough for repeated testing.

Tasks:

- Add unit tests for marker extraction.
- Add unit tests for filename generation.
- Test against a real ChatGPT conversation.
- Document install/run steps.
- Document known DOM and formatting limitations.
- Keep permissions minimal.

Acceptance:

- Core local workflow works end to end:
  `Generate -> ChatGPT output -> Capture -> Preview -> Copy/Download`.
- Known limitations are explicit.
- The repo is ready for a first implementation review.

## Task Dependencies

```text
Extension skeleton
  -> Floating UI
  -> Prompt injection
  -> Marker capture
  -> Preview
  -> Clipboard/download delivery
  -> GitHub adapter implementation
```

GitHub delivery depends on the storage abstraction but should not block the local prototype.

## Recommended First Implementation Slice

Build only the smallest useful vertical path:

1. `manifest.json`
2. content script mounted on ChatGPT
3. floating button and popover
4. Generate Thread prompt insertion
5. Capture Thread marker scan
6. Copy and Download

This slice proves the product's central behavior before adding auth, cloud delivery, or richer settings.
