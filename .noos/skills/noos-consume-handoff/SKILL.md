---
name: noos-consume-handoff
description: Use when a coding agent needs to resolve, select, and consume a NOOS handoff from inline text, an explicit file, the current repo, a local inbox/download directory, clipboard content, or a configured GitHub repository, then execute or plan the task and write a completion summary.
---

# NOOS Consume Handoff

## Purpose

Use this skill to continue work from a NOOS Thread / handoff.

The handoff is the task data. This skill is the resolver and execution protocol.

## Resolver Model

Resolve the handoff handle before consuming it.

Resolution order:

1. Inline handoff in the current conversation.
2. Explicit file path from the user.
3. Current repo active directory.
4. Clipboard content, when the user says it is in the clipboard.
5. Configured local inbox directories such as `~/NOOS/inbox` and `~/Downloads`.
6. Configured GitHub repo and handoff path.
7. Progressive setup if no source is configured or no candidate is found.

## Config Locations

User-level config:

- `~/.noos/config.json`

Project-level config:

- `.noos/project.json`
- `.noos/local.json` for local-only project state
- `.noos/local.json.example` for a safe template

Default directories:

- Active handoffs: `.noos/handoffs/active/`
- Completed handoffs: `.noos/handoffs/done/`
- Context briefs: `.noos/context/briefs/`
- Project agent instructions: `AGENTS.md` and/or `CLAUDE.md`

Do not store tokens in NOOS config. Use existing tools such as `gh auth` for GitHub authentication.

## Deterministic Resolver

When local filesystem access is available, prefer the bundled resolver:

```sh
python3 .noos/skills/noos-consume-handoff/scripts/resolve_handoff.py --repo-root .
```

Useful variants:

```sh
python3 .noos/skills/noos-consume-handoff/scripts/resolve_handoff.py --path path/to/handoff.md
python3 .noos/skills/noos-consume-handoff/scripts/resolve_handoff.py --clipboard
python3 .noos/skills/noos-consume-handoff/scripts/resolve_handoff.py --include-inbox
```

The script prints JSON candidates. If there is one candidate, consume it. If there are multiple, list them and ask the user to choose.

## Workflow

1. Check the current user message for inline NOOS markers.
2. If the user provided a path, resolve that path first.
3. Run the resolver against the current repo.
4. If the user mentioned clipboard or download, rerun the resolver with `--clipboard` or `--include-inbox`.
5. If candidates are found:
   - use the only candidate, or
   - list candidates by source, title, date, and path, then ask the user to choose.
6. If no candidates are found, enter progressive setup.
7. Read the selected handoff completely.
8. Verify it contains:
   - `<!-- NOOS:THREAD:BEGIN -->`
   - `<!-- NOOS:THREAD:END -->`
   - frontmatter with `type: noos_thread`
   - a task section
   - acceptance criteria
   - suggested next-agent instructions
9. Read `AGENTS.md` and/or `CLAUDE.md` if present.
10. Read referenced files or links when they are local and relevant.
11. Restate the task, constraints, and acceptance criteria in your own words.
12. If the handoff is ambiguous or risky, ask concise clarifying questions before editing.
13. Otherwise proceed according to the user's current instruction and the handoff.
14. At completion, write or propose a result summary.

## Progressive Setup

If the resolver cannot find a handoff, ask only for the missing handle:

- For local download flow: ask for the download directory or ask the user to move the file into `.noos/handoffs/active/`.
- For clipboard flow: ask the user to paste the handoff, or permit clipboard read if the environment supports it.
- For GitHub flow: ask for `owner/repo`, branch, and handoff path.

After the user answers, persist non-sensitive configuration:

- User-wide inbox dirs go to `~/.noos/config.json`.
- Project repo/path config goes to `.noos/project.json`.
- Machine-local preferences go to `.noos/local.json`.

Then rerun resolution. Do not restart the whole workflow.

## GitHub Resolution

Use GitHub only when the handoff is not available locally or the user explicitly asks for the repo copy.

Steps:

1. Read `.noos/project.json` for `github.repo`, `github.default_branch`, and `github.handoff_path`.
2. If missing, infer repo from `git remote get-url origin`.
3. Check `gh auth status`.
4. If not authenticated, ask the user to run `gh auth login`.
5. Use `gh api` or `gh repo view` to check access.
6. List files under the configured handoff path.
7. Fetch the chosen handoff raw content.

Never write GitHub tokens into NOOS config.

## Execution Rules

- Treat the newest user message as authoritative if it conflicts with the handoff.
- Do not blindly execute stale handoffs. Check dates and status.
- Preserve raw handoff content; do not rewrite it unless explicitly asked.
- Prefer small, reviewable changes.
- Run relevant verification before reporting completion.
- Never move a handoff to `done/` unless the user asked for lifecycle cleanup or the task is clearly complete.
- If setup changes config, tell the user exactly which config file was updated.

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
