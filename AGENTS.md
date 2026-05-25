# Agent Instructions

This repository uses NOOS handoffs for agent-to-agent continuity.

## NOOS Runtime Context

If `.noos/runtime/current/READ_ME_FIRST.md` exists, read it before starting any task.

For NOOS runtime tasks:

1. Read the runtime task files first.
2. Do not scan the full NOOS Vault unless explicitly instructed.
3. Use projected sources under `.noos/runtime/current/sources/`.
4. Produce a concise plan before implementation.
5. Write the result summary to `.noos/runtime/current/RESULT_SUMMARY.md`.

Before editing, check `.noos/handoffs/active/`. If an active handoff exists, use the NOOS consume-handoff protocol:

- Prefer the installed `noos-consume-handoff` skill when available.
- If the skill is not installed, read `.noos/skills/noos-consume-handoff/SKILL.md` and follow it.

Do not move active handoffs to `.noos/handoffs/done/` unless the user asks for lifecycle cleanup or the task is clearly complete.
