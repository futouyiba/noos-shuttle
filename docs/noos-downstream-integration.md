# NOOS Downstream Integration

NOOS Shuttle creates handoff files. Downstream coding agents need a stable way to consume those files.

The recommended downstream model is:

```text
handoff file = task data
resolver = handoff handle discovery
skill = resolver + consumption protocol
prompt = generation protocol or one-off instruction
```

## Why Skill Over Prompt

A prompt is useful for generating a handoff in ChatGPT. It is weak as the downstream integration layer because it is not reliably discoverable inside a repository, does not define lifecycle behavior, and depends on the user manually pasting it into each coding agent session.

A skill is better for downstream agents because it defines a reusable protocol:

- where active handoffs live
- how to choose one handoff
- how to validate the handoff
- how to combine it with `AGENTS.md` or `CLAUDE.md`
- when to ask clarifying questions
- how to summarize completion
- when to move or preserve handoff files

## Handoff Resolver

Downstream agents need to resolve a handoff handle before they can consume the task.

Resolution order:

```text
inline handoff in current conversation
  -> explicit file path
  -> repo .noos/handoffs/active
  -> clipboard, when requested
  -> local inbox/download directories
  -> configured GitHub repo/path
  -> progressive setup
```

The resolver is bundled with the skill:

```text
.noos/skills/noos-consume-handoff/scripts/resolve_handoff.py
```

Example:

```sh
python3 .noos/skills/noos-consume-handoff/scripts/resolve_handoff.py --repo-root . --include-inbox
```

It returns JSON candidates with source type, path, title, date, size, and validation warnings.

## Current Skill

Canonical source:

```text
.noos/skills/noos-consume-handoff/SKILL.md
```

Supported consumers:

- Codex user skill: `~/.codex/skills/noos-consume-handoff/SKILL.md`
- Claude Code user skill: `~/.claude/skills/noos-consume-handoff/SKILL.md`
- Claude Code project skill: `.claude/skills/noos-consume-handoff/SKILL.md`

Install from this repository:

```sh
scripts/install-noos-consumer.sh
```

The installer creates or preserves:

- `~/.noos/config.json`
- `.noos/project.json`
- `.noos/local.json.example`

It does not write tokens or overwrite existing config.

## Config Layers

User-level config, not tied to one repo:

```text
~/.noos/config.json
```

Stores inbox directories and preferred auth provider:

```json
{
  "schema_version": "0.1",
  "local_inbox_dirs": ["~/NOOS/inbox", "~/Downloads"],
  "default_agent": "codex",
  "github": {
    "auth_provider": "gh",
    "default_account": null
  }
}
```

Project-level config, safe to commit:

```text
.noos/project.json
```

Stores repo handoff directories and GitHub handle:

```json
{
  "schema_version": "0.1",
  "project": "noos-shuttle",
  "handoff_dirs": {
    "active": ".noos/handoffs/active",
    "done": ".noos/handoffs/done"
  },
  "github": {
    "repo": "futouyiba/noos-shuttle",
    "default_branch": "main",
    "handoff_path": ".noos/handoffs/active"
  }
}
```

Project-local config, ignored by git:

```text
.noos/local.json
```

Stores machine-specific choices such as the last consumed handoff or preferred local inbox.

Authentication stays outside NOOS config. Use `gh auth login` for GitHub.

## Installation Model

NOOS should be distributed as a small workspace kit, not only as a browser extension.

Recommended kit contents:

```text
NOOS Shuttle browser extension
  generates, captures, previews, copies, downloads handoffs

.noos/ workspace structure
  handoffs/active/
  handoffs/done/
  context/briefs/
  skills/

agent entry files
  AGENTS.md
  CLAUDE.md

install scripts
  scripts/install-noos-consumer.sh
```

## Adoption Levels

### Level 1: Manual

The user downloads or copies a handoff markdown file into `.noos/handoffs/active/`.

This works without installing skills, but the user must explicitly tell the coding agent to read the handoff.

### Level 2: Project Kit

The repository includes:

- `.noos/skills/noos-consume-handoff/SKILL.md`
- `AGENTS.md`
- `CLAUDE.md`
- `.noos/handoffs/active/`

This makes the repo self-describing. Agents can discover the protocol even if user-level skills are not installed.

### Level 3: User-Level Install

The user runs:

```sh
scripts/install-noos-consumer.sh
```

The same skill is copied into Codex and Claude Code user-level skill directories. This makes the protocol reusable across repositories.

### Level 4: Organization Template

Teams can bake the kit into a repository template:

- committed `.noos/` structure
- committed `AGENTS.md`
- committed `CLAUDE.md`
- committed installer script
- optional CI check that validates handoff files

## Product Implication

NOOS Shuttle should eventually expose an "Install NOOS Kit" action that can add the workspace kit to a repository. The browser extension remains the upstream capture tool, but the installable kit is the downstream hub.

This resolves the missing middle:

```text
ChatGPT conversation
  -> NOOS Shuttle creates handoff
  -> handoff enters clipboard, download folder, or repository
  -> resolver finds the handoff handle
  -> installed skill consumes handoff
  -> coding agent executes
  -> result summary closes the loop
```

## References

- Claude Code skills documentation: https://code.claude.com/docs/en/skills
- Claude Code slash commands documentation: https://code.claude.com/docs/en/commands
