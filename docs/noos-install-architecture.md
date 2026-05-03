# NOOS Install Architecture

NOOS Shuttle should install as a local desktop AI context hub, not only as a browser extension.

The goal is to connect upstream chatboxes and creative tools with downstream coding agents through a shared handoff protocol.

## System Model

```text
Desktop shell
  Tauri app, menu/window entry, local user-facing control plane

Hub core
  Rust commands and install/doctor scripts

Capture layer
  ChatGPT web, Claude web, Gemini web, Discord, Slack, Midjourney-like tools

Transport layer
  clipboard, markdown download, local inbox, GitHub, cloud storage

Workspace layer
  ~/.noos and repo/.noos

Consumer layer
  Codex, Claude Code, OpenCode, Cursor, other coding agents
```

## User-Level Hub

Global user state lives under:

```text
~/.noos/
  config.json
  inbox/
  outbox/
  skills/
  logs/
  cache/
  chrome-profile/
```

`~/.noos/config.json` stores non-sensitive preferences:

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

Do not store access tokens in NOOS config. Use native auth systems such as `gh auth login`.

## Project Workspace

Each repo can include:

```text
.noos/
  project.json
  local.json
  handoffs/
    active/
    done/
  context/
    briefs/
  skills/
    noos-consume-handoff/
AGENTS.md
CLAUDE.md
```

`.noos/project.json` is safe to commit. `.noos/local.json` is ignored and stores machine-specific preferences.

## Adapter Model

Every supported tool is an adapter:

```text
adapter id
  kind: capture | transport | consumer | workspace
  detect: check whether the tool/env exists
  install: add the needed files or instructions
  configure: write non-sensitive config
  doctor: report health and next action
```

v0 adapters:

- `workspace-kit`: create `.noos/`, `AGENTS.md`, `CLAUDE.md`
- `codex`: install `noos-consume-handoff` into `~/.codex/skills`
- `claude-code`: install `noos-consume-handoff` into `~/.claude/skills` and `.claude/skills`
- `local-inbox`: create `~/.noos/inbox`
- `github`: check `gh auth status` and repo handle
- `browser-extension`: build extension and either launch a dev profile or guide manual unpacked install
- `noos-hub`: Tauri desktop shell for status and install actions

Future adapters:

- `chatgpt-web`
- `claude-web`
- `gemini-web`
- `discord-midjourney`
- `slack`
- `teams`
- `feishu`
- `cloud-storage`

## Browser Extension Installation

Chrome does not allow ordinary scripts to silently install an unpacked extension into a user's daily Chrome profile.

NOOS supports two v0 modes:

```text
dev-profile
  Build the extension and launch a dedicated Chrome profile with --load-extension.
  This is the closest to one-command install.
  It may require signing into ChatGPT again because it uses a separate profile.

manual-unpacked
  Build the extension, open chrome://extensions, open the dist folder,
  and ask the user to enable Developer Mode and Load unpacked.
  This installs into the user's regular Chrome profile with explicit user action.
```

Future options:

- Chrome Web Store for consumer install
- Chrome Enterprise policy for managed teams

## CLI Shape

```sh
scripts/noos-install.sh all
scripts/noos-install.sh workspace
scripts/noos-install.sh consumers
scripts/noos-install.sh browser --mode dev-profile
scripts/noos-install.sh browser --mode manual-unpacked
scripts/noos-doctor.sh
```

## Desktop Hub Shape

NOOS Hub should be a desktop app, not a plain hosted web app.

Current implementation direction:

```text
apps/noos-hub/
  Tauri desktop shell
  Rust backend commands
  Vite/TypeScript UI
```

The UI is built with Web technology for iteration speed, but the product surface is a desktop app with local system access.

Run in development:

```sh
npm --prefix apps/noos-hub install
npm run hub:dev
```

First desktop MVP:

- show adapter cards
- show ready/missing/needs-action status
- run doctor
- install Codex / Claude Code consumer skills
- create local inbox
- launch NOOS browser profile
- open manual Chrome extension install flow

Later desktop capabilities:

- tray icon
- notifications
- startup item
- local daemon lifecycle
- file watching for `~/.noos/inbox`
- handoff inbox browsing

## Install State Machine

```text
detect environment
  -> install missing adapter files
  -> create or preserve config
  -> run healthchecks
  -> if a blocker exists, show the exact next user action
  -> persist resolved non-sensitive config
  -> rerun doctor
```

The installer should be recursive: after each missing handle is resolved, write it to config and continue instead of restarting.

## Product Promise

NOOS Shuttle installs a context exchange protocol into the user's AI toolchain:

```text
upstream chat or creative tool
  -> NOOS handoff
  -> transport
  -> resolver
  -> downstream coding agent
  -> result summary
```

The browser extension is one adapter in that system, not the whole product.
