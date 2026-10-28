# NOOS：LLM 时代的 Markdown Context Hub 与 Chatbot 推敲工作流设计

> 状态：概念沉淀 / 工作流初稿
> 日期：2026-05-05
> 主题：NOOS 定义、Chatbot 可插拔、文档推敲管理、Prompt 与状态机设计

---

## 1. NOOS 的重新定义

NOOS 不应该被定义为一个“文档生产工具”。

“写策划文档”只是 NOOS 的一个高价值应用场景，而不是 NOOS 的本体。

更准确的定义是：

> **NOOS 是 LLM 时代的文本 / Markdown 枢纽。**

它负责把人的想法、Chatbot 对话、Agent 产物、Wiki 知识、任务交接、评审意见、代码上下文、会议记录、网页资料等，统一沉淀、组织、转换、分发。

进一步说：

> **NOOS 是一个以 Markdown 为统一中间层的上下文操作系统。**

在 LLM 时代，大部分复杂工作都会经过“文本”这个枢纽：

* 策划文档；
* 产品需求；
* 技术方案；
* 会议纪要；
* Prompt；
* Agent Task；
* Review Comment；
* Debug Log；
* Wiki Note；
* 代码解释；
* 多 Agent 争论结果；
* 决策记录；
* 项目状态；
* 知识索引；
* Handoff；
* SOP；
* 任务拆解。

这些对象表面上不是同一类东西，但底层都可以被 Markdown 化、结构化、链接化、版本化。

所以，NOOS 不只是“帮人写文档”，而是：

> **把所有可以进入 LLM 工作流的文本对象，变成可管理、可路由、可复用、可沉淀的上下文资产。**

---

## 2. NOOS 的核心定位

NOOS 可以被理解为三个层面的系统。

### 2.1 NOOS 是文本对象的 Hub

NOOS 接收来自不同地方的文本对象：

```text
ChatGPT 对话
Claude 对话
Codex / Claude Code 任务
会议记录
飞书文档
GitHub Issue / PR
Wiki 页面
用户随手笔记
Agent 输出
浏览器网页内容
```

然后将它们转成统一的 Markdown / Block / Packet。

重点不是“存起来”，而是让这些文本对象可以被后续工作流继续消费。

---

### 2.2 NOOS 是上下文的 Router

NOOS 不只是知识库，也不只是 Wiki。

普通 Wiki 更偏向：

> 人查资料。

NOOS 更偏向：

> 人和 Agent 都可以消费的上下文路由系统。

它要判断：

```text
哪些内容要送给 ChatGPT
哪些内容要送给 Claude
哪些内容要送给 Codex
哪些内容要写入 Wiki
哪些内容要变成 Handoff
哪些内容要进入长期记忆
哪些内容只是临时上下文
哪些内容应该被压缩
哪些内容应该保留原文
哪些内容应该作为证据
哪些内容只是启发
```

因此，NOOS 的价值不只是存储，而是组织、选择、压缩、分发和回收。

---

### 2.3 NOOS 是 Chatbot / Agent 的可插拔中枢

NOOS 不应该绑定某一个模型，也不应该绑定某一个 Chatbot。

未来可能同时存在：

```text
ChatGPT：主对话、综合、表达
Claude：长文、审稿、反思
Gemini：资料搜索、跨模态、多角度补充
Codex：代码执行和修改
Claude Code：代码库内 Agent
OpenCode：本地 Coding Agent
Kiro：规格化开发流
自建 API Agent：批量、稳定、可追踪任务
```

NOOS 的核心角色是：

> 保存上下文，生成上下文包，把上下文投递给合适的模型，再把结果回收回来。

因此，Chatbot 可插拔是 NOOS 的关键设计原则。

NOOS 不应该成为“另一个 Chatbot”。

NOOS 应该成为：

> **让所有 Chatbot 和 Agent 接入同一个上下文系统的中枢。**

---

## 3. NOOS 的基本架构

NOOS 可以拆成三层：

```text
Noos Core
Browser Shuttle
Agent Runner
```

---

### 3.1 Noos Core：Markdown Context Hub

Noos Core 是系统的核心。

它负责：

* Markdown 仓库；
* Wiki；
* Inbox；
* Handoff；
* Context Packet；
* 标签；
* 反向链接；
* 摘要；
* 版本；
* 决策记录；
* Prompt 模板库；
* Agent 产物归档；
* 文档状态管理；
* 上下文压缩与召回。

这一层必须掌握上下文主权。

如果上下文主权交给 ChatGPT 网页或 Claude 网页，那么所有重要思考都会散落在不同的对话里，无法沉淀、追踪、复用。

---

### 3.2 Browser Shuttle：Chatbot Connector

Browser Shuttle 是浏览器插件 / 桥梁层。

它负责连接：

* ChatGPT 网页；
* Claude 网页；
* Gemini 网页；
* Perplexity 网页；
* 其他网页型 Agent。

它的主要职责是：

* 从 Noos 中选择上下文；
* 把 Context Packet 注入 Chatbot；
* 一键发送结构化 Prompt；
* 读取 Chatbot 回复；
* 回收结果；
* 多 Tab 编排；
* 显示当前任务状态；
* 把网页 Chatbot 变成 NOOS 的外接执行器。

Browser Shuttle 的定位应该是：

> **Shuttle / Bridge / Remote Control。**

不应该是：

> **Brain / Database / Source of Truth。**

插件不应该保存过多核心状态。核心状态应该回写 Noos Core。

---

### 3.3 Agent Runner：Executable Context Worker

Agent Runner 是 NOOS 自己调用模型 API 或本地 Agent 的执行层。

它适合做稳定、批量、可追踪的任务，例如：

* 批量整理 Markdown；
* 生成摘要；
* 评审方案；
* 跑多 Agent 争论；
* 生成代码任务；
* 处理知识库；
* 生成 handoff；
* 分析日志；
* 检查文档一致性；
* 生成任务包给 Codex / Claude Code。

网页 Chatbot 适合人机协作。
Agent Runner 适合可控自动化。

二者不冲突。

---

## 4. NOOS 的核心对象

为了让系统能够长期演化，需要把一些核心对象标准化。

### 4.1 Markdown Document

文档本体。

可能是：

* 策划文档；
* 技术文档；
* 会议纪要；
* Handoff；
* Prompt 说明；
* 系统设计；
* 代码任务；
* 评审记录。

建议带 Frontmatter：

```yaml
type: design_doc
id: doc-20260505-noos-chatbot-deliberation
project: noos-mem
system: noos-core
status: draft
tags: [markdown-hub, chatbot-connector, context-packet, deliberation]
created_at: 2026-05-05
updated_at: 2026-05-05
```

---

### 4.2 Context Packet

Context Packet 是 NOOS 向 Chatbot / Agent 投递上下文的标准格式。

它不是完整文档，而是一次任务所需要的“上下文包”。

示例：

```yaml
type: context_packet
project: noos-mem
system: chatbot-deliberation
task: critique_design_doc
source_docs:
  - wiki/noos/definition.md
  - wiki/noos/browser-shuttle.md
current_goal: >
  帮助用户推敲一篇关于 NOOS 的系统设计文档。
constraints:
  - 保留用户原始判断
  - 区分事实、假设、推论
  - 不直接替用户做最终决策
  - 输出可写入 Wiki 的 Markdown
known_decisions:
  - NOOS 是 Markdown Context Hub
  - Chatbot 可插拔
  - Noos Core 掌握上下文主权
open_questions:
  - 文档推敲状态机如何设计
  - Prompt 快捷按钮如何和状态管理结合
requested_action: critique_and_rewrite
```

Context Packet 是 NOOS 的关键中间格式。

它可以被：

* ChatGPT 网页使用；
* Claude 网页使用；
* Noos API Agent 使用；
* Codex / Claude Code 使用；
* Wiki ingest pipeline 使用；
* handoff 系统使用。

只要这个格式稳定，前端和模型都可以替换。

---

### 4.3 Prompt Template

Prompt Template 是可复用的操作模板。

它不只是普通 prompt，而应该包含：

* 适用阶段；
* 输入要求；
* 输出格式；
* 是否修改正文；
* 是否生成评审意见；
* 是否生成决策记录；
* 是否允许引入外部上下文；
* 是否需要保留原文。

示例：

```yaml
type: prompt_template
id: prompt-critique-design-doc
name: 设计文档评审
stage: critique
input:
  - current_document
  - context_packet
output:
  - critique_report
  - revision_suggestions
mode: non_destructive
```

---

### 4.4 Review Pass

Review Pass 是一次推敲 / 评审 / 修改过程的记录。

它应该记录：

* 谁发起；
* 使用了哪个 Chatbot / Agent；
* 使用了哪个 Prompt；
* 输入了哪些上下文；
* 输出了什么；
* 人是否采纳；
* 采纳了哪些内容；
* 拒绝了哪些内容；
* 是否产生新的 unresolved questions。

示例：

```yaml
type: review_pass
id: pass-20260505-001
doc_id: doc-20260505-noos-chatbot-deliberation
stage: critique
executor: chatgpt-web
prompt_id: prompt-critique-design-doc
status: reviewed
human_decision: partially_accepted
created_at: 2026-05-05
```

---

### 4.5 Decision Record

Decision Record 用来沉淀已经明确的判断。

示例：

```yaml
type: decision_record
id: decision-20260505-chatbot-pluggable
status: accepted
decision: Chatbot should be pluggable executors, not the source of truth.
rationale: >
  NOOS should control context, state, markdown assets, and routing.
  Chatbots provide external reasoning and generation capacity.
impact:
  - Browser Shuttle should not own durable state.
  - Noos Core must store context packets and review traces.
```

---

## 5. 用 Chatbot 做文档推敲的核心问题

在用 Chatbot 推敲文档时，真正的问题不是“怎么让它改写得更好”。

真正的问题是：

> **如何管理一篇文档在多轮推敲中的状态、上下文、版本、意见、采纳与决策。**

如果没有管理机制，Chatbot 推敲会变成：

* 对话散落；
* 版本混乱；
* 改了哪里不知道；
* 为什么改不知道；
* 哪些意见被采纳不知道；
* 哪些问题还没解决不知道；
* 同一个文档被不同 Chatbot 反复生成，却没有沉淀。

因此，NOOS 要解决的不是单次生成，而是：

> **文档推敲生命周期管理。**

---

## 6. 文档推敲状态机设计

高质量文档不是一次生成的，而是经过一系列阶段。

可以先设计一个通用状态机：

```text
Captured
  ↓
Framed
  ↓
Contextualized
  ↓
Drafted
  ↓
Critiqued
  ↓
Reflected
  ↓
Revised
  ↓
Decisioned
  ↓
Published / Handed Off
```

其中，每一步都应该允许：

* 人介入；
* 跳过；
* 回退；
* 重跑；
* 换模型；
* 换 Prompt；
* 只生成建议，不改正文；
* 直接修改正文；
* 沉淀为 Decision Record。

---

### 6.1 Captured：捕获

目标：把用户的原始想法、对话、碎片、会议记录捕获下来。

输入可能是：

* 用户口述；
* ChatGPT 对话；
* 会议纪要；
* 飞书消息；
* 临时笔记；
* Agent 输出。

输出：

* 原始文本；
* 初步标题；
* 可能所属系统；
* 可能标签；
* 初步问题列表；
* 待确认事项。

可用按钮：

* `整理为原始笔记`
* `提取核心问题`
* `生成初步标题和标签`
* `转成 Handoff`

人类参与点：

* 确认这段内容是否值得沉淀；
* 确认归属项目 / 系统；
* 删除明显无用内容；
* 补充背景。

---

### 6.2 Framed：定框

目标：把混乱想法转成明确问题。

需要回答：

* 这篇文档到底要解决什么问题？
* 它不解决什么问题？
* 读者是谁？
* 使用场景是什么？
* 它是方案、分析、决策记录、还是任务交接？
* 成功标准是什么？

输出：

* Problem Statement；
* Scope / Non-scope；
* Target Reader；
* Acceptance Criteria；
* Open Questions。

可用按钮：

* `定义问题`
* `限定范围`
* `生成验收标准`
* `提取隐含前提`
* `识别读者视角`

人类参与点：

* 决定文档用途；
* 判断哪些内容不写；
* 明确读者和验收标准。

---

### 6.3 Contextualized：上下文化

目标：从 Wiki / Inbox / 旧文档 / 相关讨论中召回上下文。

系统需要判断：

* 哪些旧文档相关；
* 哪些是决策依据；
* 哪些只是背景；
* 哪些旧结论已经废弃；
* 哪些需要压缩；
* 哪些必须保留原文。

输出：

* Context Packet；
* Source Docs；
* Known Decisions；
* Conflicts；
* Related Open Questions。

可用按钮：

* `查找相关 Wiki`
* `生成上下文包`
* `压缩背景材料`
* `列出相关旧决策`
* `检查冲突结论`

人类参与点：

* 确认哪些上下文真的相关；
* 排除误召回内容；
* 标记关键证据；
* 添加遗漏背景。

---

### 6.4 Drafted：起草

目标：生成文档初稿。

起草时应该根据文档类型使用不同结构。

例如，策划文档可以使用四层结构：

```text
体验目标
  → 基本达成策略
    → 简要匡算
      → 具体设计与数值表
```

系统设计文档可以使用：

```text
背景
问题
目标
非目标
核心概念
架构方案
对象模型
流程
风险
下一步
```

输出：

* Draft v0.1；
* 摘要；
* 结构目录；
* 缺口标注。

可用按钮：

* `生成初稿`
* `按四层结构生成`
* `按系统设计结构生成`
* `按决策记录结构生成`
* `只生成目录`
* `从目录扩写正文`

人类参与点：

* 选择文档结构；
* 调整章节顺序；
* 补充关键判断；
* 删除不合适的自动扩写。

---

### 6.5 Critiqued：评审

目标：从不同视角审查文档。

可以内置多种评审角色：

* 逻辑评审；
* 结构评审；
* 读者视角评审；
* 反方评审；
* 工程实现评审；
* 主策 / 产品负责人视角；
* CEO 决策视角；
* 用户体验视角；
* 风险评审；
* 证据评审。

输出：

* 问题清单；
* 严重程度；
* 修改建议；
* 是否阻塞发布；
* 需要人类判断的问题。

可用按钮：

* `逻辑评审`
* `反方质疑`
* `读者视角评审`
* `工程可行性评审`
* `CEO 视角评审`
* `找出偷换概念`
* `找出无法验证的假设`
* `找出上游未决问题`

人类参与点：

* 判断哪些评审意见成立；
* 决定哪些意见采纳；
* 标记哪些问题暂不处理；
* 追加人类评语。

---

### 6.6 Reflected：反思

目标：不是简单修改，而是对文档背后的思考进行二阶审查。

需要追问：

* 这个问题是不是被定义错了？
* 是否把症状当成问题？
* 是否把工具当成目标？
* 是否有未被说出的前提？
* 是否在替上游不确定性背锅？
* 是否存在更简单的方案？
* 是否需要先做实验，而不是直接写结论？
* 是否需要把一篇文档拆成多篇？

输出：

* Meta Critique；
* Reframing Suggestions；
* Hidden Assumptions；
* Alternative Framings；
* Experiment Suggestions。

可用按钮：

* `重新定义问题`
* `寻找隐藏前提`
* `寻找更小方案`
* `寻找反例`
* `判断是否应该拆文档`
* `判断是否需要实验验证`

人类参与点：

* 决定是否重构整篇文档；
* 判断是否推翻原方向；
* 决定是否进入实验 / 会议 / 决策流程。

---

### 6.7 Revised：修订

目标：把已经采纳的意见合入正文。

这里要区分两种模式：

#### Non-destructive Revision

不直接改正文，只生成修改建议。

适合：

* 早期评审；
* 高风险文档；
* 人需要逐条确认的场景。

#### Destructive / Applied Revision

直接生成新版本正文。

适合：

* 修改方向已经明确；
* 文档还处于草稿；
* 用户希望快速推进。

输出：

* Revised Draft；
* Change Summary；
* Accepted Suggestions；
* Rejected Suggestions；
* Remaining Questions。

可用按钮：

* `按已采纳意见修订`
* `只润色表达`
* `重构结构`
* `压缩到一页`
* `扩写为正式文档`
* `生成改动摘要`
* `对比前后版本`

人类参与点：

* 逐条采纳 / 拒绝建议；
* 检查新版本是否丢失原意；
* 决定是否进入下一轮评审。

---

### 6.8 Decisioned：形成决策

目标：把文档中的关键判断沉淀为决策记录。

不是所有文档都需要进入 Decisioned 状态。

但对于系统设计、产品方向、工作流设计、团队规范等文档，应该沉淀决策。

输出：

* Decision Records；
* Accepted Conclusions；
* Rejected Alternatives；
* Pending Decisions；
* Follow-up Tasks。

可用按钮：

* `提取决策`
* `生成 Decision Record`
* `列出未决问题`
* `生成下一步任务`
* `生成会议决策版`

人类参与点：

* 最终确认决策；
* 指定决策状态；
* 标记哪些只是暂定。

---

### 6.9 Published / Handed Off：发布或交接

目标：把文档变成可消费资产。

可能去向：

* Wiki；
* Inbox；
* Handoff；
* GitHub Repo；
* 飞书文档；
* Claude Code / Codex 任务；
* 项目管理系统。

输出：

* Published Document；
* Handoff；
* Task Packet；
* Wiki Entry；
* Summary；
* Tags / Backlinks。

可用按钮：

* `发布到 Wiki`
* `生成 Handoff`
* `生成 Codex 任务`
* `生成 Claude Code Prompt`
* `生成飞书版`
* `生成摘要卡片`

人类参与点：

* 确认发布位置；
* 确认可见范围；
* 确认后续执行人。

---

## 7. 文档状态字段设计

每篇文档都应该有明确状态。

示例：

```yaml
type: design_doc
id: doc-20260505-noos-chatbot-deliberation
title: NOOS Chatbot 推敲工作流设计
project: noos-mem
system: chatbot-deliberation
status: draft
lifecycle_stage: critiqued
owner: user
created_at: 2026-05-05
updated_at: 2026-05-05

workflow:
  captured: done
  framed: done
  contextualized: partial
  drafted: done
  critiqued: partial
  reflected: not_started
  revised: not_started
  decisioned: not_started
  published: not_started

review:
  passes: 2
  last_executor: chatgpt-web
  unresolved_questions: 5
  blocking_issues: 1

context:
  source_docs:
    - wiki/noos/definition.md
  context_packet_id: cp-20260505-001

decisions:
  accepted:
    - Chatbot should be pluggable.
    - Noos Core should control durable context state.
  pending:
    - Browser Shuttle state boundary.
    - Review Pass schema.
```

这个状态字段可以驱动 UI。

例如：

```text
当前文档：Drafted
建议下一步：Critique / Reflect
可跳过：Contextualized
阻塞项：缺少目标读者定义
```

---

## 8. Prompt 内置设计

Prompt 不应该只是散落的按钮。

Prompt 应该和文档状态机绑定。

每个 Prompt 至少要有以下字段：

```yaml
id: prompt-reflect-hidden-assumptions
name: 识别隐藏前提
stage: reflected
input_required:
  - current_document
  - current_stage
  - known_decisions
output_type: reflection_report
mode: non_destructive
can_change_document: false
can_create_decision: true
can_create_open_question: true
```

---

### 8.1 Prompt 类型

可以先分成几大类。

#### 捕获类

* 整理为原始笔记；
* 从对话中提取主题；
* 生成标题和标签；
* 转成 Handoff；
* 生成 Wiki Inbox 条目。

#### 定框类

* 定义问题；
* 限定范围；
* 提取目标读者；
* 提取成功标准；
* 提取隐含前提。

#### 生成类

* 生成初稿；
* 按指定结构扩写；
* 从提纲生成正文；
* 从碎片生成结构；
* 转成正式文档语气。

#### 评审类

* 逻辑评审；
* 结构评审；
* 反方评审；
* 用户视角评审；
* 工程可行性评审；
* 管理者视角评审；
* 证据评审。

#### 反思类

* 重新定义问题；
* 查找隐藏前提；
* 查找偷换概念；
* 查找未验证假设；
* 查找更小方案；
* 判断是否需要拆文档。

#### 修订类

* 按建议合并；
* 只润色表达；
* 重构章节；
* 压缩；
* 扩写；
* 生成变更摘要。

#### 沉淀类

* 提取决策；
* 生成 Decision Record；
* 生成 Handoff；
* 生成任务包；
* 生成 Wiki Entry；
* 生成摘要卡片。

---

## 9. 人在工作流中的位置

文档推敲不能完全交给 Chatbot。

人的角色应该非常明确。

### 9.1 人负责判断目标

Chatbot 可以帮忙定义问题，但不能替人决定真正目标。

人需要确认：

* 这篇文档写给谁；
* 要解决什么问题；
* 哪些内容不写；
* 什么才算完成。

---

### 9.2 人负责采纳与拒绝

Chatbot 可以提出建议，但建议不能自动等于决策。

NOOS 应该允许人对每条建议标记：

```text
Accepted
Rejected
Deferred
Needs More Context
Convert to Open Question
Convert to Task
```

这比简单的“重新生成一版”更重要。

---

### 9.3 人负责最终决策

尤其是系统设计、产品方向、团队规范类文档，最终决策必须由人确认。

Chatbot 可以生成 Decision Record 草稿，但不能自动把它标记为 accepted。

---

### 9.4 人负责判断是否跳过阶段

不是每篇文档都需要完整流程。

例如：

* 临时 Handoff：可以跳过深度反思；
* 正式系统设计：不能跳过评审和决策；
* 简单会议纪要：不需要复杂上下文化；
* 高风险方案：必须经过反方评审。

系统可以推荐，但最终跳过权应该在人。

---

## 10. UI / 交互形态初稿

可以想象 NOOS 的文档页旁边有一个 Workflow Panel。

### 10.1 Workflow Panel

显示：

```text
当前阶段：Drafted
建议下一步：Critique
已完成：Capture / Frame / Draft
未完成：Contextualize / Critique / Reflect / Revise / Decision
阻塞问题：缺少目标读者定义
```

按钮：

```text
[查找上下文]
[逻辑评审]
[反方质疑]
[生成修订版]
[提取决策]
[生成 Handoff]
```

---

### 10.2 Prompt Button

每个按钮不是简单发 prompt，而是：

1. 读取当前文档；
2. 读取文档状态；
3. 读取已选上下文；
4. 生成 Context Packet；
5. 选择 Chatbot / Agent；
6. 发送 Prompt；
7. 回收输出；
8. 保存 Review Pass；
9. 更新文档状态。

也就是说，按钮背后是小工作流。

---

### 10.3 Review Inbox

Chatbot 生成的评审意见不要直接污染正文。

可以先进入 Review Inbox。

每条建议有状态：

```text
待处理
已采纳
已拒绝
已延期
转为问题
转为任务
```

这能避免文档被模型反复改乱。

---

### 10.4 Version Diff

每次修订都应该保留 Diff。

至少记录：

* 修改前版本；
* 修改后版本；
* 修改原因；
* 使用的 Prompt；
* 使用的模型；
* 是否人工确认。

Git 天然适合 Markdown 的 Diff / Merge，因此 NOOS 可以把 Markdown 仓库放在 Git 体系里。

---

## 11. Chatbot 推敲的几种模式

### 11.1 Single Chatbot Assisted Mode

用户在一个 Chatbot 中完成推敲。

NOOS 提供：

* 上下文注入；
* Prompt 按钮；
* 输出回收；
* 状态管理。

适合早期 MVP。

---

### 11.2 Multi Chatbot Review Mode

同一份文档发给多个 Chatbot。

例如：

```text
ChatGPT：综合和表达
Claude：长文逻辑评审
Gemini：资料补充和多角度审查
```

NOOS 负责：

* 生成同一个 Context Packet；
* 给不同 Chatbot 附加不同角色 Prompt；
* 回收多个结果；
* 汇总冲突意见；
* 生成综合评审报告。

适合重要文档。

---

### 11.3 Agent Runner Batch Mode

不通过网页 Chatbot，而是由 NOOS 自己调用 API。

适合：

* 批量评审；
* Wiki 整理；
* 文档一致性检查；
* 自动生成摘要；
* 自动提取决策。

---

### 11.4 Human-in-the-loop Revision Mode

模型只生成建议，人逐条采纳。

这是高质量文档最重要的模式。

NOOS 应该优先支持。

---

## 12. MVP 建议

第一版不要追求完整自动化。

建议优先做这几件事。

### 12.1 Markdown 文档 + Frontmatter

让每篇文档先有基本元数据。

最低限度包括：

* title；
* project；
* system；
* status；
* tags；
* lifecycle_stage；
* created_at；
* updated_at。

---

### 12.2 Prompt Button

先做 6 个按钮：

```text
定义问题
查找上下文
逻辑评审
反方质疑
按建议修订
生成 Handoff
```

---

### 12.3 Review Pass 记录

每次 Chatbot 推敲都记录下来。

最低限度记录：

* 时间；
* 使用的 Prompt；
* 使用的 Chatbot；
* 输入文档版本；
* 输出结果；
* 人类采纳状态。

---

### 12.4 Review Inbox

让模型的意见先进入 Review Inbox，而不是直接覆盖正文。

这是保证文档质量和可控性的关键。

---

### 12.5 Handoff 输出

把一轮讨论或一份文档整理为 Handoff。

这可以直接连接 Codex / Claude Code / Wiki / 后续 Agent。

---

## 13. 关键设计原则

### 13.1 上下文主权属于 NOOS

Chatbot 可以生成内容，但不应该掌握长期上下文。

NOOS 应该记录：

* 给了 Chatbot 什么；
* Chatbot 回了什么；
* 人采纳了什么；
* 文档如何变化。

---

### 13.2 Markdown 是核心流通格式

Markdown 足够简单，又足够结构化。

它适合：

* Git Diff；
* Wiki；
* Agent 读取；
* 人类编辑；
* Handoff；
* Prompt 注入。

---

### 13.3 Chatbot 是可插拔执行器

ChatGPT、Claude、Gemini、Codex、Claude Code 都只是不同执行端。

NOOS 不应该被某一个模型平台锁定。

---

### 13.4 Prompt 是工作流节点，不是孤立文本

每个 Prompt 都应该绑定：

* 文档阶段；
* 输入要求；
* 输出格式；
* 状态更新规则；
* 是否允许修改正文。

---

### 13.5 模型建议不等于人类决策

所有关键建议都应该经过采纳 / 拒绝 / 延期 / 转任务等操作。

---

### 13.6 文档推敲应该可追踪

每一轮推敲都应该能回答：

* 为什么改？
* 谁建议的？
* 用了什么上下文？
* 人是否采纳？
* 改动影响了什么？

---

## 14. 下一步需要继续设计的问题

### 14.1 文档状态机是否应该强制？

有两种路线：

1. 强状态机：每篇文档必须按阶段推进；
2. 弱状态机：系统只推荐阶段，不强制。

初步判断：

> 早期应该采用弱状态机。

因为不同文档复杂度差异很大。强制状态机会增加负担。

---

### 14.2 Review Inbox 的数据结构如何设计？

需要进一步设计：

* 一条建议如何绑定到正文位置；
* 多条建议如何合并；
* 建议被采纳后如何生成 Diff；
* 被拒绝的建议是否保留；
* 建议能否转成任务 / open question。

---

### 14.3 Browser Shuttle 和 Noos Core 的边界

需要明确：

* 插件是否保存临时状态；
* 插件如何读取 Chatbot 页面；
* 插件如何处理网页结构变化；
* 插件如何把结果回写 Noos；
* 多 Chatbot Tab 如何编排。

初步判断：

> Browser Shuttle 只保存短期会话状态，长期状态全部回写 Noos Core。

---

### 14.4 多 Chatbot 评审如何避免噪音？

多个模型输出会产生大量意见。

需要设计：

* 意见聚类；
* 冲突检测；
* 优先级排序；
* 严重程度标记；
* 只把高价值意见交给人。

---

### 14.5 Context Packet 如何压缩？

上下文包不能无限大。

需要区分：

* 必须原文；
* 可摘要；
* 只需标题和链接；
* 已废弃但需要知道；
* 冲突文档。

这会成为 NOOS 的核心能力之一。

---

## 15. 初步结论

NOOS 的关键不是“自己做一个 Chatbot”。

NOOS 的关键是：

> **掌握文本上下文的生成、组织、路由、推敲、回收和沉淀。**

在这个体系里：

* Markdown 是统一中间格式；
* Wiki 是长期知识结构；
* Context Packet 是上下文投递格式；
* Prompt Button 是工作流入口；
* Browser Shuttle 是 Chatbot 连接器；
* Agent Runner 是可控执行器；
* Review Pass 是推敲轨迹；
* Decision Record 是决策沉淀；
* Handoff 是跨工具交接格式。

因此，NOOS 可以被定义为：

> **LLM 时代，以 Markdown 为核心流通格式，连接人、知识库、Chatbot 与 Agent 的上下文操作系统。**

而“用 Chatbot 作推敲”的文档工作流，本质上不是简单让模型改文档，而是：

> **用 NOOS 管理一篇文档从捕获、定框、上下文化、起草、评审、反思、修订、决策到交接的完整生命周期。**
