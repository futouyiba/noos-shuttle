---
name: noos-transfer-handoff
description: Use when an agent needs to transfer a NOOS handoff from the current agent to another agent or chatbox, select the best delivery method from the NOOS Agent Registry, resolve the latest handoff, and produce target-agent consume instructions.
---

# NOOS Transfer Handoff

## Purpose

Use this skill to move work from one agent to another agent or chatbox.

This skill does not execute the downstream task. It prepares a reliable transfer:

- identify the current agent when possible
- identify or ask for the target agent
- resolve the latest or specified NOOS handoff
- consult the NOOS Agent Registry
- choose a delivery method
- generate target-agent consume instructions
- persist only non-sensitive setup when needed

## Core Files

- Agent registry: `.noos/agent-registry.json`
- Project config: `.noos/project.json`
- User config: `~/.noos/config.json`
- Active handoffs: `.noos/handoffs/active/`
- Consumer skill: `.noos/skills/noos-consume-handoff/`

## Deterministic Planner

When filesystem access is available, prefer the bundled planner:

```sh
python3 .noos/skills/noos-transfer-handoff/scripts/plan_transfer.py --repo-root . --target codex
```

Useful variants:

```sh
python3 .noos/skills/noos-transfer-handoff/scripts/plan_transfer.py --repo-root . --list-agents
python3 .noos/skills/noos-transfer-handoff/scripts/plan_transfer.py --repo-root . --target claude-code --include-inbox
python3 .noos/skills/noos-transfer-handoff/scripts/plan_transfer.py --repo-root . --target chatgpt-web --path .noos/handoffs/active/example.md
```

The script prints JSON with:

- detected current agent
- resolved target agent capabilities
- candidate handoffs
- recommended delivery method
- pasteable target-agent instruction

## Workflow

1. Read the user request for:
   - target agent, such as Codex, Claude Code, Kiro/Kuro, Cursor, Claude Desktop, ChatGPT Web
   - explicit handoff path or inline handoff
   - requested delivery, such as clipboard, repo, local file, browser extension
2. If the target is missing, list likely target agents from `.noos/agent-registry.json` and ask the user to choose.
3. Run the planner with the target and any known path.
4. If the planner returns multiple handoff candidates, list them by title, source, date, and path; ask the user to choose.
5. If the planner returns no candidates, resolve progressively:
   - ask for a file path, pasted handoff, clipboard permission, inbox directory, or GitHub repo/path
   - persist non-sensitive directory/repo preferences only after the user provides them
6. Choose delivery by registry preference unless the user asked for a specific method.
7. Produce the target-agent instruction exactly enough for the user or automation to hand off.
8. If the target supports `noos-consume-handoff` and the skill is not installed, recommend running `scripts/install-noos-consumer.sh`.

## Delivery Policy

Prefer stable, inspectable transfer paths:

1. `local_file`: best for coding agents in the same workspace.
2. `repo`: best when source and target are not on the same machine, assuming `gh auth` and repo access are already configured.
3. `clipboard`: best for desktop apps and agents without file access.
4. `browser_extension`: best for web chatboxes where the extension is installed.
5. `prompt`: fallback when no direct connector exists.

Do not store API tokens or GitHub tokens in NOOS config. Use existing authenticated tools such as `gh`.

## Target Instructions

For a coding agent with the consumer skill installed, use:

```text
Use $noos-consume-handoff to read this NOOS handoff and continue the task:
<handoff path or repo URL>
```

For a coding agent without the consumer skill, use:

```text
Read the NOOS handoff at <handoff path or repo URL>. Treat it as the task source. Restate the task, constraints, acceptance criteria, and next-agent instructions before making changes.
```

For a web chatbox or desktop chatbox, use:

```text
Please consume the following NOOS handoff. Summarize the task and continue from the "Suggested Next-Agent Instructions" section.

<handoff content or link>
```

## Setup Persistence

Persist only durable, non-sensitive setup:

- User inbox directories: `~/.noos/config.json`
- Project GitHub repo, branch, and handoff path: `.noos/project.json`
- Machine-local preferences: `.noos/local.json`

After writing config, say exactly which file changed and rerun the planner.

## Completion Output

Report:

- selected handoff
- source agent, if detected
- target agent
- delivery method
- exact instruction or next command for the target
- any setup still required
