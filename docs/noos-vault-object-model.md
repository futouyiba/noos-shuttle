# NOOS Vault Object Model

NOOS Vault is the local-first information asset store maintained by NOOS Hub. It is Markdown-first, Git-friendly, and designed for both people and agents: objects can be read directly, indexed by Hub, projected into coding-agent workspaces, and packaged for Chatbot injection through Browser Shuttle.

## Design Principles

1. Make objects clear before adding more features.
2. Every persisted object must have `object_id`, `lookup_key`, `path`, `type`, `source`, and `created_at` in the Hub index.
3. Browser Shuttle only injects into web pages and captures markerized output; it does not own complex knowledge organization.
4. NOOS Hub owns ingest, indexing, packaging, feeding, routing, and local Vault management.
5. Chatbot outputs must be markerized before they become reliable NOOS objects.
6. Handoff is what to do next, Crystal is what has been distilled, Result is what this run produced, and Artifact is the concrete file or image being carried.
7. Vault is long-lived storage; Runtime Projection is temporary context prepared for agents.
8. Local-first is the default. Remote upload, Git sync, or cloud publication requires user confirmation.
9. Copy and Download are always available as fallback paths.
10. MCP is not a v0 dependency. First make local files plus the Hub/Shuttle protocol reliable.

## Core Objects

The four primary object meanings are intentionally simple:

- Handoff: what to do next.
- Crystal: what has already been distilled.
- Result: what this run produced.
- Artifact: what concrete file, image, table, or payload was generated or carried.

| Object | Class | Purpose | Lifecycle | Long-lived | Searchable | Feedable |
| --- | --- | --- | --- | --- | --- | --- |
| Handoff | Task | Transfer a task to a downstream agent | `active -> done -> archived` | Medium | Yes | Yes |
| Crystal | Knowledge | Preserve reusable conclusions or design judgments | `active -> curated -> archived` | Long | Yes | Yes |
| Result | Task / Artifact | Store output returned by a Chatbot or agent | `inbox -> accepted -> promoted/archived` | Conditional | Yes | Yes |
| Artifact | Artifact | Store images, PDFs, tables, screenshots, patches, and files | `captured -> linked -> archived` | Conditional | Metadata | Conditional |
| Context Pack | Protocol | Collect selected context for an agent or Chatbot | `draft -> active -> archived` | Regenerable | Yes | Yes |
| Prompt Pack | Protocol | Render a Chatbot-ready prompt from a Context Pack | `draft -> sent -> result_received/archived` | Short | Yes | Yes |
| Brief | Knowledge | Provide a compact summary for people and agents | `draft -> active -> archived` | Long | Yes | Yes |
| Skill | Protocol / Knowledge | Define reusable agent behavior | `draft -> installed -> deprecated` | Long | Yes | Yes |
| Reference | Knowledge | Capture product references, patterns, anti-patterns, and flows | `captured -> briefed -> patterned` | Long | Yes | Yes |
| Thread | Task container | Group objects from one Chatbot conversation | `active -> closed -> archived` | Medium | Yes | Indirect |
| Runtime Projection | Protocol | Materialize selected context as files for coding agents | `generated -> current -> expired` | No | No | Yes |

Object classes:

- Task objects: Handoff, Result, Thread.
- Knowledge objects: Crystal, Brief, Reference.
- Artifact objects: Artifact and artifact-like Results.
- Protocol objects: Context Pack, Prompt Pack, Skill, Runtime Projection.

## Frontmatter

Every Markdown object should use the shared base fields:

```yaml
type: noos_object_type
version: 0.1
object_id: noos_obj_01hx8m9n2p3q4r5s6t7u8v9w0x
lookup_key: 20260521-noos-vault-object-model-a7f3
title: NOOS Vault Object Model
status: active
created_at: 2026-05-21T10:30:00+08:00
updated_at: 2026-05-21T10:30:00+08:00
source_app: chatgpt
source_url: https://chatgpt.com/...
tags: [noos, vault]
summary: One sentence summary.
links: []
derived_from: []
related: []
```

Object-specific keys:

- Handoff: `type: noos_thread`, `object_type: handoff`, `handoff_revision`, `handoff_key`, `target_agent`, `task_status`, `validation_status`, `context_refs`, `crystal_refs`, `suggested_next_agent`.
- Crystal: `type: noos_crystal`, `crystal_key`, `confidence`, `curation_status`, `thread_ref`, `source_refs`.
- Result: `type: noos_result`, `result_key`, `producer`, `input_refs`, `review_status`, `promotes_to`.
- Artifact: `type: noos_artifact`, `artifact_key`, `media_type`, `file_path`, `sha256`, `thumbnail_path`.
- Context Pack: `type: noos_context_pack`, `context_key`, `scope`, `target_agents`, `refs`, `token_budget`.
- Prompt Pack: `type: noos_prompt_pack`, `prompt_key`, `context_pack_ref`, `target_chatbot`, `send_status`, `expected_result_marker`.
- Brief: `type: noos_brief`, `brief_key`, `audience`, `source_refs`.
- Skill: `type: noos_skill`, `skill_key`, `agents`, `capabilities`, `entrypoint`.
- Reference: `type: noos_reference`, `reference_kind`, `product`, `assets`, `patterns_extracted`.
- Thread: `type: noos_thread_index`, `thread_key`, `chatbot`, `conversation_url`, `object_refs`.
- Runtime Projection: `type: noos_runtime_projection`, `projection_key`, `task_ref`, `context_pack_ref`, `root_path`, `expires_at`.

## Relationships

Hub should maintain object relationships in `vault/index/graph.json`.

Recommended edge names:

```json
[
  "contains",
  "references",
  "derived_from",
  "result_of",
  "promotes_to",
  "packed_into",
  "materialized_as",
  "projected_as",
  "supersedes",
  "aliases"
]
```

Rules:

- Thread contains Handoff, Crystal, Result, and Artifact objects from one conversation.
- Handoff may reference Crystal, Brief, Artifact, Context Pack, and previous Result.
- Result is produced from Prompt Pack, Context Pack, or Handoff.
- Result may promote into Crystal, Brief, Wiki content, or Artifact.
- Context Pack references selected Crystal, Brief, Reference, Skill, and Artifact metadata.
- Prompt Pack materializes a Context Pack into a Chatbot-ready prompt.
- Runtime Projection materializes selected objects into files for coding agents.

## Vault Layout

Minimum v0 layout:

```text
~/.noos/
  config.json
  runtime/
    shuttle-token.json
  vault/
    handoffs/{active,done,archived}/
    crystals/{active,curated,archived}/
    results/{inbox,accepted,archived}/
    artifacts/{files,sidecars,thumbs}/
    briefs/{active,archived}/
    packs/context/{active,archived}/
    packs/prompt/{active,sent,archived}/
    threads/{active,archived}/
    runtime/projections/{current,history}/
    index/{keys.json,objects.json,graph.json,backlinks.json}
    inbox/
    outbox/
    tmp/
    logs/
```

Extended v1 layout:

```text
~/.noos/vault/
  wiki/
  skills/{installed,local,archived}/
  references/{raw,briefs,patterns,anti-patterns,flows,assets}/
  projections/{codex,claude-code,opencode}/
  sync/{git,exports,imports}/
  policies/{access.yaml,retention.yaml}
```

Project-local `.noos/` should stay small and task-oriented:

```text
.noos/
  handoffs/{active,done}/
  crystals/{active,done}/
  context/briefs/
  runtime/current/
  agent-registry.json
  project.json
  local.json
```

## Identity, Lookup Key, Path, And Index

NOOS separates machine identity, human lookup, and current file location:

| Field | Purpose | Mutable |
| --- | --- | --- |
| `object_id` | Internal stable identity | No |
| `lookup_key` / `crystal_key` | User, agent, and Chatbot lookup entry | No |
| `path` | Current saved file path | Yes |
| `title` | Display title | Yes |

Example:

```yaml
object_id: noos_obj_01hx8m9n2p3q4r5s6t7u8v9w0x
lookup_key: 20260521-noos-11881
```

v0 lookup keys use:

```text
YYYYMMDD-meaningful-slug-shortcode
```

`lookup_key` is a stable human-facing alias. `object_id` is immutable internal identity. File path is mutable. Title can change. Source URL records provenance, not identity. Existing object-specific keys such as `crystal_key` remain valid lookup keys.

Indexes:

- `keys.json`: `lookup_key -> object_id/path/status/type`.
- `objects.json`: `object_id -> metadata/path/hash/source`.
- `graph.json`: typed edges between objects.
- `backlinks.json`: reverse references for fast lookup.

Required index fields for every persisted object:

```json
{
  "object_id": "noos_obj_01hx8m9n2p3q4r5s6t7u8v9w0x",
  "lookup_key": "20260521-noos-vault-object-model-a7f3",
  "path": "/Users/me/.noos/vault/handoffs/active/20260521-noos-vault-object-model-a7f3.md",
  "type": "handoff",
  "source": {
    "app": "browser-shuttle",
    "url": "https://chatgpt.com/...",
    "conversation_id": "optional",
    "captured_at": "2026-05-21T10:30:00Z"
  },
  "created_at": "2026-05-21T10:30:00Z"
}
```

Conflict policy:

- A slug collision receives a new shortcode or suffix.
- A rename keeps the old key as an alias.
- Archive keeps the key resolvable.
- Delete should leave a tombstone unless the user asks for hard delete.

## Ingest Protocol

Canonical endpoint:

```http
POST /v1/ingest
Authorization: Bearer <token>
Content-Type: application/json
```

Compatibility endpoints:

```http
POST /v1/handoffs
POST /v1/crystals
POST /v1/results
POST /v1/artifacts
```

Payload:

```json
{
  "protocol_version": 1,
  "request_id": "uuid",
  "idempotency_key": "sha256-source-url-type-content",
  "object_type": "handoff",
  "source": {
    "app": "browser-shuttle",
    "url": "https://chatgpt.com/...",
    "conversation_id": "optional",
    "captured_at": "2026-05-21T10:30:00+08:00"
  },
  "suggested": {
    "lookup_key": "optional-semantic-key",
    "filename": "optional-filename.md",
    "status": "active"
  },
  "content": {
    "media_type": "text/markdown",
    "text": "<!-- NOOS:THREAD:BEGIN -->..."
  }
}
```

Success response:

```json
{
  "ok": true,
  "backend": "hub_local",
  "object_type": "handoff",
  "object_id": "noos_obj_01hx8m9n2p3q4r5s6t7u8v9w0x",
  "lookup_key": "20260521-noos-vault-object-model-a7f3",
  "status": "active",
  "path": "/Users/me/.noos/vault/handoffs/active/20260521-noos-vault-object-model-a7f3.md",
  "source": {
    "app": "browser-shuttle",
    "url": "https://chatgpt.com/...",
    "conversation_id": "optional",
    "captured_at": "2026-05-21T10:30:00Z"
  },
  "created_at": "2026-05-21T10:30:00Z",
  "canonical_url": "noos://object/20260521-noos-vault-object-model-a7f3",
  "content_hash": "sha256ish:...",
  "warnings": [],
  "next_actions": ["open_hub", "copy_key", "send_to_chatgpt"],
  "fallback": ["copy", "download"]
}
```

Ingest is a transaction, not a plain save button:

```text
capture -> validate -> assign lookup_key -> persist file -> update index -> return receipt
```

v0 protocol constraints:

- localhost only.
- markdown text payload only.
- no image upload yet.
- all remote upload or Git sync requires user confirmation.
- idempotency is required through `idempotency_key`.
- save failures must return recovery actions such as copy, download, retry, or open Hub.
- Shuttle does not do complex knowledge organization.
- Hub owns `lookup_key`, final path, and index updates.

Error codes:

- `unauthorized`
- `origin_not_allowed`
- `unsupported_protocol_version`
- `unsupported_media_type`
- `invalid_artifact`
- `request_too_large`
- `vault_unavailable`
- `write_failed`
- `index_write_failed`
- `not_found`

## Prompt Feeding And Result Capture

Golden path:

1. Hub selects Vault objects and creates a Context Pack.
2. Hub renders a Prompt Pack for a target Chatbot.
3. Hub writes an outbox task.
4. Shuttle claims the task, previews it, injects it into the Chatbot, and sends after user confirmation.
5. Prompt Pack asks the Chatbot to return `NOOS:RESULT`.
6. Shuttle captures Result and posts it to `/v1/ingest`.
7. Hub saves Result in `vault/results/inbox/` and offers promotion to Crystal, Brief, Wiki, or Artifact.

v0 should make this file-backed and explicit. v1 can add richer task queues and per-chatbot adapters.

Hub-to-Chatbot feeding is more complex than ingest because it has more asynchronous states:

```text
pending_prompt_pack
target_page_opened
ready_to_inject
injected
submitted
waiting_for_result
captured
returned_to_hub
```

v0 should only support:

1. Hub prepares a pending Prompt Pack.
2. Shuttle sees the task on the current ChatGPT page.
3. User manually clicks inject.

Do not start with automatic page opening, automatic attachment upload, automatic submit, automatic waiting, or automatic result capture as a single fully automated chain.

### v0 Implemented Feed Path

The first implemented feed path is intentionally smaller than the full outbox model:

1. Hub exposes recent/read-only Vault objects to the authenticated local Shuttle:

```http
GET /v1/vault/recent
GET /v1/vault/object?key=<lookup_key>
Authorization: Bearer <token>
```

2. Shuttle shows a compact “Import from NOOS” selector in the browser panel.
3. The selector lists newest objects first, then folder-like groups for Handoffs, Crystals, and Results. `lookup_key` remains the fallback search handle, but the user can pick visually from titles, keys, types, and compact paths.
4. When the current page exposes a file input, Shuttle creates a Markdown `File` from the selected object and dispatches it to that file input.
5. Shuttle then inserts only a short instruction into the Chatbot composer, asking the Chatbot to read the attached NOOS file and continue.
6. If attachment fails, Shuttle falls back to inserting the Markdown text into the composer.
7. Shuttle does not auto-submit this v0 feed. The user reviews and sends.

This keeps large Handoff/Crystal content out of the text box when the target Chatbot supports local attachment, while preserving Copy/Download/text insertion fallback.

For ChatGPT Project-like pages, Shuttle also adds a small “Import from NOOS” entry near visible source/knowledge/file areas. This bridge is refreshed after SPA navigation, so moving from a normal conversation to a Project page does not require reloading the extension. It opens the same NOOS selector in `Project sources` mode and prefers the file input near the source area. In that mode, a successful attach does not write extra text into the chat composer; the selected Markdown object is treated as a Project source file. If Shuttle cannot find a Project upload input, it downloads the selected Markdown file for manual upload instead of inserting the full object into the chat composer. It is not yet a full Project-source automation layer; DOM changes in ChatGPT may require adapter updates.

## Coding Agent Runtime Projection

v0 projection is file-only:

```text
.noos/runtime/tasks/20260521-shuttle-handoff-p4qx/
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
    wiki/
    crystals/
    briefs/
    skills/
  artifacts/
  output/

.noos/runtime/current.json
.noos/runtime/current/
```

Agent startup instruction:

```text
Use the NOOS runtime projection for this task.

First read:
.noos/runtime/current/READ_ME_FIRST.md
.noos/runtime/current/TASK.md
.noos/runtime/current/CONTEXT_PACK.md

Then inspect only referenced sources and artifacts needed for the task.
When complete, write a concise result summary to:
.noos/runtime/current/RESULT_SUMMARY.md
```

`READ_ME_FIRST.md` is more important than a complex protocol. It must tell the agent:

- Read `TASK.md`, then `CONTEXT_PACK.md`, then `FILE_MAP.md`.
- Only read projected files under `sources/`.
- Do not scan the full NOOS Vault.
- Do not read private, secrets, or credentials files.
- Produce a plan before implementation.
- Write `RESULT_SUMMARY.md` after finishing.

Do not expose the whole user Vault to every agent task. v0 projection should copy selected excerpts, briefs, and source files into `sources/`; it should not symlink the entire Vault.

NOOS Hub should expose the same projection path in the Vault UI: recent Handoff / Crystal cards can open the source Markdown or run `scripts/noos-project-runtime.sh <path>` to refresh `.noos/runtime/current/`. This makes “Chatbot captured object -> local Vault -> Codex-readable task folder” a product action, not only a command-line escape hatch.

Recommended projection policy:

```yaml
context_policy:
  include:
    - crystals: selected
    - briefs: selected
    - skills: required
  deny:
    - private/**
    - secrets/**
    - credentials/**
  expose_mode: copy
  max_files: 12
  max_chars_per_file: 8000
```

Consumption levels:

- L0 / v0: file projection.
- L1 / v1: `noos open`, `noos search`, `noos read --brief`, `noos write-result`.
- L2 / v2: MCP tools such as `noos.search`, `noos.read`, `noos.pack`, and `noos.write_result`.
- L3: Hub-managed session bridge for Codex, Claude Code, and OpenCode.

## v0 / v1 / v2 Cut

v0 must support Handoff, Crystal, Result minimal, Artifact sidecars, key index, unified ingest, Browser Mirror fallback, runtime projection layout, and basic Prompt Pack dispatch.

v1 should add Brief, Reference Library, richer Context Pack builder, recent object list in Hub, `noos open/search/project`, explicit Git sync, and artifact thumbnails.

v2 can add MCP, model-provider enhancements, multi-device sync, permission profiles, advanced graph search, and shared team Vaults.
