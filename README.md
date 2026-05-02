# NOOS Shuttle

NOOS Shuttle packages AI conversations into agent-ready handoff threads.

Canonical names:

- Product name: NOOS Shuttle
- Local project folder: `noos-shuttle`
- GitHub repository name: `noos-shuttle`
- Browser extension name: NOOS Shuttle

Current focus: v0 browser extension design for generating, capturing, validating, previewing, copying, and downloading structured NOOS Thread handoffs from ChatGPT.

## Local Prototype

NOOS Shuttle v0 is implemented as a Chrome-compatible Manifest V3 extension.

Install dependencies:

```sh
npm install
```

Build the extension:

```sh
npm run build
```

Load it locally:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select the generated `dist/` directory.
5. Open `https://chatgpt.com/` and look for the floating `NS` button.

Development loop:

```sh
npm run dev
```

Verification:

```sh
npm run typecheck
npm test
npm run build
```

## v0 Workflow

1. Click the floating `NS` button on ChatGPT.
2. Click `生成交接稿` / `Draft Handoff` to insert the handoff prompt.
3. Review and send the prompt in ChatGPT.
4. After ChatGPT responds, click `收取交接稿` / `Collect Handoff`.
5. Preview warnings if any.
6. Copy the captured handoff or download it as markdown.

GitHub delivery exists as a placeholder adapter. Copy and download are the reliable v0 delivery paths.

## Downstream Agent Kit

NOOS Shuttle is not only a browser extension. The extension creates handoff files; downstream coding agents need a stable protocol for consuming them.

This repo includes a NOOS consume-handoff skill:

```text
.noos/skills/noos-consume-handoff/SKILL.md
```

The skill includes a resolver script that helps downstream agents find the handoff handle:

```sh
python3 .noos/skills/noos-consume-handoff/scripts/resolve_handoff.py --repo-root . --include-inbox
```

Install it for Codex and Claude Code:

```sh
scripts/install-noos-consumer.sh
```

The installer copies the skill to:

- `~/.codex/skills/noos-consume-handoff`
- `~/.claude/skills/noos-consume-handoff`
- `.claude/skills/noos-consume-handoff`

Repository entry files:

- `AGENTS.md` tells Codex-style agents to check `.noos/handoffs/active/`.
- `CLAUDE.md` tells Claude Code to use the same NOOS consume-handoff protocol.

See `docs/noos-downstream-integration.md` for the installation model and product design.

## Language

NOOS Shuttle supports Chinese and English in the popover UI and prompt template.

- Default language follows the browser language.
- Chinese browsers default to Chinese UI and Chinese handoff prompts.
- English is available from `设置` / `Settings`.
- The NOOS markers and YAML frontmatter keys remain stable in English for machine parsing.
- Chinese handoff bodies are validated with Chinese section headings such as `## 意图`, `## 背景摘要`, and `## 验收标准`.
