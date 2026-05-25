# NOOS Shuttle

[Chinese README](README.zh-CN.md)

<p align="center">
  <img src="apps/noos-hub/src/assets/noos-logo.png" alt="NOOS Hub icon" width="128" />
  <img src="public/icons/icon-128.png" alt="NOOS Shuttle browser extension icon" width="128" />
</p>

NOOS Shuttle is a context-transfer toolkit for AI workflows. It is not just a Chrome extension; it defines a handoff protocol that lets Chatboxes, Agents, coding agents, and creative tools pass context to each other in a form that can be generated, saved, and consumed.

This repository is a NOOS Shuttle monorepo. It currently contains:

- Browser Shuttle: the Chrome extension that generates, captures, validates, and delivers NOOS handoffs
- NOOS Hub: the Tauri desktop control plane for local install, adapter status, and system visibility
- Agent skills: Codex and Claude Code skills for consuming and transferring handoffs
- Installer scripts: local install, doctor, browser profile, Hub launcher, and release packaging scripts
- Shared protocol assets: NOOS Thread format docs, agent registry, and handoff resolver utilities

Current v0 focus:

- Generate and capture NOOS handoffs in ChatGPT Web
- Extract reusable NOOS Crystals from ChatGPT conversations and save them by key
- Support Chinese and English prompts and UI
- Copy, download, or save handoffs into the local NOOS Vault
- Install downstream handoff-consumption skills for Codex, Claude Code, and similar coding agents
- Provide initial NOOS install and doctor scripts
- Provide an early Tauri desktop NOOS Hub for local adapter status and install actions

## Quick Install

Install dependencies:

```sh
npm install
```

Check the current NOOS environment:

```sh
scripts/noos-doctor.sh
```

Launch the desktop NOOS Hub:

```sh
npm install
npm --prefix apps/noos-hub install
npm run hub:launch
```

Common Hub commands:

```sh
npm run hub:status
npm run hub:logs
npm run hub:stop
```

NOOS Hub is a Tauri desktop app. Its interface is built with web technologies, while system-level actions are handled by a Rust backend that calls local scripts and checks machine state.

### Codex App Entry Point

The Codex App can currently extend agent behavior through skills, plugins, and hooks, but it does not expose a public persistent top-right button registration API. NOOS Shuttle provides a stable launcher that can be used behind such an entry point:

```sh
npm run hub:launch
```

This repository also includes the `noos-hub-launcher` skill, which can be installed to `~/.codex/skills/noos-hub-launcher`. When you ask Codex to open NOOS Hub or check NOOS Hub status, Codex should prefer this launcher. Once Codex App exposes a topbar button or quick action API, that button only needs to call the same script.

Install downstream agent consumption capabilities:

```sh
scripts/noos-install.sh consumers
```

This installs the `noos-consume-handoff`, `noos-transfer-handoff`, and `noos-hub-launcher` skills to:

- `~/.codex/skills/<skill-name>`
- `~/.claude/skills/<skill-name>`
- The current project at `.claude/skills/<skill-name>`

## Install the Browser Extension

For security reasons, Chrome does not allow ordinary scripts to silently install an unpacked extension into your everyday Chrome profile. NOOS Shuttle provides two v0 installation modes.

### Option 1: Launch a Dedicated NOOS Browser

```sh
scripts/noos-install.sh browser --mode dev-profile
```

This command:

1. Builds the extension
2. Creates or reuses `~/.noos/chrome-profile`
3. Launches Chrome or Chrome for Testing with the NOOS Shuttle extension loaded
4. Opens `https://chatgpt.com/`

Benefit: closest to one-command usage.

Note: this is a separate Chrome profile, so you may need to sign in to ChatGPT again.

### Option 2: Install into Everyday Chrome

```sh
scripts/noos-install.sh browser --mode manual-unpacked
```

This command:

1. Builds the extension
2. Opens `chrome://extensions`
3. Reveals the `dist/` directory

Then manually:

1. Enable Developer Mode on the Chrome extensions page
2. Click `Load unpacked`
3. Select this project's `dist/` directory
4. Open `https://chatgpt.com/` and check that the NOOS Shuttle floating button appears

This is Chrome's security requirement for unpacked extensions in a regular profile.

## ChatGPT Workflow

NOOS uses four primary object meanings:

- Handoff: what to do next.
- Crystal: what has already been distilled.
- Result: what this run produced.
- Artifact: what concrete file, image, table, or payload was generated or carried.

1. Open the NOOS Shuttle floating button in ChatGPT.
2. For the combined workflow, click `Generate & Collect`.
3. For split operations, click `Generate Only` or `Collect Only`.
4. After a handoff is collected, review the preview and validation warnings.
5. Use the manual buttons near the preview to copy, download, or save the handoff.
6. Use the `Auto after collect` toggles if you want future successful captures to copy, download, or save automatically.
7. Enable `Capture full conversation transcript` when you want `Save 2 Vault` to write a NOOS Context Pack with `handoff.md`, `transcript.full.md`, `transcript.index.json`, `key-excerpts.md`, `decision-capsule.md`, and `execution-digest.md`.

`Save 2 Vault` is local-first. When NOOS Hub is running, the extension writes through Hub to `~/.noos/vault/handoffs/active/`. If Hub is unavailable, the extension falls back to the browser vault mirror under `~/Downloads/NOOS/vault/handoffs/active/`, which Hub can import later. Git sync remains a separate Hub action when you want handoffs committed and pushed for remote agents.

For first-time direct Hub writes, keep NOOS Hub running and use `Save 2 Vault`. Browser Shuttle connects automatically and stores a local token in the browser profile. If Hub is unavailable, saves fall back to the Browser Vault Mirror.

When full transcript capture is enabled, Context Packs are written under `~/.noos/vault/context-packs/` through Hub, or under `~/Downloads/NOOS/vault/context-packs/` as the browser mirror fallback. Long ChatGPT conversations may be marked partial when the page does not expose a reliable scroll path to prove all turns were loaded.

Use `Extract Crystal` when the current conversation contains reusable conclusions rather than a downstream coding task. It asks ChatGPT to produce a `NOOS Crystal`, saves it to `~/.noos/vault/crystals/active/` when Hub is available, and copies the `crystal_key` to the clipboard. Coding agents can locate it with:

```sh
scripts/noos-find-artifact.sh --kind crystal <crystal-key>
scripts/noos-find-crystal.sh <crystal-key>
```

Chinese browsers default to Chinese UI and Chinese prompts. You can switch languages in `Settings`.

## Downstream Agent Kit

The browser extension generates and captures handoffs. Downstream coding agents need a resolver and skill to find and consume those handoffs.

Core skills:

```text
.noos/skills/noos-consume-handoff/SKILL.md
.noos/skills/noos-transfer-handoff/SKILL.md
```

Resolver script:

```sh
python3 .noos/skills/noos-consume-handoff/scripts/resolve_handoff.py --repo-root . --include-inbox
```

The resolver supports:

- Handoffs pasted directly into the current conversation
- Explicit file paths
- The current repository's `.noos/handoffs/active/`
- Clipboard content
- Local inbox directories such as `~/NOOS/inbox` and `~/Downloads`
- A configured GitHub repository and handoff path

For local Vault lookup by semantic key, title, filename, `source_url`, or body text:

```sh
scripts/noos-find-artifact.sh --kind handoff <query>
scripts/noos-find-artifact.sh --kind crystal <query>
scripts/noos-find-artifact.sh --kind result <query>
scripts/noos-find-artifact.sh <query>
scripts/noos-open.sh <key-or-text>
scripts/noos-project-runtime.sh <key-or-path>
```

To bridge durable NOOS knowledge into an LLM Wiki project, project NOOS objects into the LLM Wiki source folder and let LLM Wiki ingest them:

```sh
scripts/noos-sync-llm-wiki.sh --wiki-project /path/to/my-wiki
scripts/noos-sync-llm-wiki.sh --wiki-project /path/to/my-wiki --dry-run
```

The bridge writes to `/path/to/my-wiki/raw/sources/noos/...`, not directly to `/path/to/my-wiki/wiki/`. Crystals are treated as durable by default. Handoffs and Results must be explicitly marked with fields such as `noos_wiki: true` or `permanence: permanent`, unless you pass `--include-temporary`.

`noos-project-runtime.sh` creates `.noos/runtime/tasks/<task-key>/` with `READ_ME_FIRST.md`, `TASK.md`, `CONTEXT_PACK.md`, `FILE_MAP.md`, `GRAPH.md`, `GRAPH.json`, `SOURCES.md`, `READ_LOG.md`, `RESULT_SUMMARY.md`, copied sources, artifacts, and output directories. It also writes `.noos/runtime/current.json` and refreshes `.noos/runtime/current/` as a compatibility mirror.

In NOOS Hub, the Vault page also exposes this path visually: each recent Handoff / Crystal row can open the source file or generate an Agent Projection for Codex, Claude Code, and OpenCode.

To verify the reverse path with the real built extension and local Hub:

```sh
npm run build
npm run verify:extension-project
```

The verifier launches Chromium with `dist/` loaded as an extension, opens a ChatGPT Project-like fixture, reads a recent Vault object through Hub, and checks that Shuttle attaches it as a Markdown file to the Project source file input.

Agent transfer capability:

```sh
python3 .noos/skills/noos-transfer-handoff/scripts/plan_transfer.py --repo-root . --list-agents
python3 .noos/skills/noos-transfer-handoff/scripts/plan_transfer.py --repo-root . --target claude-code
```

`noos-transfer-handoff` reads `.noos/agent-registry.json`, selects a delivery method based on the target agent's capabilities, and generates target-agent consumption instructions. Supported delivery methods include `local_file`, `repo`, `clipboard`, `browser_extension`, and `prompt`.

Project entry files:

- `AGENTS.md` tells Codex-style agents to check `.noos/handoffs/active/`
- `CLAUDE.md` tells Claude Code to use the same NOOS handoff consumption protocol

## NOOS Hub Directories

User-level:

```text
~/.noos/
  config.json
  inbox/
  outbox/
  logs/
  cache/
  chrome-profile/
  vault/
    index/{keys.json,objects.json,graph.json,backlinks.json}
    handoffs/{active,done,archived}/
    crystals/{active,curated,archived}/
    results/{inbox,accepted,archived}/
    artifacts/{files,sidecars,thumbs}/
    wiki/
    context-packs/
    packs/context/{active,archived}/
    packs/prompt/{active,sent,archived}/
    runtime/projections/{current,history}/
```

Project-level:

```text
.noos/
  agent-registry.json
  project.json
  local.json
  handoffs/
    active/
    done/
  crystals/
    active/
    done/
  runtime/
    current/
    current.json
    tasks/
  context/
    briefs/
  skills/
```

`.noos/local.json` is machine-local configuration and is ignored by git. Do not write tokens into NOOS config files; GitHub authentication should be handled by `gh auth login`.

## Development and Verification

Build the extension:

```sh
npm run build
```

Development watch mode:

```sh
npm run dev
```

Full verification:

```sh
npm run typecheck
npm test
npm run build
npm run package:release
npm run hub:build
bash -n scripts/noos-install.sh
bash -n scripts/noos-doctor.sh
```

## Release

Generated release files are not committed to the source repository. Generate local release artifacts with:

```sh
npm run package:release
```

This creates separate artifacts under `release/`:

- `noos-shuttle-extension-<version>.zip`: browser extension package
- `noos-agent-skills-<version>.tar.gz`: downstream agent skills and entry instructions
- `noos-hub-source-<version>.tar.gz`: Hub source and local install scripts

`release/*.zip` and `release/*.tar.gz` are ignored by git.

Official releases use GitHub Releases. Pushing a `v*` tag triggers `.github/workflows/release.yml`, which runs type checks, tests, packaging, builds the macOS Hub bundle, and uploads separated artifacts to the matching GitHub Release.

```sh
git tag v0.1.2
git push origin v0.1.2
```

## Documentation

- `docs/noos-install-architecture.md`: install architecture
- `docs/noos-downstream-integration.md`: downstream agent integration design
- `docs/noos-context-pack-background-layer.md`: Context Pack / transcript background layer design review
- `docs/noos-handoff-vault-strategy.md`: handoff vault storage strategy
- `docs/noos-llm-wiki-bridge.md`: NOOS to LLM Wiki source bridge design
- `docs/noos-vault-object-model.md`: Vault object model, key/index, ingest protocol, prompt feeding, and runtime projection
- `docs/noos-hub-local-write-channel.md`: Hub-owned local write channel design and risks
- `docs/noos-shuttle-page-context-events.md`: browser page context event and state handling
- `docs/noos-thread-format.md`: NOOS Thread v0.1 format
- `docs/noos-shuttle-v0-design-breakdown.md`: v0 design breakdown
