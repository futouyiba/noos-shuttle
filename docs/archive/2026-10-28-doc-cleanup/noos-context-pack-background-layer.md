# NOOS Context Pack / Transcript Background Layer

> Status: design review and implementation breakdown
> Date: 2026-05-25
> Scope: local-first Context Pack for preserving full ChatGPT discussion context behind short handoffs and capsules

## 1. Summary Judgment

The proposed NOOS Context Pack direction is compatible with the current NOOS Shuttle design and fills a real gap.

Current NOOS Shuttle already has:

- `NOOS Thread` / handoff: downstream execution handoff, intentionally concise.
- `NOOS Crystal`: reusable discussion snapshot, also compressed.
- Browser Shuttle: ChatGPT-side capture and vault write path.
- NOOS Hub: local-first filesystem control plane.
- downstream skills: resolver and consumption protocol for coding agents.
- runtime projection: `.noos/runtime/current/` style task context for agents.

The missing layer is a preserved full-conversation background corpus that an agent can query without forcing the handoff to carry every detail. Context Pack should become that layer.

The core idea is sound:

```text
handoff / capsule = short navigation and execution entry
transcript.full.md = complete background corpus
transcript.index.json = searchable map into the corpus
key-excerpts.md = high-value original wording
execution-digest.md = execution result returned to discussion mode
```

This preserves the existing NOOS strategy: do not build an all-in-one AI product, do not make Browser Shuttle the source of truth, and keep NOOS as a local-first context and artifact hub.

## 2. Relationship To Existing Concepts

### 2.1 Handoff

Existing handoff files live under:

```text
.noos/handoffs/active/
.noos/handoffs/done/
```

They use `<!-- NOOS:THREAD:BEGIN -->` / `<!-- NOOS:THREAD:END -->` and `type: noos_thread`.

Context Pack should not replace handoff. It should contain or reference a handoff-sized entry file. A pack can generate `handoff.md`, but that file should remain short and may later be exported into `.noos/handoffs/active/` when the user wants a downstream agent to execute it.

### 2.2 Crystal

Crystal is a reusable discussion snapshot with confirmed conclusions, inferences, open questions, and next discussion entry points.

Context Pack is not the same object. It preserves both the compressed decision layer and the raw background layer. A crystal may be generated from a pack, and a pack may include crystal-like conclusions, but Context Pack should not be stored as a crystal.

### 2.3 Context Packet

`docs/noos-doc-forger.md` already defines `Context Packet` as a context delivery format sent to Chatbot / Agent for a specific task.

To avoid naming collision:

- `Context Packet`: outbound selected context for one task.
- `Context Pack`: stored background package containing transcript, index, excerpts, capsule, and digest.

The distinction should be documented clearly because the names are close.

### 2.4 Runtime Projection

Runtime projection is the active task view for a coding agent, such as:

```text
.noos/runtime/current/
  READ_ME_FIRST.md
  TASK.md
  CONTEXT_PACK.md
  FILE_MAP.md
  RESULT_SUMMARY.md
  sources/
```

Context Pack should feed runtime projection, not duplicate it. A runtime task may reference one or more Context Packs as source material. The agent should still follow runtime projection read order when it exists.

## 3. Conflict Check

No hard conflict was found with current repository design.

The proposal aligns with:

- local-first vault strategy;
- preserving handoffs as concise execution artifacts;
- Browser Shuttle / Hub separation;
- downstream skill-based consumption;
- agent read-order discipline;
- avoiding browser plugin or private ChatGPT API work in v0.

The proposal needs these adjustments before implementation:

1. Do not put Context Pack only under project `.noos/` by default.
2. Do not make `handoff.md` inside a pack automatically equivalent to an active handoff.
3. Do not imply `transcript.full.md` is safe to read by default.
4. Do not make LLM-generated `key-excerpts.md` the only source of evidence.
5. Do not rely on Codex CLI as the only plain-text backend.
6. Do not blur `Context Pack` and existing `Context Packet`.

## 4. Recommended Object Model

Use Context Pack as a first-class vault object.

User-level vault path:

```text
~/.noos/vault/context-packs/
  <YYYY-MM-DD>-<slug>/
    manifest.yaml
    handoff.md
    transcript.full.md
    transcript.index.json
    key-excerpts.md
    decision-capsule.md
    execution-digest.md
    attachments/
```

Project-level path, only when intentionally synced or created for repo-local work:

```text
.noos/context-packs/
  <YYYY-MM-DD>-<slug>/
```

This mirrors the handoff vault strategy: local vault first, project Git only when the pack is meant to become durable, shareable, or agent-consumable from the repo.

## 5. File Responsibilities

### 5.1 `manifest.yaml`

The manifest is the directory table of contents and policy file. Agents read it first.

Recommended fields:

```yaml
type: noos_context_pack
version: 0.1
id: ctx-20260525-chatbot-agent-transfer
title: ChatGPT 与 Agent 上下文传递改进
created_at: 2026-05-25
source_app: chatgpt
source_url: ""
capture_method: clipboard
status: active

files:
  handoff: handoff.md
  transcript: transcript.full.md
  index: transcript.index.json
  key_excerpts: key-excerpts.md
  decision_capsule: decision-capsule.md
  execution_digest: execution-digest.md

usage_policy:
  default_read_order:
    - manifest.yaml
    - handoff.md
    - decision-capsule.md
    - key-excerpts.md
    - transcript.index.json
  do_not_read_full_transcript_by_default: true
  read_transcript_only_when_needed: true

known_limits:
  - transcript may be manually copied and may not include hidden tool outputs
  - canvas edits and uploaded files may not be fully captured
```

Add later:

- `source_hash`
- `created_by`
- `repo_hint`
- `privacy_warnings`
- `schema`
- `attachments`
- `linked_objects`

### 5.2 `handoff.md`

Short navigation file. It should remain in the same spirit as existing NOOS Thread: concise enough for an agent to start.

Recommended sections:

```md
# Handoff: <title>

## Goal
## Background
## Current Conclusions
## Constraints
## Acceptance Criteria
## Next Tasks
## When You Need Full Background
```

It should explicitly say:

- read `transcript.index.json` before `transcript.full.md`;
- prefer `key-excerpts.md` for exact wording;
- do not ingest the full transcript unless the task needs it.

### 5.3 `transcript.full.md`

Complete captured discussion text.

Stable turn format:

```md
# Full Transcript: <title>

## T001 user

<raw text>

## T002 assistant

<raw text>
```

Parser quality can be low in v0. The important invariant is that the raw input is preserved. If role detection fails, store raw sections rather than dropping text.

### 5.4 `transcript.index.json`

A lightweight map from topics to turn ids.

The index should be treated as a navigation aid, not as authoritative truth. It may be generated by heuristic rules first and later refined by an LLM backend.

### 5.5 `key-excerpts.md`

Stores exact high-value wording. This file is the antidote to summary drift.

Rules:

- 5-20 excerpts.
- quote only the minimal necessary source text.
- always include source turn id.
- always include why the excerpt matters.
- do not turn it into a second long summary.

### 5.6 `decision-capsule.md`

The execution entry point. It should be shorter than `handoff.md` and more decision-focused.

Recommended sections:

```md
# Decision Capsule

## Problem
## Chosen Direction
## Rejected Alternatives
## Constraints
## Acceptance Criteria
## Open Questions
## Build-Agent Brief
```

Target size: about 400-800 Chinese characters for common packs.

### 5.7 `execution-digest.md`

The return path from coding agent to discussion mode.

Recommended sections:

```md
# Execution Digest

## Original Context Pack
## Completed
## Changed Files
## Validation
## Issues Found
## Decisions Needed
## Suggested Next Prompt for ChatGPT
## Suggested Next Prompt for Codex
```

Initial template:

```md
# Execution Digest

Pending.
```

## 6. CLI Design Review

The proposed command family is reasonable:

```sh
noos pack create --from-clipboard --title "..."
noos pack create --from-file ./chatgpt-transcript.md --title "..."
noos pack index <pack-path>
noos pack excerpts <pack-path>
noos pack capsule <pack-path>
noos pack query <pack-path> "<query>"
noos pack digest <pack-path> --git
```

Recommended v0 implementation order:

1. `create --from-file`
2. `create --from-clipboard`
3. raw transcript persistence
4. manifest generation
5. fallback handoff / capsule / excerpt templates
6. turn parser
7. `query`
8. `digest --git`
9. optional LLM backend for index / excerpts / capsule

`create --from-file` should come before clipboard because it is easier to test and works in CI.

## 7. Plain Text LLM Backend

The plain-text backend idea is correct but should be optional in v0.

Verified locally on 2026-05-25: the installed `codex exec --help` includes:

- `--ignore-user-config`: do not load `$CODEX_HOME/config.toml`; auth still uses `CODEX_HOME`.
- `--ignore-rules`: do not load user or project execpolicy `.rules` files.

Those flags are suitable for a controlled text-only backend, but they do not fully turn Codex into a pure function. A wrapper must also control:

- working directory;
- prompt;
- output schema or expected format;
- network/shell permissions when available;
- timeout;
- max input size;
- error fallback.

Recommended abstraction:

```text
PlainTextLLMBackend
  generateIndex(input) -> transcript.index.json
  generateExcerpts(input) -> key-excerpts.md
  generateCapsule(input) -> decision-capsule.md
  generateDigest(input) -> execution-digest.md
```

Backend implementations:

- `none`: writes Pending templates and heuristic index.
- `codex-cli`: uses isolated `codex exec`.
- future: OpenAI API, local model, Claude Code, OpenCode.

Do not make Codex CLI mandatory for pack creation.

## 8. Browser Shuttle Transcript Capture

ChatGPT Data Export should not be the primary Context Pack source.

The preferred product path is Browser Shuttle capture:

```text
Generate / collect handoff
  -> if "Capture full transcript" is enabled
  -> extract the current ChatGPT conversation from the page
  -> convert visible conversation HTML into transcript Markdown
  -> save it as transcript.full.md inside a local Context Pack
  -> save the handoff as the short entry file
```

This fits the current extension architecture better than account-level export:

- it is single-conversation;
- it happens at the same moment the handoff is captured;
- it can preserve the actual user/assistant turn sequence;
- it can keep the local-first Hub write path;
- it does not depend on private ChatGPT APIs.

Current official Help Center guidance says ChatGPT Data Export downloads as a zip, includes chat history and other account data, is delivered by email, and the email link expires after 24 hours. That still matters as a boundary check: Data Export is useful for later bulk import or recovery, but it is not the right v0 mechanism for frequent Context Pack handoff.

### 8.1 Feasibility In The Extension

This is feasible in Browser Shuttle, but it must be built as a tested extraction pipeline rather than a single `innerText` dump.

The existing content script already has a useful starting point:

- it queries `main`, which helps avoid sidebar capture;
- it has a small HTML-to-Markdown renderer;
- it preserves HTML comments, which is important for marker-based handoff capture;
- it ignores the NOOS panel and composer inputs.

That is enough for handoff marker capture, but not enough for high-quality full transcript capture. Full transcript capture needs:

- conversation container discovery;
- turn boundary detection;
- role detection for user and assistant;
- HTML-to-Markdown conversion for each message body;
- code block, list, table, quote, link, image, and math handling;
- stable turn ids such as `T001 user`;
- completeness checks for long conversations;
- test fixtures based on representative ChatGPT DOM snapshots.

### 8.2 HTML To Markdown Requirements

`transcript.full.md` should not be plain page text. It should be structured Markdown:

```md
# Full Transcript: <title>

## T001 user

<message markdown>

## T002 assistant

<message markdown>
```

The converter should preserve:

- headings;
- paragraphs;
- bullet and numbered lists;
- fenced code blocks with language when available;
- inline code;
- blockquotes;
- links as Markdown links;
- tables when possible;
- image/file placeholders with alt text or filename when available;
- visible warnings such as "content omitted" if the UI exposes them.

The converter should avoid:

- sidebar conversations;
- navigation text;
- model picker text;
- composer draft text;
- extension UI text;
- hidden or `aria-hidden` content;
- duplicate rendered text from copy buttons, toolbars, and message actions.

### 8.3 Long Conversation Completeness

The hard part is long ChatGPT conversations. The web app may only keep part of the conversation rendered, or it may restore older turns as the user scrolls. Therefore Browser Shuttle should treat transcript capture as a stateful process:

```text
start from current conversation main container
  -> collect visible turn signatures
  -> scroll toward top until stable top is reached
  -> collect turn signatures again
  -> scroll toward bottom until stable bottom is reached
  -> collect final visible/rendered turns
  -> report completeness status
```

Recommended completeness signals:

- scroll container `scrollTop` reaches 0 and remains stable after waiting;
- repeated scroll-up attempts no longer add earlier turn signatures;
- first visible turn remains the same after several top probes;
- bottom probe returns to the latest assistant/user turn seen before capture;
- DOM mutation observer sees no new conversation turns after a settle window;
- total turn signatures stop changing after repeated probes.

Turn signatures should be based on role plus normalized first/last text, not DOM node ids, because app-rendered ids can be unstable.

If the extension cannot prove completeness, it should still save the pack but mark the transcript as partial:

```yaml
capture_quality:
  transcript_completeness: partial
  reason: unable_to_confirm_top_of_conversation
  captured_turn_count: 42
```

The UI should show a warning before saving or syncing:

```text
Full transcript may be incomplete. Older turns may not be loaded in the page.
```

### 8.4 Capture Scope

The capture scope should be the active conversation only.

Rules:

- start from `main` or a more precise conversation container under `main`;
- exclude `nav`, `aside`, headers, sidebars, settings panels, modals, composer, and NOOS UI;
- never scan the whole `document.body` for transcript content unless as a last-resort diagnostic;
- include the visible role for each message;
- normalize ChatGPT's "You" / localized user label to `user`;
- normalize ChatGPT / assistant labels to `assistant`;
- preserve any model or tool-visible labels only as metadata if they are tied to a turn.

### 8.5 UI Option

Add an explicit option near handoff collection:

```text
[ ] Capture full conversation transcript
```

When enabled:

- `Generate & Collect` captures the handoff as today;
- then the extension runs the transcript capture pipeline;
- then it saves a Context Pack through Hub;
- if Hub is unavailable, it can fall back to a Downloads mirror under `~/Downloads/NOOS/vault/context-packs/`;
- if transcript capture is partial, the handoff can still be saved, but the pack manifest records the warning.

Do not make this option default until the extraction is proven with fixtures and live browser tests.

Implementation note, 2026-05-25:

- Browser Shuttle now includes a `Capture full conversation transcript` option.
- When enabled, `Save 2 Vault` writes a multi-file Context Pack instead of only the handoff.
- The extractor uses `data-message-author-role` and conversation-turn DOM markers when present, normalizes turns to `T001 user` / `T002 assistant`, and excludes sidebar, composer, action buttons, and NOOS UI.
- The scroll-probe path attempts top and bottom capture, but marks the pack partial when ChatGPT's page does not expose a reliable programmatic scroll container.
- Live Chrome validation against an already-open ChatGPT page detected rendered user/assistant roles under `main` and confirmed sidebar text was excluded. It also showed that `main.scrollTop` may be read-only or ineffective on current ChatGPT pages, so partial-completeness metadata is required rather than optional.

## 9. Design Issues To Fix Before Coding

### 9.1 Storage Ownership

The proposal uses `.noos/context-packs/` as the main example. That is acceptable for repo-local packs, but the primary write path should be the user vault:

```text
~/.noos/vault/context-packs/
```

Reason: ChatGPT transcripts may include private or cross-project information. They should not land in a Git repository by default.

### 9.2 Privacy And Git

`noos pack digest --git` is safe because it summarizes local execution state. `noos pack create` is more sensitive because it captures raw conversation text.

Do not auto-sync Context Packs to Git. Add explicit user action later:

```sh
noos pack sync --to-project <pack-path>
```

### 9.3 Handoff Lifecycle

If `handoff.md` is inside a pack, it is not automatically an active handoff. Active handoffs remain under `.noos/handoffs/active/`.

Add a later explicit command:

```sh
noos pack export-handoff <pack-path> --to-repo
```

### 9.4 Query Semantics

`noos pack query` should return original turn snippets with turn ids, not just summaries.

Minimum output:

```text
Matched topics:
- ...

Turns:
## T012 user
...

## T013 assistant
...
```

### 9.5 LLM Failure

Pack creation must never fail just because index/excerpts/capsule generation fails. The raw transcript and manifest are the durable value.

### 9.6 Sensitive Information Warnings

v0 should warn, not silently scrub.

Initial detectors:

- API key-like tokens;
- `Bearer ...`;
- cookies;
- emails;
- phone numbers;
- private keys.

Store warnings in `manifest.yaml` and optionally in `privacy-warnings.md`.

## 10. Implementation Breakdown

### Phase 0: Documentation And Schema

Deliver:

- this design note;
- JSON/YAML shape for manifest;
- sample pack under test fixtures only;
- README section linking Context Pack to handoff/crystal/runtime projection.

### Phase 1: Local Deterministic Pack Creation

Deliver:

- CLI command scaffold;
- `create --from-file`;
- `create --from-clipboard`;
- slug and id generation;
- manifest writer;
- raw transcript writer;
- basic parser that creates `T001`, `T002`, etc. when possible;
- fallback raw transcript when parsing fails;
- template `handoff.md`;
- template `decision-capsule.md`;
- template `key-excerpts.md`;
- template `execution-digest.md`.

No LLM dependency in this phase.

### Phase 2: Query And Digest

Deliver:

- `noos pack query`;
- keyword and topic search over `transcript.index.json`;
- fallback search over `transcript.full.md`;
- turn extraction by id;
- `noos pack digest --git`;
- graceful behavior outside a git repo.

### Phase 3: Optional LLM Generation

Deliver:

- `PlainTextLLMBackend`;
- `none` backend;
- `codex-cli` backend;
- prompts for index / excerpts / capsule / digest;
- output validation;
- failure fallback.

### Phase 4: Agent Consumption Protocol

Deliver:

- `noos-consume-context-pack` skill or extension of `noos-consume-handoff`;
- AGENTS.md guidance for pack read order;
- runtime projection integration;
- result summary / execution digest writeback.

Recommended read order:

1. `manifest.yaml`
2. `handoff.md`
3. `decision-capsule.md`
4. `key-excerpts.md`
5. `transcript.index.json`
6. targeted turns from `transcript.full.md`

### Phase 5: Browser Shuttle Integration

Deliver after deterministic CLI support or in parallel as a Browser Shuttle prototype:

- UI option: `Capture full conversation transcript`;
- active conversation container detection under `main`;
- turn extraction with `T001 user` / `T002 assistant` output;
- HTML-to-Markdown converter improvements;
- long conversation scroll/probe capture;
- partial-completeness warnings in `manifest.yaml`;
- save Context Pack to Hub local vault;
- Downloads mirror fallback;
- privacy warning before project Git sync.

This should be built with a fixture-first loop. Do not ship it as default behavior until representative ChatGPT conversations pass extraction tests.

Recommended Browser Shuttle implementation sequence:

1. Extract currently rendered visible turns only.
2. Convert each turn into structured transcript Markdown.
3. Add fixture tests for simple user/assistant turns.
4. Add fixture tests for code blocks, lists, links, tables, and quotes.
5. Add role detection tests for English and Chinese UI labels.
6. Add exclusion tests for sidebar, composer, action buttons, and NOOS panel.
7. Add live-browser manual test script for a short conversation.
8. Add scroll-up and scroll-down probes for long conversations.
9. Add completeness metadata and partial warnings.
10. Wire the option into `Generate & Collect`.
11. Save the output as a Context Pack through Hub.
12. Add a live-browser regression checklist before enabling auto-save.

Recommended capture metadata:

```yaml
capture:
  method: browser_shuttle_dom
  page_url: https://chatgpt.com/c/...
  captured_at: 2026-05-25T12:00:00+08:00
  rendered_turn_count: 42
  transcript_completeness: complete
  top_reached: true
  bottom_reached: true
  partial_reasons: []
  excluded_regions:
    - sidebar
    - composer
    - noos_shuttle_panel
```

If completeness is uncertain:

```yaml
capture:
  transcript_completeness: partial
  top_reached: false
  bottom_reached: true
  partial_reasons:
    - no_new_turns_after_scroll_but_scroll_top_not_zero
```

## 11. Test Plan

Required tests:

1. create pack from sample transcript file;
2. create pack from malformed text and still preserve `transcript.full.md`;
3. create pack from text containing `NOOS:THREAD` marker and extract short `handoff.md`;
4. manifest file paths match generated files;
5. query returns expected turn id and original text;
6. digest works in a fake git repo;
7. digest gracefully reports no git repo;
8. LLM backend failure does not abort pack creation;
9. sensitive string detector writes warnings without deleting source text.

## 12. Recommended Near-Term Decision

Adopt the proposal with the storage and naming adjustments above.

The clean v0 product line is:

```text
ChatGPT conversation text
  -> NOOS Context Pack in local vault
  -> short handoff / decision capsule for agent
  -> targeted transcript lookup only when needed
  -> execution digest after coding work
  -> discussion continues in ChatGPT or another agent
```

This is lower risk than building a full Chat mode, forking a coding agent, or depending on private ChatGPT interfaces. It extends the current NOOS object model instead of replacing it.

## 13. References Checked

- Repository docs: `README.md`, `docs/noos-downstream-integration.md`, `docs/noos-handoff-vault-strategy.md`, `docs/noos-thread-format.md`, `docs/noos-doc-forger.md`.
- Local CLI check: `codex exec --help` on 2026-05-25.
- OpenAI Help Center: [How do I export my ChatGPT history and data?](https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history)

## 14. Validation Notes

Automated validation:

- `npm test`
- `npm run typecheck`
- `npm run build`
- `cargo fmt --manifest-path apps/noos-hub/src-tauri/Cargo.toml -- --check`
- `cargo check --manifest-path apps/noos-hub/src-tauri/Cargo.toml`
- `bash -n scripts/noos-install.sh scripts/noos-import-browser-vault.sh`

Live local validation against an already-open logged-in ChatGPT page:

1. Chrome tab discovery found `https://chatgpt.com/c/69f475fa-891c-83a6-9b46-693c29963ed5`.
2. Read-only DOM inspection found rendered `data-message-author-role` turns under `main`.
3. Extracted 11 rendered turns from the live page.
4. Confirmed a sidebar sample string was not present in `main` transcript extraction.
5. Started NOOS Hub locally and POSTed `kind: "context_pack_file"` records to `http://127.0.0.1:17642/v1/handoffs`.
6. Verified Hub wrote all Context Pack files under:

```text
~/.noos/vault/context-packs/chatgpt-live-20260524172549-llm-metaphors/
```

Verified files:

```text
manifest.yaml
handoff.md
transcript.full.md
transcript.index.json
key-excerpts.md
decision-capsule.md
execution-digest.md
```

The generated `transcript.full.md` contained `T001 user` through `T011 assistant` and was about 67 KB.

Remaining UI validation requires reloading the installed unpacked NOOS Shuttle Chrome extension so the already-open ChatGPT page receives the newly built content script. Until that reload is explicitly approved, the live page still shows the old Browser Shuttle UI and does not expose `Capture full conversation transcript`.
