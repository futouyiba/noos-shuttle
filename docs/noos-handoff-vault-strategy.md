# NOOS Handoff Vault Strategy

## Decision

NOOS Shuttle should save handoffs to the local NOOS Hub filesystem first, then optionally sync or publish them to a Git repository.

Git should be a vault backend, not the primary write path.

## Why Local First

The handoff capture flow is an interactive user workflow. It needs to feel instant, recoverable, and tolerant of missing credentials or network failures. A local Hub-backed vault gives NOOS a stable place to write the handoff immediately:

```text
~/.noos/
  vault/
    handoffs/
      active/
      archived/
      failed-sync/
```

Local-first storage also gives the Hub a concrete job:

- show what has been captured
- validate handoffs
- expose copy/download/open actions
- queue sync attempts
- explain failures without losing the handoff

This makes NOOS visible as a local operating layer rather than a thin browser-to-Git uploader.

## Why Git Is Still Important

Git is the right backend when a handoff must become durable, shareable, auditable, or consumable by remote agents. It provides:

- version history
- team collaboration
- branch and review workflows
- access from coding agents running outside the browser session
- a durable source of truth for project-level handoffs

But Git introduces setup and runtime uncertainty:

- repository selection
- account identity
- authentication
- branch choice
- merge conflicts
- network failure
- accidental publication of sensitive context

Those are not problems the capture button should force the user to solve synchronously.

## Recommended Write Pipeline

The capture button should write to local Hub storage first:

1. Capture handoff from the chatbot page.
2. Validate the NOOS Thread structure.
3. Save a local draft or active handoff under the Hub vault.
4. Show the handoff in the panel and Hub.
5. Run selected post-capture actions: copy, download, or save to a configured vault backend.
6. If Git sync is configured and validation passes, push or stage the handoff in the configured repository.
7. If Git sync fails, keep the local handoff and show a repair action in Hub.

## Vault Backend Model

Use a stable vault abstraction:

```json
{
  "vault": {
    "primary": "local",
    "backends": [
      {
        "id": "local",
        "type": "filesystem",
        "root": "~/.noos/vault"
      },
      {
        "id": "project-git",
        "type": "git",
        "repo": "owner/repo",
        "branch": "main",
        "path": ".noos/handoffs/active"
      }
    ]
  }
}
```

The browser extension should not own this configuration directly. It should ask Hub or the installed NOOS config for the current vault settings. In v0, the extension can keep a placeholder Git adapter, but the product language should say "Vault" rather than "GitHub".

## User-Facing Behavior

Default behavior:

- always show the captured handoff in the panel
- save to local Hub vault when available
- do not copy to clipboard by default
- do not publish to Git by default

Optional automatic actions:

- Auto Copy
- Auto Download
- Auto Save

When validation passes, automatic actions may run immediately. When validation fails, automatic publishing should pause and show warnings. The local copy can still be retained, because it is a recovery point rather than a downstream delivery.

## Practical v0 Plan

1. Keep the extension UI label as `Save 2 Vault` / `存入库`.
2. Implement local Hub vault storage before making Git the default save target.
3. Keep GitHub as the first remote vault backend.
4. Let Hub own repository setup, authentication checks, sync status, and retry UI.
5. Let skills consume from both local vault and configured Git repositories.

This preserves the fast browser workflow while giving downstream agents a durable path when the user actually needs one.
