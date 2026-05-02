# Agent Instructions

This repository uses NOOS handoffs for agent-to-agent continuity.

Before editing, check `.noos/handoffs/active/`. If an active handoff exists, use the NOOS consume-handoff protocol:

- Prefer the installed `noos-consume-handoff` skill when available.
- If the skill is not installed, read `.noos/skills/noos-consume-handoff/SKILL.md` and follow it.

Do not move active handoffs to `.noos/handoffs/done/` unless the user asks for lifecycle cleanup or the task is clearly complete.
