---
name: chatgpt-provider-recovery-go-n
created_at: 2026-09-17
source_agent: codex
source_context: user-requested research and design handoff
status: active
target_roles:
  - orchestrator
  - epic-designer
related:
  - github:futouyiba/noos-shuttle#7
  - github:futouyiba/noos-shuttle#9
---

# ChatGPT Provider Recovery / Go × N 异常恢复

## Transfer intent

先做**只读证据调研与设计提案**，不要实现代码，不要自动刷新页面，不要自动点击 ChatGPT Retry，不要自动发送“继续”，不要改变当前 Go × N 行为。

目标是让 ChatGPT 对话在可恢复时尽可能顺畅地继续，同时保持：

- 未确认接受时不得盲目重发；
- provider 已接受的轮次不得被误判成未发送；
- Go × N 预算与恢复尝试预算分离；
- 刷新、原生 Retry、“继续”、上下文迁移都有可追踪 provenance；
- Stop、用户介入、reload、双标签页和未知状态均 fail-closed。

## Orchestrator task

### 1. 建立故障证据基线

围绕以下四类场景收集现有真实材料、公开资料和代码证据。没有实测证据的项必须明确写成 `PENDING_VALIDATION`，不能把推测写成事实。

1. **前端断联 / 长连接中断**
   - ChatGPT 服务端是否可能仍在执行？
   - 原地刷新后是否恢复同一 conversation 的生成或结果？
   - 刷新前后如何证明 conversation identity 没变？

2. **provider 硬中断 / assistant turn 中断**
   - 当前 assistant 是否已经接受并产生部分输出？
   - 什么证据区分“已完成但 UI 异常”与“被硬中断”？
   - 发送短“继续”是否在何种条件下安全、有效？

3. **消息发送失败 / 原生 Retry**
   - user message 是否进入 conversation？
   - ChatGPT 原生 Retry 是重试原请求、重新生成，还是重新提交？
   - Shuttle 重试与 provider Retry 是否可能竞态或重复发送？

4. **上下文过长 / context limit**
   - 错误 surface 的稳定识别信号是什么？
   - 刷新或“继续”是否无效？
   - 如何生成 bounded context pack 并在新 conversation 中承接？

### 2. 每条证据的最低记录格式

- 脱敏后的错误文案 / DOM surface / 截图引用；
- provider conversation ref、route ref、operation/run ref（不得记录凭据）；
- 出错前后的 user/assistant message count 与 fingerprint 变化；
- generation/stop/composer 状态；
- 采取的动作（刷新、原生 Retry、“继续”、等待、迁移）；
- 最终结果（恢复、重复、仍未知、需人工）；
- 证据来源和时间；
- 是否为真实 dogfood、fixture、公开资料或工程推断。

禁止主动制造限流、绕过安全策略、探测凭据或进行破坏性实验。

### 3. 核查当前实现差距

至少核对并在报告中引用：

- `src/content/chatgpt-dom.ts`：发送按钮/输入框/生成停止控件；
- `src/content/index.ts`：`dispatchHumanGo`、`reconcileActiveSubmission`、provider error surface、reload/observation；
- `src/content/runtime-observer.ts`：`RECOVERING` / `BROKEN` / quiet window；
- `src/core/submission-operation.ts`：`OBSERVED_ACCEPTED`、`FAILED_SAFE`、`UNCERTAIN`、exactly-once；
- `src/core/continuation-run.ts`：Go × N phase、预算、Stop、USER_INTERVENTION、conversation rebase；
- 已有 BCR / Go × N 报告和测试。

重点回答：

- 当前是否会把“前端安静”误判成生成完成；
- provider error 是否只被压成 boolean，丢失分类；
- reload 后 operation 是否能安全重新对账；
- 原生 Retry 与 Shuttle dispatch 是否会竞态；
- “继续”是否有独立 operation/provenance；
- context limit 是否已有 rebase/pack 能力。

### 4. 产出提案

产出一份 proposal（建议放在 `docs/deliberation-harness/`），但只写候选方案和未决裁定，不实现：

- provider error taxonomy；
- 证据驱动的 recovery decision；
- 有界刷新、原生 Retry、“继续”、等待、context rebase 的自动化边界；
- recovery budget 与 Go × N budget 的关系；
- unknown/UNCERTAIN 的安全语义；
- 观测、账本、Go × N、UI 各层职责；
- 分阶段实现切片与验收证据。

## Recommended candidate policy (not yet authoritative)

1. 连接疑似断开：只在 conversation identity 可靠、无明确 context/policy/auth 错误、无未保存输入时，允许有界原地刷新；刷新只恢复观察能力，不立即重发。
2. 已接受但 assistant turn 中断：提供受控 `CONTINUE_PROVIDER_TURN` 候选；不把它当普通 GO；是否自动发送交 Epic Designer 裁定。
3. 明确未接受：可提供 provider-native Retry 或新的 Shuttle attempt；旧 operation 不复用，Go × N 不消耗预算，未知时不下结论。
4. context limit：禁止刷新循环、禁止原样“继续”和盲重试；进入 bounded context pack / conversation rebase 候选。
5. rate limit、auth、policy、安全挑战：等待或人工处理，不尝试绕过。
6. console/network/CDP 只能作为增强证据；DOM、消息 fingerprint、generation 和 durable ledger 才是生产基础证据。

## Epic Designer handoff (minimal adjudication prompt)

请裁定 `ChatGPT Provider Recovery / Go × N` 提案：

- **Evidence gate:** 哪些证据足以从 unknown 进入 refresh、provider-retry、continue、rebase 或 human-required？
- **Accounting:** 原 dispatch、provider Retry、Shuttle retry、`CONTINUE_PROVIDER_TURN` 如何建立 operation/provenance 关系；何时消耗 Go × N 预算？
- **Run semantics:** recovery 期间 Go × N 是暂停还是结束？Stop、reload、用户介入、重复标签页如何处理？
- **Rebase:** context limit 如何进入 `CONVERSATION_REBASE_REQUIRED`，bounded context pack 必须携带哪些权威/进度/证据？
- **Automation boundary:** 哪些动作可在一次 Human authorization 的有界预算内自动执行，哪些必须再次请求 Human？

请输出：`DESIGN: APPROVE` 或 `DESIGN: NEEDS_REVISION`，并引用 proposal 中的决定性原文及 exact ref；不要直接实现代码。

## Suggested next-agent instructions

1. 读取本 handoff 与 GitHub #7/#9。
2. 先完成证据表和当前实现差距报告。
3. 写 proposal 文档并开 draft PR（纯文档）。
4. 将 proposal 交 Epic Designer：只发送上面的 minimal adjudication prompt + proposal ref，不复述整套契约。
5. 在 issue/PR 评论保留 `DESIGN:` verdict、决定性原文和 provenance。
6. 只有 Designer 裁定后，orchestrator 才能拆实现切片；在此之前不得修改运行时行为。

## Consume instruction

```text
Use $noos-consume-handoff to read this NOOS handoff and continue the task:
.noos/handoffs/active/chatgpt-provider-recovery-go-n-handoff.md
```
