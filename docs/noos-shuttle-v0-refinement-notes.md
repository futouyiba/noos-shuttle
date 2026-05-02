# NOOS Shuttle v0 Refinement Notes

Source:

- `noos-shuttle-v0-codex-handoff.md`
- `docs/noos-shuttle-v0-design-breakdown.md`
- `docs/noos-shuttle-v0-work-plan.md`

## 1. Core Thesis

NOOS Shuttle v0 should prove one behavior:

> A user can turn a valuable AI conversation into a portable, structured handoff without doing manual context packaging.

The product is not valuable because it has many destinations. It is valuable if it reliably removes the tedious middle work between "we discussed the task" and "the next agent can start".

The v0 success loop is:

```text
ChatGPT conversation
  -> Generate structured handoff
  -> Capture exact handoff block
  -> Save as portable markdown
  -> Next agent can read and act
```

Everything outside this loop should be treated as secondary.

## 2. Sharpened Product Positioning

Original positioning:

> One-click AI handoff.

Sharper v0 positioning:

> Package this AI conversation for the next agent.

Reason:

"One-click" may overpromise because the early workflow still has review, capture, and save steps. "Package this AI conversation" describes the actual user job more precisely.

Recommended short descriptions:

- NOOS Shuttle packages AI conversations into agent-ready handoff threads.
- Turn this ChatGPT thread into a Codex-ready markdown handoff.
- Capture the decisions, constraints, and next task before context is lost.

Avoid describing v0 as:

- an orchestrator
- an assistant
- an automation platform
- a multi-agent router
- a memory system

Those are future NOOS concepts, not the Shuttle v0 proof.

## 3. Most Important v0 Product Decision

The main design decision is whether the plugin should:

1. ask ChatGPT to generate the handoff, then capture it, or
2. extract the conversation itself and generate the handoff elsewhere.

For v0, option 1 remains stronger.

Why:

- No external model/API requirement.
- Lower setup burden.
- The user's current ChatGPT session already has the conversation context.
- The plugin can stay simple: inject prompt, detect markers, save result.
- The user can review the generated handoff before it leaves the page.

Tradeoff:

- Quality depends on ChatGPT's compliance with the prompt.
- Capture depends on exact marker output.
- The plugin cannot fully guarantee structure unless it validates after capture.

Conclusion:

Keep ChatGPT-generation as v0, but add lightweight validation after capture. The plugin should detect whether required sections exist and warn when they do not.

## 4. Generate Flow Refinement

The Generate action should not feel like an irreversible automation.

Recommended default:

- Insert the prompt into the ChatGPT input.
- Do not auto-submit by default.
- Show a transient state: "Prompt inserted. Review and send in ChatGPT."

Reason:

The user may want to adjust target agent, tone, task scope, or omitted context. Auto-submit creates avoidable anxiety and makes the plugin feel less trustworthy.

Future option:

- Auto-submit can be a setting for power users.

Prompt template refinements:

- Ask for a concise handoff, not a long archive.
- Require exact begin/end markers.
- Require frontmatter.
- Require acceptance criteria.
- Tell ChatGPT not to include explanation outside the block.
- Ask for unknowns/open questions when important context is missing.

## 5. Capture Flow Refinement

Capture should be more than "find text between markers".

Minimum capture pipeline:

```text
Read page content
  -> find marker ranges
  -> extract candidate blocks
  -> parse frontmatter if present
  -> derive title and filename
  -> validate required fields/sections
  -> show preview and warnings
```

Required v0 validations:

- Has begin marker.
- Has end marker.
- Has `type: noos_thread`.
- Has `version: 0.1`.
- Has a title.
- Has `## Task`.
- Has `## Acceptance Criteria`.
- Has `## Suggested Next-Agent Instructions`.

Validation should not block saving unless the markers are broken. It should produce warnings that the user can inspect.

This keeps the product practical: rough handoffs can still be moved, but bad handoffs are visible.

## 6. Deliver Flow Refinement

The handoff should have two levels of delivery:

### Reliable v0 Delivery

- Copy to clipboard
- Download markdown

These must work before any GitHub work starts.

### Agent-Friendly Delivery

- Save to a repo path such as `.noos/handoffs/active/...`

This is valuable, but it has auth, permissions, branch, overwrite, and conflict concerns. It should be designed now but implemented after the local path is proven.

Recommended GitHub stance for the first prototype:

- Include `GitHubAdapter` interface.
- Include settings model.
- Do not build full OAuth until Copy/Download workflow is stable.
- If a token-based developer mode is faster, keep it clearly labeled as local/dev only.

## 7. UI Refinement

The floating button should communicate "transport" without becoming a second assistant.

Recommended UI shape:

```text
[small floating shuttle button]
  Generate Thread
  Capture Thread
  Preview
  Copy
  Download
  Settings
```

Better than the original action grouping:

- Replace "Save / Deliver" as a primary action with concrete actions after capture: Copy, Download, GitHub.
- Before capture, delivery actions can be disabled.
- Settings should be visually secondary.

State model:

- Idle: no captured thread.
- Prompt Ready: generate prompt inserted.
- Captured: one thread selected.
- Needs Choice: multiple threads detected.
- Warning: captured thread has validation issues.
- Saved: last delivery succeeded.
- Error: operation failed.

The UI should not open a full sidebar for v0. A compact popover plus preview is enough. If preview becomes too long, use a scrollable preview region, not a page-wide panel.

## 8. Thread Format Refinement

The proposed v0.1 format is good, but it needs two additions:

1. `source_url`, when available.
2. `open_questions`, either as frontmatter or a body section.

Recommended frontmatter:

```yaml
type: noos_thread
version: 0.1
source_app: chatgpt
source_url: https://chatgpt.com/...
target_agent: codex
status: active
created_at: 2026-05-02
title: example-thread-title
tags: [noos, shuttle, handoff]
preferred_path: .noos/handoffs/active/2026-05-02-example-thread-title.md
```

Recommended required sections:

```md
# Thread: Example Thread Title

## Intent
## Context Summary
## Task
## Constraints
## Acceptance Criteria
## Suggested Next-Agent Instructions
## Open Questions
## Relevant Files or Links
```

Why add Open Questions:

Handoffs often fail because ambiguity is hidden. Making unresolved questions explicit helps the next agent decide whether to proceed, inspect, or ask.

## 9. Naming And File Path Refinement

The preferred path should be predictable, sortable, and safe:

```text
.noos/handoffs/active/YYYY-MM-DD-slug.md
```

Potential collision strategy:

```text
YYYY-MM-DD-slug.md
YYYY-MM-DD-slug-2.md
YYYY-MM-DD-slug-3.md
```

Slug rules:

- lowercase
- ASCII where possible
- spaces to hyphens
- remove unsafe filesystem characters
- max length around 60 characters before date prefix

If title is missing:

```text
YYYY-MM-DD-untitled-noos-thread.md
```

## 10. Main Risks

### Risk: ChatGPT DOM Instability

Mitigation:

- Keep selector logic isolated in `chatgpt-dom.ts`.
- Try multiple input detection strategies.
- Show clear failure messages.
- Add a small manual fallback: user can paste generated handoff into a capture textarea later if DOM capture fails.

### Risk: Markdown Fidelity

Mitigation:

- Prefer extracting from message text containers that preserve code block text.
- Validate marker and section presence.
- Keep raw extracted markdown unchanged.

### Risk: Overbuilding NOOS Too Early

Mitigation:

- Keep v0 scoped to Shuttle.
- Do not add account systems, queueing, multi-agent routing, or wiki generation.
- Treat GitHub as one storage adapter, not the core product.

### Risk: User Trust

Mitigation:

- Manual-submit default.
- Preview before delivery.
- Clear permission language.
- Copy/download always available.

## 11. Revised v0 Priority Order

The earlier plan is directionally right, but the priority should be stricter:

1. Floating UI
2. Prompt insertion
3. Marker capture
4. Validation and preview
5. Copy
6. Download
7. Extension settings
8. GitHub adapter placeholder
9. GitHub implementation

Do not start GitHub implementation before validation and preview are working.

## 12. Decision Log

- Keep browser extension as the first surface.
- Keep floating button as the default UI.
- Keep ChatGPT-generated handoff as the v0 generation mechanism.
- Keep marker-based capture as the primary detection strategy.
- Add validation warnings after capture.
- Add `Open Questions` to the thread body.
- Add `source_url` to frontmatter when available.
- Make Copy and Download the first complete delivery targets.
- Defer full GitHub save until local delivery is reliable.

## 13. Refined Implementation Slice

The first implementation should produce this exact local workflow:

```text
Open ChatGPT
  -> click NOOS Shuttle
  -> click Generate Thread
  -> review/send generated prompt
  -> wait for ChatGPT handoff output
  -> click Capture Thread
  -> preview captured markdown and validation warnings
  -> click Copy or Download
```

This slice is enough to test whether NOOS Shuttle has a real product pulse.
