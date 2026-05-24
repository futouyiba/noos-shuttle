# Claude Code Instructions

This repository uses NOOS handoffs for AI-to-AI work transfer.

If `.noos/runtime/current/READ_ME_FIRST.md` exists, read it before starting. For NOOS runtime tasks, use projected sources under `.noos/runtime/current/sources/`, do not scan the full NOOS Vault unless explicitly instructed, produce a concise plan before implementation, and write the result summary to `.noos/runtime/current/RESULT_SUMMARY.md`.

When a task mentions a handoff, NOOS Thread, or `.noos/handoffs/active/`, use the `noos-consume-handoff` skill if available. If it is not installed, read `.noos/skills/noos-consume-handoff/SKILL.md` and follow the workflow there.

Project-local Claude Code skills can be installed under `.claude/skills/`. User-level Claude Code skills can be installed under `~/.claude/skills/`.
