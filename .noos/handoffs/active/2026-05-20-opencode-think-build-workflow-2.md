<!-- NOOS:THREAD:BEGIN -->
---
type: noos_thread
version: 0.1
handoff_revision: v1
source_app: chatgpt
source_url:
https://chatgpt.com/c/6a0c43a3-b65c-8321-bc3d-ec367d7363c3
target_agent: codex
status: active
created_at: 2026-05-20
title: OpenCode 双模式思考执行工作流
handoff_key: opencode-think-build
filename_slug: opencode-think-build-workflow
tags:
- opencode
- coding-agent
- chatbot-mode
- decision-capsule
- agent-workflow preferred_path: .noos/handoffs/active/2026-05-20-opencode-think-build-workflow.md
---
# 交接：OpenCode 双模式思考执行工作流
## 意图
把当前关于 Chatbot 与 Coding Agent 协作成本的讨论，沉淀为一套可由 Codex、Claude Code、OpenCode 等编码代理继续实现的工作流方案。核心目标是减少在 ChatGPT 与 Agent 之间来回复制上下文的摩擦，在 OpenCode 这类开源 agent 内部实现接近“Chatbot 思考讨论 + Agent 编码落地”的二合一体验。
## 背景摘要
当前讨论认为：Chatbot 更适合发散、锤炼想法、压缩选择和审稿；Coding Agent 更适合读取 repo、修改文件、运行命令、验证结果和产出 diff。用户当前痛点是需要在 Chatbot 和 Agent 之间手动搬运上下文，整体链路麻烦。
讨论中形成的判断是：不要试图直接复制 ChatGPT 的隐藏 system prompt，也不应期望仅靠一个 prompt 让单一 coding agent 完全复刻 ChatGPT。更可行的方案是在 OpenCode 等 agent 工具中显式拆分模式：Think/Chat/Plan 模式只讨论和压缩判断，Build/Code/Act 模式只执行明确 brief，Review 模式对照原决策审查结果。
社区经验也支持这种方向：Cline 有 Plan & Act，Aider 有 ask/code 和 Architect/Editor，Roo Code 有 Ask/Architect/Code/Debug/Orchestrator 多模式，OpenCode 本身支持 primary agents、subagents、custom agents、permissions、commands 和 AGENTS.md/rules。
## 任务
为 OpenCode 或类似开源 coding agent 设计并落地一套“思考讨论 + 执行落地”的双模式工作流，建议包括：
1. 新增一个 think primary agent：
  - 用于讨论、发散、反驳、锤炼想法、压缩选择。
  - 不允许修改文件，不允许运行命令。
  - 输出少量高质量判断，而不是长清单。
  - 讨论成熟后生成 Decision Capsule。
2. 配置或调整一个 build primary agent：
  - 用于执行已经明确的 Build-agent brief。
  - 允许在确认后编辑文件和运行命令。
  - 不重新发散方案，除非 brief 与代码库现实冲突。
  - 修改后输出 diff 摘要和验证结果。
3. 新增一个 review agent：
  - 用于对照 Decision Capsule 审查实现是否跑偏。
  - 检查遗漏、过度实现、概念漂移、违反约束等问题。
  - 默认不修改文件。
4. 新增 /crystallize command：
  - 把当前讨论压缩成 Decision Capsule。
  - 固定包含 Problem、Chosen direction、Rejected alternatives、Constraints、Acceptance criteria、Open questions、Build-agent brief。
  - 限制长度，避免生成长文。
5. 新增 /review-capsule command：
  - 读取当前 diff。
  - 对照 Decision Capsule 审查实现是否满足验收标准。
  - 输出问题列表和修正建议。
6. 使用 AGENTS.md 或 rules 固化长期项目上下文：
  - 项目结构。
  - 构建、测试、lint 命令。
  - 架构约定。
  - 禁止修改的目录或危险操作。
  - 常见坑点。
## 约束
- 不要尝试提取或复制 ChatGPT 网页版隐藏 system prompt。
- 不要把“讨论”和“执行”塞进同一个默认 Build agent。
- Chatbot-like 模式必须通过 prompt 与权限共同约束，不能只靠提示词。
- think agent 应硬性禁止 edit/bash，或至少将相关权限设为 deny。
- build agent 可以执行，但应默认 ask，不应自动 commit 或 push。
- review agent 默认只读，不应直接修改文件。
- Decision Capsule 应短小、可执行，避免把整段讨论搬进 Build agent。
- AGENTS.md / rules 只承载长期项目知识，不承载每次任务的临时决策。
- 当前交接稿只要求设计和实现工作流，不要求解决 ChatGPT 内部系统提示词可观测性问题。
- 输出和配置应优先适配 OpenCode，但概念应能迁移到 Codex、Claude Code、Cline、Aider、Roo Code 等工具。
## 验收标准
完成后应满足：
1. OpenCode 中可以切换到 think 模式进行类似 Chatbot 的讨论。
2. think 模式无法修改文件或运行 shell 命令。
3. /crystallize 可以把当前讨论压缩成固定格式的 Decision Capsule。
4. build 模式可以基于 Decision Capsule 执行实现，不重新无边界发散。
5. review 或 /review-capsule 可以读取当前改动并对照 Decision Capsule 做审查。
6. 工作流能覆盖如下链路： think -> crystallize -> build -> review 。
7. 配置中明确区分长期上下文、当前任务 brief、执行权限和审查标准。
8. 文档中解释何时使用各模式：
  - 想法模糊：think
  - 需要压缩选择：crystallize
  - 需要改代码/文档：build
  - 需要检查跑偏：review
9. 不依赖 ChatGPT 产品内不可见的系统提示词、隐藏 reasoning tokens 或前端 JavaScript。
10. 后续代理无需重读完整对话即可理解为什么要做这套模式化工作流。
## 建议给下一位代理的指令
请基于本交接稿，在目标 repo 中实现或起草 OpenCode 双模式工作流配置。优先检查仓库中是否已有
.opencode/
、
AGENTS.md
、rules、commands 或 agent 配置文件；如已有，则在现有结构上增量修改；如没有，则创建最小可用版本。
建议生成以下文件或等价配置：
- .opencode/agents/think.md
- .opencode/agents/build.md
- .opencode/agents/review.md
- .opencode/commands/crystallize.md
- .opencode/commands/review-capsule.md
- AGENTS.md 或更新既有项目规则文件
- 一份简短说明文档，例如 docs/opencode-think-build-workflow.md
think
agent 的核心行为：只讨论、不执行、不改文件、不跑命令，输出判断和 Decision Capsule。
build
agent 的核心行为：执行明确 brief，修改前检查相关文件，修改后总结 diff 和验证结果；禁止自动 commit/push。
review
agent 的核心行为：对照 capsule 审查当前实现是否偏离原决策；默认只读。
/crystallize
command 的核心输出格式：
- Problem
- Chosen direction
- Rejected alternatives
- Constraints
- Acceptance criteria
- Open questions
- Build-agent brief
/review-capsule
command 的核心检查项：
- 是否实现 Chosen direction
- 是否违反 Constraints
- 是否遗漏 Acceptance criteria
- 是否引入 Rejected alternatives
- 是否存在过度实现、概念漂移或不必要复杂度
实现时请保持配置简洁，不要把它做成庞大的多代理框架。目标是先得到一个可用、可迭代的最小系统。
## 未决问题
- 目标 repo 的实际 OpenCode 配置路径和格式是否已有约定，当前未知。
- 用户是否希望这套工作流只用于 OpenCode，还是同时生成 Claude Code / Codex / Cline / Aider 的等价配置，当前未定。
- think agent 是否允许只读类命令，例如 rg 、 git status ，当前建议先禁用 bash，后续可按需要放开。
- Decision Capsule 的长度上限尚未最终确定，当前建议不超过 500 字。
- 是否需要把该工作流纳入 NOOS/Shuttle 的长期知识库或模板系统，当前未定。
- 是否需要将 /handoff 、NOOS Thread、Decision Capsule 三种格式统一，当前未定。
## 相关文件或链接
- ChatGPT 对话来源： https://chatgpt.com/c/6a0c43a3-b65c-8321-bc3d-ec367d7363c3
- OpenCode Agents 文档： https://opencode.ai/docs/agents/
- OpenCode Rules / AGENTS.md 文档： https://opencode.ai/docs/rules/
- OpenCode Commands 文档： https://opencode.ai/docs/commands/
- Cline Plan & Act 文档： https://docs.cline.bot/core-workflows/plan-and-act
- Aider modes 文档： https://aider.chat/docs/usage/modes.html
- Aider Architect/Editor 文章： https://aider.chat/2024/09/26/architect.html
- Roo Code modes 文档： https://docs.roocode.com/basic-usage/using-modes
- AGENTS.md 项目说明： https://agents.md/
<!-- NOOS:THREAD:END -->

<!-- NOOS:HUB:SOURCE app=browser-shuttle url= -->
