# NOOS Shuttle

[English README](README.md)

<p align="center">
  <img src="apps/noos-hub/src/assets/noos-logo.png" alt="NOOS Hub 图标" width="128" />
  <img src="public/icons/icon-128.png" alt="NOOS Shuttle 浏览器插件图标" width="128" />
</p>

NOOS Shuttle 是一套 AI 上下文穿梭工具。它的目标不是只做一个 Chrome 插件，而是在不同 Chatbox、Agent、Coding Agent 和创作工具之间建立一套可传递、可保存、可消费的 handoff 协议。

这个仓库是 NOOS Shuttle monorepo，目前包含：

- Browser Shuttle：用于生成、捕获、校验和交付 NOOS handoff 的 Chrome 插件
- NOOS Hub：用于本机安装、adapter 状态和系统可见性的 Tauri 桌面中枢
- Agent skills：Codex 和 Claude Code 用来消费、转移 handoff 的 skills
- Installer scripts：本地安装、doctor、浏览器 profile、Hub launcher 和 release 打包脚本
- Shared protocol assets：NOOS Thread 格式文档、agent registry 和 handoff resolver 工具

当前 v0 重点：

- 在 ChatGPT 网页里生成和捕获 NOOS handoff
- 从 ChatGPT 对话中提取可复用的 NOOS 结晶，并按 key 保存
- 支持中文/英文提示词和 UI
- 将 handoff 复制、下载或存入本机 NOOS Vault
- 为 Codex、Claude Code 等下游 coding agent 安装消费 handoff 的 skill
- 提供初步的 NOOS install / doctor 脚本
- 提供 Tauri 桌面版 NOOS Hub 雏形，用来查看本机 adapter 状态和触发安装动作

## 快速安装

安装依赖：

```sh
npm install
```

检查当前 NOOS 环境：

```sh
scripts/noos-doctor.sh
```

启动桌面版 NOOS Hub：

```sh
npm install
npm --prefix apps/noos-hub install
npm run hub:launch
```

常用 Hub 命令：

```sh
npm run hub:status
npm run hub:logs
npm run hub:stop
```

NOOS Hub 是一个 Tauri 桌面 App：界面用 Web 技术实现，系统能力由 Rust 后端调用本地脚本和检查本机状态。

### Codex App 入口

Codex App 当前可以通过 skills / plugins / hooks 扩展 agent 能力，但没有公开的持久化右上角按钮注册接口。NOOS Shuttle 先提供一个稳定 launcher 作为按钮背后的执行入口：

```sh
npm run hub:launch
```

同时仓库包含 `noos-hub-launcher` skill，并可安装到 `~/.codex/skills/noos-hub-launcher`。在 Codex 里说“打开 NOOS Hub”或“查看 NOOS Hub 状态”时，Codex 应优先使用这个 launcher。等 Codex App 暴露 topbar button / quick action API 后，按钮只需要调用同一个脚本。

安装下游 agent 消费能力：

```sh
scripts/noos-install.sh consumers
```

这会安装 `noos-consume-handoff`、`noos-transfer-handoff` 和 `noos-hub-launcher` skills 到：

- `~/.codex/skills/<skill-name>`
- `~/.claude/skills/<skill-name>`
- 当前项目的 `.claude/skills/<skill-name>`

## 安装浏览器插件

Chrome 出于安全限制，普通脚本不能把 unpacked extension 静默安装进你的日常 Chrome profile。NOOS Shuttle 提供两种 v0 安装方式。

### 方式一：一键启动 NOOS 专用浏览器

```sh
scripts/noos-install.sh browser --mode dev-profile
```

这个命令会：

1. 构建扩展
2. 创建或复用 `~/.noos/chrome-profile`
3. 启动一个带 NOOS Shuttle 扩展的 Chrome / Chrome for Testing
4. 打开 `https://chatgpt.com/`

优点：最接近一键可用。

注意：这是独立 Chrome profile，可能需要重新登录 ChatGPT。

### 方式二：安装到日常 Chrome

```sh
scripts/noos-install.sh browser --mode manual-unpacked
```

这个命令会：

1. 构建扩展
2. 打开 `chrome://extensions`
3. 打开 `dist/` 目录

然后你需要手动：

1. 打开 Chrome 扩展页的 Developer Mode
2. 点击 `Load unpacked`
3. 选择本项目的 `dist/` 目录
4. 打开 `https://chatgpt.com/`，检查是否出现 NOOS Shuttle 浮动按钮

这是 Chrome 对日常 profile 中 unpacked extension 的安全要求。

## ChatGPT 工作流

NOOS 里的四个核心对象先按这个心智模型理解：

- Handoff：接下来要做什么。
- Crystal：已经沉淀了什么。
- Result：这次输出了什么。
- Artifact：具体生成或携带了什么文件、图片、表格或载荷。

1. 在 ChatGPT 打开 NOOS Shuttle 浮动按钮。
2. 如需合并操作，点击 `生成并收取`。
3. 如需拆开操作，点击 `单独生成` 或 `单独收取`。
4. 收取 handoff 后，预览正文和校验提醒。
5. 使用预览区旁边的手动按钮复制、下载或存入库。
6. 如果希望后续成功收取后自动复制、下载或入库，可以打开 `拉取后自动` 里的对应开关。

`存入库` 是 local-first。NOOS Hub 运行时，插件会通过 Hub 写入 `~/.noos/vault/handoffs/active/`。如果 Hub 不可用，插件会回退到 `~/Downloads/NOOS/vault/handoffs/active/` 这个 NOOS 浏览器 vault mirror，之后可由 Hub 导入；如果要把 handoff 提交并推送到 Git，则继续使用 Hub 里的单独 Git 同步按钮。

首次通过 Hub 直写时，只需要保持 NOOS Hub 运行，然后在插件里使用 `存入库`。Browser Shuttle 会自动连接并把本机 token 存在浏览器 profile 里；如果 Hub 不可用，则回退到 Browser Vault Mirror。

当当前对话里形成的是可复用结论，而不是要交给下游 coding agent 的任务时，使用 `提取结晶`。它会让 ChatGPT 输出 `NOOS Crystal`，Hub 可用时保存到 `~/.noos/vault/crystals/active/`，并把 `crystal_key` 复制到剪贴板。Coding agent 可以用下面的命令按 key 查找：

```sh
scripts/noos-find-artifact.sh --kind crystal <crystal-key>
scripts/noos-find-crystal.sh <crystal-key>
```

中文浏览器默认使用中文 UI 和中文提示词；英文可在 `设置` 中切换。

## 下游 Agent Kit

浏览器插件负责生成和捕获 handoff；下游 coding agent 需要 resolver 和 skill 来找到并消费 handoff。

核心 skill：

```text
.noos/skills/noos-consume-handoff/SKILL.md
.noos/skills/noos-transfer-handoff/SKILL.md
```

Resolver 脚本：

```sh
python3 .noos/skills/noos-consume-handoff/scripts/resolve_handoff.py --repo-root . --include-inbox
```

Resolver 支持：

- 当前对话里直接粘贴的 handoff
- 显式文件路径
- 当前 repo 的 `.noos/handoffs/active/`
- 剪贴板
- `~/NOOS/inbox`、`~/Downloads` 等本地 inbox
- 配置好的 GitHub repo/path

如果要按语义 key、标题、文件名、`source_url` 或正文在本机 Vault 中查找 handoff / crystal：

```sh
scripts/noos-find-artifact.sh --kind handoff <query>
scripts/noos-find-artifact.sh --kind crystal <query>
scripts/noos-find-artifact.sh --kind result <query>
scripts/noos-find-artifact.sh <query>
scripts/noos-open.sh <key-or-text>
scripts/noos-project-runtime.sh <key-or-path>
```

如果要把 NOOS 中偏长期沉淀的知识接入 LLM Wiki，可以把 NOOS 对象投影到 LLM Wiki 的 source 目录，再让 LLM Wiki 自己 ingest：

```sh
scripts/noos-sync-llm-wiki.sh --wiki-project /path/to/my-wiki
scripts/noos-sync-llm-wiki.sh --wiki-project /path/to/my-wiki --dry-run
```

这个桥接写入 `/path/to/my-wiki/raw/sources/noos/...`，不会直接写入 `/path/to/my-wiki/wiki/`。Crystal 默认视为可长期沉淀；Handoff 和 Result 默认是临时/任务型，只有显式标记 `noos_wiki: true`、`permanence: permanent` 等字段时才会进入 LLM Wiki，除非使用 `--include-temporary`。

`noos-project-runtime.sh` 会生成 `.noos/runtime/tasks/<task-key>/`，其中包含 `READ_ME_FIRST.md`、`TASK.md`、`CONTEXT_PACK.md`、`FILE_MAP.md`、`GRAPH.md`、`GRAPH.json`、`SOURCES.md`、`READ_LOG.md`、`RESULT_SUMMARY.md`、复制后的 sources、artifacts 和 output 目录。它也会写入 `.noos/runtime/current.json`，并刷新 `.noos/runtime/current/` 作为兼容镜像。

在 NOOS Hub 里，Vault 页面也提供了图形化入口：最近 Handoff / Crystal 的每一行都可以打开源文件，或直接生成给 Codex、Claude Code、OpenCode 使用的 Agent Projection。

如果要用真实构建好的浏览器插件和本机 Hub 验证反向投喂链路：

```sh
npm run build
npm run verify:extension-project
```

这个验证会启动带 `dist/` 扩展的 Chromium，打开一个 ChatGPT Project-like 验证页，通过 Hub 读取最近 Vault 对象，并检查 Shuttle 是否能把它作为 Markdown 文件附加到 Project source 的文件输入框。

Agent 转移能力：

```sh
python3 .noos/skills/noos-transfer-handoff/scripts/plan_transfer.py --repo-root . --list-agents
python3 .noos/skills/noos-transfer-handoff/scripts/plan_transfer.py --repo-root . --target claude-code
```

`noos-transfer-handoff` 会读取 `.noos/agent-registry.json`，根据目标 agent 的能力选择 `local_file`、`repo`、`clipboard`、`browser_extension` 或 `prompt` 交付方式，并生成目标 agent 可直接消费的指令。

项目入口文件：

- `AGENTS.md` 告诉 Codex 类 agent 检查 `.noos/handoffs/active/`
- `CLAUDE.md` 告诉 Claude Code 使用同一套 NOOS handoff 消费协议

## NOOS Hub 目录

用户级：

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
    packs/context/{active,archived}/
    packs/prompt/{active,sent,archived}/
    runtime/projections/{current,history}/
```

项目级：

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

`.noos/local.json` 是本机配置，已被 git ignore。不要把 token 写进 NOOS config；GitHub 登录状态交给 `gh auth login`。

## 开发和验证

构建扩展：

```sh
npm run build
```

开发监听：

```sh
npm run dev
```

完整验证：

```sh
npm run typecheck
npm test
npm run build
npm run package:release
npm run hub:build
bash -n scripts/noos-install.sh
bash -n scripts/noos-doctor.sh
```

## 发布

生成的 release 文件不提交到源码仓库。生成本地 release 产物：

```sh
npm run package:release
```

这会在 `release/` 下生成拆分产物：

- `noos-shuttle-extension-<version>.zip`：浏览器插件包
- `noos-agent-skills-<version>.tar.gz`：下游 agent skills 和入口说明
- `noos-hub-source-<version>.tar.gz`：Hub 源码和本地安装脚本

`release/*.zip` 和 `release/*.tar.gz` 已被 git ignore。

正式发布使用 GitHub Releases：推送 `v*` tag 会触发 `.github/workflows/release.yml`，在 CI 中运行类型检查、测试、打包，构建 macOS Hub bundle，并把拆分产物上传到对应 GitHub Release。

```sh
git tag v0.1.2
git push origin v0.1.2
```

## 文档

- `docs/noos-install-architecture.md`：整体安装架构
- `docs/noos-downstream-integration.md`：下游 agent 集成设计
- `docs/noos-handoff-vault-strategy.md`：handoff 入库策略
- `docs/noos-llm-wiki-bridge.md`：NOOS 到 LLM Wiki source 层桥接设计
- `docs/noos-vault-object-model.md`：Vault 对象模型、key/index、入库协议、上下文投喂和 runtime projection
- `docs/noos-hub-local-write-channel.md`：Hub 本机写入通道设计和风险
- `docs/noos-shuttle-page-context-events.zh-CN.md`：浏览器页面上下文事件与状态处理
- `docs/noos-thread-format.md`：NOOS Thread v0.1 格式
- `docs/noos-shuttle-v0-design-breakdown.md`：v0 设计拆解
