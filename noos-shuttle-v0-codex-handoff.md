# Codex Handoff: NOOS Shuttle v0 Browser Plugin Design

## 1. Background

We are designing an early prototype of **NOOS Shuttle**, a browser plugin for smoother AI-to-AI handoff.

NOOS stands for **Natural-language Orchestration Operating System**. The long-term goal is to help users move work seamlessly between different AI production tools, such as ChatGPT, Claude, Claude Code, Codex, Gemini, OpenCode, LLM Wiki, and future agent systems.

The immediate problem is simple:

> Users often discuss a task deeply in ChatGPT, then need to move the resulting context into Codex, Claude Code, OpenCode, or another agent. Today this usually requires manual copy-paste, manual file creation, manual naming, manual saving, and manual instruction writing. This is too tedious.

The first version should not attempt to build the whole NOOS system. It should focus on one practical workflow:

> Turn the current ChatGPT conversation into a structured handoff/thread, capture it from the page, and save/deliver it to a shared place that another agent can read.

## 2. Core Product Idea

The product is tentatively called:

> **NOOS Shuttle**

Metaphor:

- **Thread** = a portable context package / handoff document.
- **Shuttle** = the browser plugin that carries the Thread from one AI tool to another.
- **NOOS** = the future orchestration layer.
- **Wiki / LLM Wiki** = the future memory / knowledge layer.
- **Skill / Brief / Summary** = compressed reusable AI context assets.

NOOS Shuttle v0 is not a general AI assistant. It is not a sidebar chatbot. It is a low-friction handoff tool.

The core sentence:

> NOOS Shuttle helps users generate, capture, and deliver AI handoff threads from ChatGPT to coding agents such as Codex or Claude Code.

## 3. Why Browser Plugin

We do not want to rely only on API-based workflows at the beginning.

Reasons:

1. API-first design has a high setup barrier.
2. Many users already work inside ChatGPT / Claude / Gemini web UIs.
3. ChatGPT custom instructions are limited and should not be polluted with long handoff protocols.
4. A plugin can inject handoff prompts only when needed.
5. A plugin can capture the generated handoff and save it elsewhere.
6. A plugin can support fallback options such as clipboard and local download even when GitHub or cloud save fails.

The plugin should work as a lightweight browser-native bridge.

## 4. Important Reference Patterns

There are two existing UI/technical references:

### 4.1 AI Round Table Plugin by Axton Liu

Useful parts:

- It can locate the ChatGPT input box.
- It can inject prepared prompts into the current ChatGPT conversation.
- It can extract previous conversation content from the ChatGPT page.
- It can pass extracted content to another model/chatbot.

What we should learn from it:

- Prompt injection.
- DOM extraction.
- Conversation/message detection.
- Input box targeting.
- Cross-tool context transfer.

What we should avoid:

- A persistent sidebar as the default UI.

The sidebar takes too much page width and creates psychological friction. The user may hesitate before opening it.

### 4.2 Monica Plugin UI

Useful parts:

- Small floating button.
- Minimal page occupation.
- Secondary actions hidden behind a main button.
- The plugin is present but not intrusive.

NOOS Shuttle should use this interaction model.

## 5. UI Direction

Do not build a default sidebar.

Use a **floating action button** as the primary UI.

Default state:

- A small floating button on the right side of the page.
- It should take very little space.
- It should not resize or push the webpage content.

On click, show a compact popover menu.

Suggested actions:

1. Generate Thread
2. Capture Thread
3. Save / Deliver
4. Settings

Advanced configuration can be hidden under Settings. A full panel or sidebar may exist later, but only as an optional advanced settings interface.

## 6. Core v0 Workflow

The minimal workflow is:

```text
User discusses a task in ChatGPT
  ↓
User clicks NOOS Shuttle floating button
  ↓
User clicks "Generate Thread"
  ↓
Plugin injects a prepared prompt into the ChatGPT input box
  ↓
ChatGPT generates a structured NOOS Thread / Handoff
  ↓
User clicks "Capture Thread"
  ↓
Plugin detects the generated handoff block from the page
  ↓
User chooses a save/delivery target
  ↓
Plugin saves it to clipboard, local markdown download, or GitHub repo
  ↓
Codex / Claude Code / OpenCode reads the saved thread
```

## 7. Main Plugin Functions

The plugin should be designed around three core actions:

```text
Generate
Capture
Deliver
```

### 7.1 Generate

Purpose:

Ask ChatGPT to generate a structured handoff from the current conversation.

How:

- Locate the ChatGPT input box.
- Insert a prepared handoff-generation prompt.
- Optionally auto-submit, depending on user setting.
- The prompt should instruct ChatGPT to output a markdown block with stable markers.

Important:

The plugin should not summarize the conversation itself in v0. ChatGPT should do the cognitive work. The plugin only injects the prompt.

### 7.2 Capture

Purpose:

Extract the generated NOOS Thread from the ChatGPT conversation page.

How:

- Search the current page for explicit markers.
- The primary detection method should be marker-based, not fuzzy guessing.
- Example marker:

```md
<!-- NOOS:THREAD:BEGIN -->
...
<!-- NOOS:THREAD:END -->
```

Fallback detection may later include:

- YAML frontmatter with `type: noos_thread`
- headings such as `# Thread:` or `# Handoff:`

But v0 should prefer explicit markers.

### 7.3 Deliver

Purpose:

Save or deliver the captured Thread.

v0 save targets:

1. Copy to clipboard
2. Download as `.md`
3. Save to GitHub repo

GitHub should not be the only path. It is useful, but not universal.

If GitHub save fails, the plugin must still allow:

- Copy to clipboard
- Download markdown file

Future save targets:

- Dropbox
- Google Drive
- OneDrive
- WebDAV
- S3 / Cloudflare R2
- Dedicated NOOS Cloud
- Local folder sync

## 8. Important Architectural Principle

Do not ask ChatGPT itself to save to GitHub.

Better architecture:

```text
ChatGPT generates the handoff content.
Plugin captures the handoff content.
Plugin saves/delivers the handoff.
```

Reason:

- ChatGPT may not have GitHub access.
- User may not have connected GitHub.
- Permissions may fail.
- Plugin has better control over file naming, target path, fallback, and confirmation.

## 9. Storage Adapter Design

The save/delivery layer should be abstracted.

Recommended interface concept:

```ts
interface StorageAdapter {
  id: string;
  name: string;
  saveThread(thread: NoosThread, options: SaveOptions): Promise<SaveResult>;
}
```

Initial adapters:

```text
ClipboardAdapter
DownloadAdapter
GitHubAdapter
```

Do not hardcode the product around GitHub.

GitHub is still useful for coding agents because Codex / Claude Code / OpenCode can naturally read repo files, AGENTS.md, skills, docs, and handoffs.

## 10. Suggested File / Repo Structure for Coding Agent Side

A target repo may contain:

```text
repo/
  AGENTS.md
  .noos/
    handoffs/
      active/
      done/
    skills/
      consume-thread.md
      write-result-summary.md
    context/
      briefs/
      summaries/
  docs/
  wiki/
```

Interpretation:

- `AGENTS.md` = stable project-level agent instructions.
- `.noos/handoffs/active/` = active handoff files waiting for an agent.
- `.noos/handoffs/done/` = completed handoffs and result summaries.
- `.noos/skills/` = reusable instructions for agents.
- `.noos/context/briefs/` = compressed background context.
- `wiki/` = human-readable knowledge / LLM Wiki compatible material.

## 11. NOOS Thread v0.1 Format

The handoff file should be markdown.

It should include:

- explicit begin/end markers
- YAML frontmatter
- title
- intent
- context summary
- task
- constraints
- acceptance criteria
- suggested next-agent instructions
- relevant files / links if available

Suggested format:

```md
<!-- NOOS:THREAD:BEGIN -->
---
type: noos_thread
version: 0.1
source_app: chatgpt
target_agent: codex
status: active
created_at: 2026-05-02
title: example-thread-title
tags: [noos, shuttle, handoff]
preferred_path: .noos/handoffs/active/2026-05-02-example-thread-title.md
---

# Thread: Example Thread Title

## Intent

Describe what the next agent should accomplish.

## Context Summary

Summarize the important discussion context from the current ChatGPT conversation.

## Task

State the concrete task for Codex / Claude Code / OpenCode.

## Constraints

List constraints, non-goals, style requirements, and implementation boundaries.

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Suggested Next-Agent Instructions

Tell the next agent how to proceed. For coding agents, usually:
1. Read this thread fully.
2. Read AGENTS.md if present.
3. Inspect relevant files.
4. Produce a plan before editing.
5. Wait for confirmation unless the task explicitly allows implementation.
6. After implementation, write a result summary.

## Relevant Files or Links

- `AGENTS.md`
- `.noos/skills/consume-thread.md`
- `docs/...`

<!-- NOOS:THREAD:END -->
```

## 12. Prompt Template for Generate Thread

The plugin should inject something like this into ChatGPT:

```md
Please generate a NOOS Thread / Handoff based on the current conversation.

The purpose is to hand off this discussion to a coding agent such as Codex, Claude Code, or OpenCode.

Output only one markdown handoff block.

The handoff must be wrapped by these exact markers:

<!-- NOOS:THREAD:BEGIN -->
...
<!-- NOOS:THREAD:END -->

Use YAML frontmatter with:
- type: noos_thread
- version: 0.1
- source_app: chatgpt
- target_agent: codex
- status: active
- created_at
- title
- tags
- preferred_path

The body must include:
# Thread: <title>

## Intent
## Context Summary
## Task
## Constraints
## Acceptance Criteria
## Suggested Next-Agent Instructions
## Relevant Files or Links

Make it concise but complete enough for another agent to continue the work without rereading the full conversation.
```

Later, there can be different prompt templates for:

- ChatGPT → Codex
- ChatGPT → Claude Code
- ChatGPT → OpenCode
- ChatGPT → LLM Wiki
- Design discussion → formal design document
- Design discussion → configuration table task
- Bug discussion → fix task

## 13. What v0 Should Not Do

Do not build these in v0:

- Full NOOS operating system
- Multi-agent round table
- Default sidebar UI
- Automatic Claude / Gemini / Codex browser control
- Complex task queue
- Cloud account system
- Automatic wiki construction
- Automatic conversation summarization by the plugin itself
- Heavy API-based backend
- Full Dropbox / Google Drive integration
- Multi-user collaboration

v0 should stay narrow:

```text
Floating button
Prompt injection
Marker capture
Preview
Copy
Download
GitHub save
```

## 14. Error and Fallback Behavior

The plugin must degrade gracefully.

Example cases:

### No handoff detected

Show:

```text
No NOOS Thread detected.
Try Generate Thread first.
```

### Multiple handoffs detected

Show a list:

```text
Detected 2 Threads:
1. Thread A
2. Thread B
```

Let user choose one.

### GitHub save failed

Show:

```text
GitHub save failed.
You can still copy or download the handoff.
```

Provide buttons:

- Copy
- Download
- Retry GitHub
- Open Settings

### Input box not found

Show:

```text
Chat input box not found.
The page layout may have changed.
```

## 15. Visual Interaction Requirements

The UI should be light and non-intrusive.

Default:

- one small floating button
- right side of page
- does not push page layout
- does not open sidebar by default

On click:

- small popover
- core actions visible
- settings hidden

Possible states:

- normal
- handoff detected
- generating
- saved
- error

Avoid clutter. Do not stack many buttons on the page.

## 16. Product Positioning

NOOS Shuttle is not an AI chatbot.

It is:

> A handoff transport layer for AI work.

Short description:

> NOOS Shuttle turns the current AI conversation into a portable Thread and delivers it to the next agent.

Even shorter:

> One-click AI handoff.

Metaphor:

> Shuttle carries the Thread.

## 17. Expected Codex Work

Please use this handoff to create an initial implementation plan.

Do not immediately build a large product.

First produce:

1. A concise architecture proposal.
2. A browser extension directory structure.
3. A data model for `NoosThread`.
4. A `StorageAdapter` abstraction.
5. A simple UI interaction plan.
6. A v0 implementation checklist.
7. Open questions / risks.

If implementation is requested after the plan, start with:

- Chrome extension manifest
- content script for floating button
- prompt injection into ChatGPT input
- marker-based handoff capture
- clipboard save
- markdown download
- placeholder GitHub adapter interface

Prioritize a working local prototype over completeness.
