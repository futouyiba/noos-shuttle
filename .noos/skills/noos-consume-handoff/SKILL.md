---
name: noos-consume-handoff
description: Use when a coding agent needs to consume a NOOS handoff from .noos/handoffs/active, select the right handoff, execute or plan the task, and write a completion summary for Codex, Claude Code, or another repository-based agent.
---

# NOOS Consume Handoff

## Purpose

Use this skill to continue work from a NOOS Thread / handoff saved in the repository.

The handoff file is the task data. This skill is the execution protocol.

## Locations

Default handoff directories:

- Active handoffs: `.noos/handoffs/active/`
- Completed handoffs: `.noos/handoffs/done/`
- Context briefs: `.noos/context/briefs/`
- Project agent instructions: `AGENTS.md` and/or `CLAUDE.md`

## Workflow

1. Inspect `.noos/handoffs/active/`.
2. If there are no active handoffs, say so and ask for the task or handoff path.
3. If there is exactly one active handoff, use it.
4. If there are multiple active handoffs, list filenames, titles, and dates, then ask the user which one to consume.
5. Read the selected handoff completely.
6. Verify it contains:
   - `<!-- NOOS:THREAD:BEGIN -->`
   - `<!-- NOOS:THREAD:END -->`
   - frontmatter with `type: noos_thread`
   - a task section
   - acceptance criteria
   - suggested next-agent instructions
7. Read `AGENTS.md` and/or `CLAUDE.md` if present.
8. Read referenced files or links when they are local and relevant.
9. Restate the task, constraints, and acceptance criteria in your own words.
10. If the handoff is ambiguous or risky, ask concise clarifying questions before editing.
11. Otherwise proceed according to the user's current instruction and the handoff.
12. At completion, write or propose a result summary.

## Execution Rules

- Treat the newest user message as authoritative if it conflicts with the handoff.
- Do not blindly execute stale handoffs. Check dates and status.
- Preserve raw handoff content; do not rewrite it unless explicitly asked.
- Prefer small, reviewable changes.
- Run relevant verification before reporting completion.
- Never move a handoff to `done/` unless the user asked for lifecycle cleanup or the task is clearly complete.

## Completion Summary

When work is complete, write a concise summary with:

- Handoff consumed
- Files changed
- Verification run
- Remaining risks or open questions

If lifecycle cleanup is requested, create a done summary at:

```text
.noos/handoffs/done/YYYY-MM-DD-<slug>-result.md
```

Use this shape:

```md
# Result: <handoff title>

## Source Handoff

- `.noos/handoffs/active/<filename>.md`

## Outcome

What changed and why.

## Verification

Commands or checks run.

## Remaining Questions

Anything unresolved.
```

## Handoff Selection Command

When the user says any of these, start this skill:

- "consume the NOOS handoff"
- "continue from the handoff"
- "read the active handoff"
- "接这个 handoff"
- "消费交接稿"
- "继续这个 NOOS Thread"
