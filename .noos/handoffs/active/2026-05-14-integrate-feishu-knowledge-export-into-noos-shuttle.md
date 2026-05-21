<!-- NOOS:THREAD:BEGIN -->
---
type: noos_thread
version: 0.1
source_app: codex
target_agent: codex
status: active
created_at: 2026-05-14
title: integrate-feishu-knowledge-export-into-noos-shuttle
tags: [noos, shuttle, browser-extension, feishu, knowledge-export, plugin]
preferred_path: /Users/songfu/Downloads/NOOS/vault/handoffs/active/2026-05-14-integrate-feishu-knowledge-export-into-noos-shuttle.md
---

# Thread: Integrate Feishu Knowledge Export into NOOS Shuttle

## Intent

Integrate the newly prototyped Feishu/Lark knowledge-package export workflow into the NOOS Shuttle plugin/product as a first-class capability.

The integration should let a user turn a Feishu Docs/Wiki page into an Agent-friendly knowledge package:

```text
knowledge-pack/
  doc.md
  manifest.json
  docast.json
  chatgpt-project-instructions.md
  conversion-report.md
  assets/
```

The main product idea is progressive reading:

- Agents/chatbots first read `doc.md`.
- `doc.md` contains lightweight summaries for images, diagrams, and tables.
- `manifest.json` indexes external resources by stable IDs.
- Agents open image/table assets only when exact details are needed.

## Context Summary

Current work already created a Codex skill and script:

- Skill: `/Users/songfu/.codex/skills/feishu-knowledge-export/SKILL.md`
- Script: `/Users/songfu/.codex/skills/feishu-knowledge-export/scripts/feishu_knowledge_export.py`
- ChatGPT Project reference: `/Users/songfu/.codex/skills/feishu-knowledge-export/references/chatgpt-project.md`
- User-facing usage doc: `/Users/songfu/Downloads/飞书知识包导出使用说明.md`
- Example output package: `/Users/songfu/Downloads/IxtHwhR0BiS99AkRthqcVXxDn0g-knowledge-pack`

Validated test document:

```text
https://pisn3u3ony2.feishu.cn/wiki/IxtHwhR0BiS99AkRthqcVXxDn0g?from=from_copylink
```

Observed result:

- Document title: `数值思路`
- Feishu parsed blocks: 476
- `doc.md`: 610 lines
- Resource count: 16
- Local resources: 12
- Degraded resources: 4
- Tables: 6, exported as `.md` and `.csv`
- Images/whiteboards: 4, not saved locally because Feishu returned HTTP 401 / `board.v1.whiteboard.download_as_image forbidden`

Important limitation:

The browser extension should not pretend it can always download Feishu images/whiteboards. Feishu resource access often depends on OAuth, tenant permissions, or logged-in browser state.

## Task

Design and implement an integration path in NOOS Shuttle for Feishu Knowledge Export.

This should not be a one-off script hidden outside the product. It should become a plugin feature/module that can be invoked from NOOS Shuttle.

Recommended product framing:

```text
NOOS Shuttle can transport not only "handoff threads", but also "knowledge packs".
```

Add `KnowledgePack` as a related artifact type beside `NoosThread`.

## Recommended Architecture

### 1. Keep heavy export logic out of the browser extension

A browser extension can detect the page and initiate the workflow, but reliable export requires:

- local filesystem writes
- Python/Node dependencies
- Feishu API credentials or OAuth token
- optional browser storage state
- image/table post-processing

Therefore, do not run the full exporter purely inside the content script.

Prefer one of these integration layers:

1. NOOS Hub local service endpoint
2. Browser extension native messaging host
3. Local CLI invoked by a developer/agent
4. Fallback: generate a NOOS handoff instructing Codex to run the exporter

For v0, the best integration is likely:

```text
Browser extension detects Feishu page
  -> user clicks "Export Knowledge Pack"
  -> extension creates a NOOS Thread / command payload
  -> NOOS Hub or Codex consumes it
  -> local exporter generates the package
  -> package path is returned or saved into NOOS vault
```

### 2. Add a KnowledgePack artifact model

Suggested TypeScript shape:

```ts
export interface KnowledgePackManifest {
  schema: "feishu-knowledge-export/manifest@0.1";
  title: string;
  source_url?: string | null;
  main: "doc.md";
  assets_dir: "assets";
  resource_count: number;
  resources: KnowledgeResource[];
  notes?: string[];
}

export interface KnowledgeResource {
  id: string;
  type:
    | "image"
    | "diagram"
    | "remote_image"
    | "table"
    | "table_csv"
    | "attachment"
    | "unknown";
  path?: string | null;
  source: string;
  summary: string;
  open_when: string[];
}
```

### 3. Add a Feishu source detector

NOOS Shuttle content script should detect:

```text
*.feishu.cn/docx/*
*.feishu.cn/wiki/*
*.larksuite.com/docx/*
*.larksuite.com/wiki/*
```

When detected, show a compact action:

```text
Export Knowledge Pack
```

This action should not silently export. It should show a preview/confirmation because Feishu docs may contain private company data.

### 4. Add a delivery/command payload

The extension should be able to produce a command payload like:

```json
{
  "type": "noos_command",
  "version": "0.1",
  "command": "feishu_knowledge_export",
  "source_url": "https://...",
  "output_hint": "NOOS/vault/knowledge-packs/<slug>",
  "project_mode": true
}
```

Fallback textual instruction:

```text
Use $feishu-knowledge-export to export this Feishu document into a knowledge package:
<URL>

Save it under:
<target path>
```

### 5. Store outputs in NOOS vault

Suggested path:

```text
NOOS/vault/knowledge-packs/
  active/
    2026-05-14-<slug>/
      doc.md
      manifest.json
      docast.json
      chatgpt-project-instructions.md
      conversion-report.md
      assets/
```

If the existing project has a different vault convention, adapt to that convention.

### 6. Add ChatGPT Project handoff support

For a generated package, NOOS Shuttle can offer:

- Copy upload checklist
- Download package zip
- Copy Project Instructions
- Create a NOOS Thread that tells ChatGPT how to use `doc.md` and `manifest.json`

Do not claim ChatGPT Projects automatically resolve Markdown relative paths. They usually need `manifest.json` and explicitly uploaded asset files.

## Implementation Options

### Minimum viable integration

Add a new Shuttle action that creates/copies a command handoff:

```text
Export this Feishu URL with $feishu-knowledge-export.
```

This requires minimal product code and is immediately useful.

### Better local integration

Have NOOS Shuttle call NOOS Hub or a native messaging host that runs:

```bash
python3 /Users/songfu/.codex/skills/feishu-knowledge-export/scripts/feishu_knowledge_export.py export "<URL>" -o "<output-dir>" --project-mode
```

This creates a real local package and returns the package path.

### Long-term integration

Port the exporter into the NOOS Shuttle codebase or a NOOS plugin package:

- Keep the core manifest/doc generation logic reusable.
- Support Feishu OAuth/login state.
- Support batch Wiki export.
- Support stable resource IDs and incremental sync.
- Add image OCR / multimodal digest later.

## Constraints

- Do not put Feishu App Secret or OAuth tokens inside browser extension source.
- Do not rely only on internal Feishu image URLs; they may be inaccessible outside the logged-in context.
- Do not assume ChatGPT Project can auto-open `./assets/foo.png` from Markdown.
- Do not make this a default sidebar feature. Keep it aligned with NOOS Shuttle's floating-button / compact-action model.
- Preserve fallback paths: copy command, download handoff, save to NOOS vault.

## Acceptance Criteria

- [ ] NOOS Shuttle has a clear concept of `KnowledgePack` or equivalent artifact.
- [ ] Feishu/Lark document URLs are detected on supported domains.
- [ ] User can trigger an "Export Knowledge Pack" action.
- [ ] v0 either creates a runnable handoff/command or calls a local helper to run the exporter.
- [ ] Output package follows `doc.md + manifest.json + docast.json + assets/` structure.
- [ ] Degraded resources are visible in `conversion-report.md` or product UI.
- [ ] ChatGPT Project usage guidance is available from the package or UI.
- [ ] Sensitive credentials are not stored in extension source or handoff files.

## Suggested Next-Agent Instructions

1. Locate the NOOS Shuttle plugin repository. The current Codex session only found an old design handoff at `/Users/songfu/Downloads/noos-shuttle-v0-codex-handoff.md`, not the source repo.
2. Read the existing plugin architecture, especially action menu, storage adapters, and handoff/thread model.
3. Add a design note or implementation plan for `KnowledgePack` integration before coding.
4. Prefer a thin browser integration first: detect Feishu URL and generate a command/handoff for the local exporter.
5. If NOOS Hub local service exists, integrate through it rather than trying to run Python in the extension.
6. Reuse the existing exporter script path for MVP.
7. After implementation, test with the validated Feishu link above and confirm the package contains 6 extracted tables plus degraded image records.

## Relevant Files or Links

- `/Users/songfu/.codex/skills/feishu-knowledge-export/SKILL.md`
- `/Users/songfu/.codex/skills/feishu-knowledge-export/scripts/feishu_knowledge_export.py`
- `/Users/songfu/.codex/skills/feishu-knowledge-export/references/chatgpt-project.md`
- `/Users/songfu/Downloads/飞书知识包导出使用说明.md`
- `/Users/songfu/Downloads/IxtHwhR0BiS99AkRthqcVXxDn0g-knowledge-pack`
- `/Users/songfu/Downloads/noos-shuttle-v0-codex-handoff.md`

<!-- NOOS:THREAD:END -->
