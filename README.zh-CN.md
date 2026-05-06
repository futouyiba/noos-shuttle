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

1. 在 ChatGPT 打开 NOOS Shuttle 浮动按钮。
2. 如需合并操作，点击 `生成并收取`。
3. 如需拆开操作，点击 `单独生成` 或 `单独收取`。
4. 收取 handoff 后，预览正文和校验提醒。
5. 使用预览区旁边的手动按钮复制、下载或存入库。
6. 如果希望后续成功收取后自动复制、下载或入库，可以打开 `拉取后自动` 里的对应开关。

`存入库` 是 local-first。浏览器插件会写入 `~/Downloads/NOOS/vault/handoffs/active/` 这个 NOOS 浏览器 vault mirror；如果要把这些 handoff 提交并推送到 Git，应该在 NOOS Hub 里点击单独的 Git 同步按钮。

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
    wiki/
    handoffs/
      active/
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
git tag v0.1.1
git push origin v0.1.1
```

## 文档

- `docs/noos-install-architecture.md`：整体安装架构
- `docs/noos-downstream-integration.md`：下游 agent 集成设计
- `docs/noos-handoff-vault-strategy.md`：handoff 入库策略
- `docs/noos-shuttle-page-context-events.zh-CN.md`：浏览器页面上下文事件与状态处理
- `docs/noos-thread-format.md`：NOOS Thread v0.1 格式
- `docs/noos-shuttle-v0-design-breakdown.md`：v0 设计拆解
