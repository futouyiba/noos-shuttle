# NOOS System Definition And Design Orientation

This document consolidates the current thinking, product definitions, development direction, and design decisions for NOOS. It is intentionally written as a stable reference for humans and agents.

## One Sentence

NOOS is a local-first operating layer that lets Chatbots, coding agents, browser sessions, files, and future tools pass context, tasks, knowledge, and results to each other without losing provenance.

## Product Shape

NOOS is not only a browser extension and not only a desktop app. It is a system made of several cooperating parts:

- NOOS Shuttle: browser connector for ChatGPT, Claude, Gemini, and other web Chatbots.
- NOOS Hub: local desktop center that owns Vault, indexing, packaging, routing, and local write access.
- NOOS Vault: local Markdown-first information asset store.
- Agent Skills: Codex, Claude Code, OpenCode, and similar agents consume NOOS context through simple files or skills.
- Runtime Projection: temporary task context exposed to coding agents as a natural file structure.
- Prompt Pack / Context Pack: packages that move selected Vault material back into Chatbots.
- Installers and release artifacts: scripts and packaged outputs that make the system installable.

## Core Product Belief

The value of NOOS is not "saving text." The value is preserving useful working state so that another agent, another Chatbot, or the same user in a later session can continue from the right context.

This creates two product requirements:

1. Captured content must become clear objects.
2. Objects must be easy to retrieve, project, and feed forward.

## Core Objects

The primary object meanings should stay simple:

| Object | Plain Meaning | Product Role |
| --- | --- | --- |
| Handoff | What to do next | Task continuation object |
| Crystal | What has been distilled | Reusable knowledge object |
| Result | What this run produced | Returned output object |
| Artifact | What concrete file or image was carried | File or binary object |

Supporting objects:

| Object | Purpose |
| --- | --- |
| Thread | Groups objects from one Chatbot conversation or project thread |
| Brief | Compact explanation for humans or agents |
| Reference | External product, pattern, anti-pattern, or flow sample |
| Skill | Reusable agent workflow |
| Context Pack | Selected source material for a task |
| Prompt Pack | Chatbot-facing prompt rendered from a Context Pack |
| Runtime Projection | Temporary file projection for coding agents |

## Object Rules

Every saved object must have:

- `object_id`: machine-stable identity.
- `lookup_key`: human-copyable and agent-searchable key.
- `path`: current file path.
- `type`: object type.
- `source`: app, URL, conversation, and capture metadata when available.
- `created_at`: creation timestamp.

Identity rules:

- `object_id` is immutable.
- `lookup_key` is stable and user-facing.
- `path` is mutable.
- `title` is mutable.
- `source_url` is provenance, not identity.

Recommended key format:

```text
YYYYMMDD-topic-slug-shortcode
```

Example:

```text
20260522-noos-vault-navigation-a7f3
```

## Handoff, Crystal, Result, Artifact

Handoff should answer:

- What is the task?
- What has already been decided?
- What constraints matter?
- What should the next agent do?
- What does completion look like?

Crystal should answer:

- What reusable conclusion was distilled?
- Why is it true or useful?
- What should future work remember?
- What source produced it?

Result should answer:

- What did this run produce?
- Which Prompt Pack, Context Pack, Handoff, or Crystal caused it?
- Should it be accepted, promoted, archived, or discarded?

Artifact should answer:

- What file or image exists?
- Which object references it?
- Where is it stored?
- What metadata or sidecar explains it?

## Development Direction

The current product should prioritize the shortest useful loop:

1. Chatbot generates Handoff or Crystal with NOOS markers.
2. Shuttle captures the object from the page.
3. Shuttle sends it to Hub.
4. Hub validates, assigns key, saves file, updates index, and returns a receipt.
5. User or agent can find the object by key, latest list, search, or projected task context.
6. Hub can package selected objects and feed them back to Chatbot through Shuttle.
7. Coding agents consume projected files rather than learning a complex NOOS protocol.

The next product layer is bidirectional:

- Chatbot to Vault: capture Handoff, Crystal, Result, Artifact.
- Vault to Chatbot: select objects, create Prompt Pack, inject or attach into current Chatbot/project.
- Vault to Agent: create Runtime Projection and ask Codex / Claude Code / OpenCode to read it.
- Agent to Vault: write Result Summary, then Hub can save or promote it.

## Design Orientation

NOOS should feel like a local operating center, not a generic knowledge base. The UI should expose tasks instead of internal plumbing.

Good visible actions:

- Generate and collect Handoff.
- Extract Crystal.
- Save to Vault.
- Browse Vault.
- Send to current Chatbot.
- Add to ChatGPT Project Sources.
- Create runtime context for Codex.
- Sync Handoffs to Git.

Internal or advanced concepts should not dominate the first screen:

- token.
- endpoint.
- adapter checks.
- exact browser mirror path.
- object graph internals.
- idempotency key.

## Shuttle Responsibilities

Shuttle should remain narrow:

- detect supported Chatbot pages.
- inject prompts or attached files.
- capture markerized outputs.
- show compact state.
- provide fallback copy/download.
- call Hub APIs.

Shuttle should not own:

- complex knowledge organization.
- long-term indexing.
- object promotion.
- graph maintenance.
- Git sync.
- model-based summarization.

## Hub Responsibilities

Hub owns:

- local Vault.
- object ingest transaction.
- key and path generation.
- indexes.
- recent object lists.
- browse and search UI.
- Prompt Pack and Context Pack generation.
- Runtime Projection generation.
- Git sync as explicit action.
- local write server.
- diagnostics.

## Ingest Transaction

"Auto Save to Vault" is not a simple button action. It is an ingest transaction:

```text
capture -> validate -> assign key -> persist file -> update index -> return receipt
```

The receipt should include:

- `ok`
- `object_type`
- `object_id`
- `lookup_key`
- `path`
- `status`
- `content_hash`
- `warnings`
- `next_actions`

Failure should always keep fallback paths:

- copy text.
- download file.
- save to Browser Vault Mirror.
- retry Hub.
- open Hub.

## Vault Storage: Folders Or Search?

The physical Vault should not become a user-managed maze of arbitrary folders in v0.

Recommended v0 rule:

- Hub owns physical storage by object type and status.
- Users browse by virtual folders, recent lists, search, tags, source, and saved collections.
- Objects remain findable by stable `lookup_key`, not by path.

Physical v0 layout should stay predictable:

```text
~/.noos/vault/
  handoffs/
    active/
    done/
    archived/
  crystals/
    active/
    curated/
    archived/
  results/
    inbox/
    accepted/
    archived/
  artifacts/
    files/
    sidecars/
    thumbs/
  index/
    keys.json
    objects.json
    graph.json
    backlinks.json
```

The user-facing browser should look folder-like, but it should be virtual:

```text
NOOS Vault
  Latest
  Handoffs
    Active
    Done
    Archived
  Crystals
    Active
    Curated
    Archived
  Results
    Inbox
    Accepted
  Artifacts
  Collections
    Current Project
    Fishing Economy
    Shuttle v0.2
  Sources
    ChatGPT
    Codex
    Claude
```

Why virtual folders are better for v0:

- Handoff and Crystal already have strong object types.
- Status directories are easy for Hub and agents to reason about.
- User-made physical folders create path churn, broken references, and sync conflicts.
- A single object may belong to multiple mental folders.
- Search, tags, source URL, graph relations, and collections represent knowledge better than one physical folder.

What users should be allowed to create:

- collections.
- saved searches.
- tags.
- project scopes.
- pinned objects.

What should be delayed:

- arbitrary physical folder moves inside core object stores.
- nested user folders as primary identity.
- path-based references.

Long-term option:

- support optional user folders as collections backed by metadata, not as object identity.
- if physical custom folders are added later, `lookup_key` and `object_id` must remain canonical, and Hub must maintain aliases and backlinks.

## Vault Browser UX

When importing Handoff or Crystal into ChatGPT, recent items are necessary but not sufficient. As the Vault grows, the user needs a larger picker.

Recommended UI:

- compact Shuttle panel shows latest few items.
- "Browse Vault" opens a larger modal.
- modal supports multi-select.
- modal shows virtual folders, latest, search, and object type filters.
- selection should not reset scroll position.
- selected objects can be attached to current chat or added to Project Sources.
- key remains a fallback input, not the only path.

For v0, a flat recent modal with type groups is acceptable. The next step is a virtual folder tree plus search.

## Runtime Projection

Coding agents should not need to learn NOOS internals. NOOS should project context into files they already know how to read:

```text
.noos/runtime/tasks/<task-key>/
  READ_ME_FIRST.md
  TASK.md
  CONTEXT_PACK.md
  FILE_MAP.md
  GRAPH.md
  GRAPH.json
  SOURCES.md
  READ_LOG.md
  RESULT_SUMMARY.md
  sources/
  artifacts/
  output/
```

Agent first-read order:

1. `READ_ME_FIRST.md`
2. `TASK.md`
3. `CONTEXT_PACK.md`
4. `FILE_MAP.md`
5. selected files under `sources/`

The projection should copy or excerpt selected files. It should not expose the full Vault by symlink.

## Prompt Pack Direction

Hub to Shuttle to Chatbot is more complex than ingest. v0 should stay conservative:

1. Hub creates pending Prompt Pack.
2. Shuttle detects current supported Chatbot page.
3. User explicitly clicks inject or attach.
4. Shuttle inserts text or attaches Markdown files.
5. Chatbot is asked to return a markerized `NOOS:RESULT`.
6. Shuttle captures Result and sends it back to Hub.

Avoid in v0:

- automatic page opening.
- automatic project selection.
- automatic remote upload without confirmation.
- automatic attachment upload without user visibility.
- complex image/file upload protocols.

## Security And Privacy

NOOS is local-first:

- default save target is local Vault.
- Git sync is explicit.
- cloud or remote upload requires confirmation.
- API keys stay local and out of repo.
- Copy and Download always remain fallback.

The Hub local write channel uses local trust:

- localhost only.
- token required for write endpoints.
- marker validation required for object ingest.
- filename/path sanitization required.
- body size limits required.

Risk remains: a malicious local process under the same OS user could request local token. This is accepted for v0 as a local-trust product tradeoff, not a high-security boundary.

## Current Priorities

P0:

- stable Handoff generate and collect.
- stable Crystal capture and save.
- markerized output.
- Hub ingest and index.
- latest object list and Vault browser.
- ChatGPT Project Sources import.
- Runtime Projection for Codex.

P1:

- richer Vault browser with search and virtual folder tree.
- Result capture.
- Prompt Pack generation.
- Context Pack builder.
- recent saved object list in Hub.
- Git sync button.

P2:

- Reference Library.
- model-assisted naming and summaries.
- OpenRouter/OpenAI/local model provider abstraction.
- CLI commands like `noos open`, `noos search`, `noos project`.
- MCP server.

## Product Risks

| Risk | Symptom | Response |
| --- | --- | --- |
| Hub feels like extra burden | User sees "Hub unavailable" too often | Auto-launch or make Browser Mirror import painless |
| Browser capture is brittle | ChatGPT DOM changes break flows | Marker scanning, smoke tests, manual recovery |
| Object model is too complex | Users confuse Handoff, Crystal, Result | UI uses plain actions and short definitions |
| Vault becomes junk drawer | Many uncurated files accumulate | inbox/curated lifecycle, promotion workflow |
| Agents ignore context | Codex starts without reading projected files | Runtime Projection plus AGENTS.md instructions |
| Prompt Pack pollutes chat | Chatbot thread becomes noisy | preview, attachments, dedicated project/source flows |
| Users cannot find old material | recent list is not enough | Vault browser, search, tags, collections, virtual folders |

## Short Definitions For UI

- Handoff: next work.
- Crystal: saved insight.
- Result: returned output.
- Artifact: attached file.
- Vault: local NOOS library.
- Runtime Projection: temporary agent workspace.
- Context Pack: selected context.
- Prompt Pack: context rendered for Chatbot.

