# NOOS Hub 与 Shuttle 插件使用指南

这份文档面向第一次安装和日常使用 NOOS 的用户。它解释两个入口各自做什么、怎么安装、怎么用，以及使用时需要理解的核心概念。

## 一句话理解

NOOS Hub 是本机桌面中枢，负责管理本地 NOOS Vault、安装状态、Agent 投影和浏览器写入通道。

NOOS Shuttle 是浏览器插件，负责在 ChatGPT 等网页里生成、收取、导入和导出 NOOS 对象。

两者配合后的主链路是：

```text
ChatGPT / 网页工具
  -> Shuttle 收取 Handoff / Crystal / Artifact
  -> Hub 写入本机 Vault
  -> Codex / Claude Code / OpenCode 消费
  -> Result Summary 回流沉淀
```

## 核心概念

### Hub

Hub 是本机 NOOS 的控制台。它运行在你的电脑上，负责：

- 创建和维护 `~/.noos/`。
- 查看 adapter、Vault、浏览器连接和下游 agent 的状态。
- 启动 NOOS 专用浏览器 profile。
- 引导安装日常 Chrome 的 unpacked extension。
- 安装 Codex / Claude Code 的 NOOS skills。
- 接收 Shuttle 的本机写入请求，把对象保存进 NOOS Vault。
- 从 Vault 对象生成 Agent Projection，让 coding agent 按任务读取上下文。

### Shuttle 插件

Shuttle 插件是网页侧连接器。当前重点支持 ChatGPT Web：

- 生成并收取 Handoff。
- 扫描页面里已有的 Handoff 或 Crystal。
- 把收取结果复制、下载或存入 NOOS Vault。
- 从 NOOS Vault 导入最近对象，并附加到当前对话或 ChatGPT Project sources。
- 导出可见的 ChatGPT Project sources 清单到 NOOS。
- 下载当前/选中回复里的生成图片到 Browser Vault Mirror。
- 在飞书文档页面触发 Markdown 导出和 Wiki 整理入口。

### Vault

Vault 是 NOOS 的本机资料库，默认位于：

```text
~/.noos/vault/
```

它是 Markdown-first、本地优先的长期工作记忆。Hub 负责写入、索引、打开和投影；Agent 只读取被投影或明确指定的对象。

### Browser Vault Mirror

浏览器插件不能随意写入 `~/.noos/`。当 Hub 没运行或本机写入不可用时，Shuttle 会回退到浏览器可写目录：

```text
~/Downloads/NOOS/vault/
```

这叫 Browser Vault Mirror。它是恢复路径，不是最终归档位置。之后可以由 Hub 导入到真正的本机 Vault。

### Handoff

Handoff 是给下游 agent 的任务交接稿。它回答：

- 接下来要做什么？
- 背景和约束是什么？
- 验收标准是什么？
- 建议下一个 agent 怎么开始？

Codex、Claude Code 等 agent 通过 `noos-consume-handoff` skill 或 resolver 脚本读取它。

### Crystal

Crystal 是从对话中沉淀出的可复用结论。它不是“下一步任务”，而是可以长期留存、按 key 检索、以后重新投喂给 Chatbot 或 Agent 的知识对象。

### Result

Result 是某次执行的产出摘要，例如 coding agent 完成任务后的 `RESULT_SUMMARY.md`。它用于把执行结果回流到 NOOS。

### Artifact

Artifact 是具体文件或载荷，例如图片、附件、表格、patch、导出的 Markdown 包。当前 ChatGPT 生成图下载会先进入：

```text
~/Downloads/NOOS/vault/artifacts/files/
```

### Context Pack / Prompt Pack

Context Pack 是给 agent 或工具消费的一组背景材料。Prompt Pack 是反向投喂给 Chatbot 的输入包。

当前 Shuttle 可以在 ChatGPT 中开启“同时抓取完整对话 transcript”，让 `存入库` 写出包含 handoff、transcript、digest 等文件的 Context Pack。

### Runtime Projection / Agent Projection

Runtime Projection 是 Hub 从 Vault 中挑选对象后，投影到项目 `.noos/runtime/current/` 的临时任务上下文。Agent 应先读 `READ_ME_FIRST.md`、`TASK.md`、`CONTEXT_PACK.md` 和 `FILE_MAP.md`，再开始实现。

## 安装前准备

在仓库根目录执行：

```sh
npm install
npm --prefix apps/noos-hub install
```

检查环境：

```sh
scripts/noos-doctor.sh
```

如果只是使用已打包 release，按 release 包里的说明操作即可；下面命令适用于从源码仓库安装和开发验证。

## 安装并启动 Hub

启动 Hub：

```sh
npm run hub:launch
```

常用命令：

```sh
npm run hub:status
npm run hub:logs
npm run hub:stop
```

Hub 启动后，Shuttle 的 `存入库` 会优先走 Hub 本机写入通道，写入：

```text
~/.noos/vault/handoffs/active/
~/.noos/vault/crystals/active/
~/.noos/vault/context-packs/
```

如果 Hub 未运行，Shuttle 会显示 mirror 路径状态，并回退到 `~/Downloads/NOOS/vault/`。

## 安装下游 Agent 能力

让 Codex、Claude Code 等 agent 能消费 NOOS handoff：

```sh
scripts/noos-install.sh consumers
```

该命令会安装这些 skills：

```text
noos-consume-handoff
noos-transfer-handoff
noos-hub-launcher
```

安装目标包括：

```text
~/.codex/skills/
~/.claude/skills/
当前项目的 .claude/skills/
```

日常使用时，可以在 Codex 里说“打开 NOOS Hub”“继续这个 NOOS handoff”或“消费 active handoff”，agent 会优先使用这些 skill。

## 安装 Shuttle 浏览器插件

### 方式一：NOOS 专用浏览器

```sh
scripts/noos-install.sh browser --mode dev-profile
```

这个模式会：

1. 构建插件到 `dist/`。
2. 创建或复用 `~/.noos/chrome-profile`。
3. 启动一个加载了 NOOS Shuttle 的独立 Chrome profile。
4. 打开 `https://chatgpt.com/`。

优点是最接近一键可用。注意它是独立 profile，可能需要重新登录 ChatGPT。

### 方式二：安装到日常 Chrome

```sh
scripts/noos-install.sh browser --mode manual-unpacked
```

这个模式会构建插件、打开 `chrome://extensions`，并展示 `dist/` 目录。你需要手动完成：

1. 在 Chrome 扩展页开启 Developer Mode / 开发者模式。
2. 点击 Load unpacked / 加载已解压的扩展程序。
3. 选择本仓库的 `dist/` 目录。
4. 打开 `https://chatgpt.com/`，确认页面上出现 NOOS Shuttle 浮动按钮。

这是 Chrome 对日常 profile 加载 unpacked extension 的安全限制。

## ChatGPT 里怎么用

打开 ChatGPT 后，点击页面上的 NOOS Shuttle 浮动按钮。

### 生成并收取 Handoff

使用 `生成并拉取 Handoff`。Shuttle 会把 Handoff 生成提示词写入 ChatGPT，等待生成完成后自动扫描页面并收取。

如果想分步操作：

- `单独生成`：只让 ChatGPT 生成 Handoff。
- `扫描 Handoff`：只从当前页面扫描已有 Handoff。

收取后先看预览和校验提醒，再选择 `复制文本`、`下载文件` 或 `存入库`。

### 存入库

`存入库` 的优先级是：

1. Hub 已连接：写入 `~/.noos/vault/`。
2. Hub 未运行或连接失败：写入 `~/Downloads/NOOS/vault/`。

第一次直写 Hub 时，保持 Hub 运行即可。Shuttle 会自动 pair，并把本机 token 存在当前浏览器 profile 的本地存储里。

### 沉淀结晶

当对话中形成的是可复用结论，而不是要交给 agent 的任务，使用 `沉淀结晶`。Shuttle 会让 ChatGPT 输出 NOOS Crystal，并保存到：

```text
~/.noos/vault/crystals/active/
```

保存成功后会复制 `crystal_key`，之后可以用：

```sh
scripts/noos-find-crystal.sh <crystal-key>
scripts/noos-find-artifact.sh --kind crystal <crystal-key>
```

### 导入 NOOS 对象到当前对话

使用 `从 NOOS 导入` 或 `浏览文件库`。Shuttle 会从 Hub 读取最近的 Handoff、Crystal、Result，优先作为 Markdown 附件投喂当前对话；如果页面不支持附件，会退化为写入正文或下载供手动上传。

在 ChatGPT Project 页面，它也可以把对象附加到 Project sources。

### 导出 ChatGPT Project sources

在 ChatGPT Project sources 区域使用 `导出项目源到 NOOS`。当前 v0 导出的是可见 sources 的快照包，包含标题、链接、来源 URL、捕获时间和 stub 文件，不声称下载 ChatGPT 原始上传文件字节。

保存位置优先为 Hub Vault；Hub 不可用时进入：

```text
~/Downloads/NOOS/vault/context-packs/
```

### 下载当前回复图片

使用 `下载本条回复图`。Shuttle 会尽量限定在当前上下文：

1. 如果打开了图片弹窗或轮播，下载弹窗里的图片。
2. 如果选中了某条回复里的文字，下载该回复里的生成图。
3. 否则选择当前视口附近包含生成图的回复。

当前图片下载走 Browser Vault Mirror：

```text
~/Downloads/NOOS/vault/artifacts/files/chatgpt-images/
```

## Hub 里怎么用

### 查看状态

Hub 首页用于看本机 adapter 状态，例如 Vault、浏览器插件、Codex / Claude Code skills、inbox、GitHub 登录等。缺失项通常会给出可执行动作。

### 管理 Vault

Vault 页面会展示最近的 Handoff、Crystal、Result。常见动作：

- 打开源 Markdown。
- 从对象生成 Agent Projection。
- 查看对象 key、路径和来源。

### 生成 Agent Projection

当你想让 Codex 或 Claude Code 继续某个 Vault 对象时，可以在 Hub 里对该对象生成 Agent Projection。命令行等价入口是：

```sh
scripts/noos-project-runtime.sh <key-or-path>
```

它会刷新：

```text
.noos/runtime/current/
```

agent 进入项目后应先读该目录里的 `READ_ME_FIRST.md`。

### 导入 Browser Vault Mirror

如果 Shuttle 曾在 Hub 未运行时保存到 `~/Downloads/NOOS/vault/`，需要在 Hub 中执行 Import Browser Mirror，或使用对应脚本把 mirror 中的对象导入真实 Vault。

## 下游 Agent 怎么消费

在项目里，agent 应优先检查：

```text
.noos/runtime/current/READ_ME_FIRST.md
.noos/handoffs/active/
```

手动 resolver 命令：

```sh
python3 .noos/skills/noos-consume-handoff/scripts/resolve_handoff.py --repo-root . --include-inbox
```

查找本机 Vault 对象：

```sh
scripts/noos-find-artifact.sh --kind handoff <query>
scripts/noos-find-artifact.sh --kind crystal <query>
scripts/noos-find-artifact.sh --kind result <query>
scripts/noos-open.sh <key-or-text>
```

## 常见判断

### 我应该用 Handoff 还是 Crystal？

要让 agent 继续做事，用 Handoff。

要保存一段已经成型的结论，以后复用，用 Crystal。

### 我应该先开 Hub 吗？

建议先开 Hub。这样 `存入库` 会直接写入本机 Vault，并更新索引。不开 Hub 也能用，但会进入 Downloads mirror，之后需要导入。

### 为什么不能一键装进日常 Chrome？

Chrome 不允许普通脚本静默把 unpacked extension 安装进你的日常 profile。NOOS 可以启动专用 profile，也可以打开安装向导，但日常 Chrome 的最后一步必须由你手动点击 `Load unpacked`。

### Git 同步是不是自动发生？

不是。`存入库` 只表示进入本机 NOOS Vault 或 Browser Vault Mirror。把对象提交、推送到 Git 是 Hub 中的单独动作。

### Agent 能不能直接读整个 Vault？

不建议。Vault 是长期资料库，可能很大也可能包含私密材料。推荐通过 Runtime Projection 把本次任务需要的对象投影到 `.noos/runtime/current/`，让 agent 只消费这次需要的上下文。

## 最小可用路径

第一次跑通推荐按这个顺序：

```sh
npm install
npm --prefix apps/noos-hub install
npm run hub:launch
scripts/noos-install.sh consumers
scripts/noos-install.sh browser --mode dev-profile
```

然后：

1. 在专用 Chrome 登录 ChatGPT。
2. 打开一段对话，点击 NOOS Shuttle。
3. 使用 `生成并拉取 Handoff`。
4. 点击 `存入库`。
5. 回到 Hub 的 Vault 页面确认对象出现。
6. 对该对象生成 Agent Projection。
7. 在 Codex 或 Claude Code 中继续执行该任务。
