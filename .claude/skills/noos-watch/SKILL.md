---
name: noos-watch
description: 'Poll new PR/issue comments since the last watermark, classify markers by provenance role, and route wake-up keywords to the right sessions. Run by the scheduled watcher task or /noos-watch; never merges, deploys, or performs any sensitive action.'
---

# noos-watch

标记的 watcher（唤醒层）。权威语义：规范附录 B——标记是 watcher 的
唤醒信号，没有 watcher 时只是持久邮箱（durable mailbox）；本 skill
是传输层实现，不构成任何授权。

## 硬边界

- **永不**执行 merge / 部署 / 关闭 issue / push 等敏感动作；只投递
  暗号与写状态文件。通知类动作（投递暗号、send_message 交接）
  不是敏感动作，直接执行、无需向人请示。
- 只认首行标记 + 次行 provenance 的评论（唤醒不校验委派记录；
  接收方按 B.3 推导规则核对后才行动）；无效标记只记录不路由。
- 幂等：每个 comment ID 只处理一次（状态文件去重）。
- 无法解析目标会话时不投递，记入待办并在简报中汇报。

## 步骤

1. 读状态文件（主 checkout 下 `.tmp/watcher-state.json`，路径见
   AGENTS.md 环境注记；主 checkout 根不可定位时立即报错退出，
   不得静默重置。schema：`{"watermark","processed","pending",
   "stages"}`，无则初始化 watermark=now-15min）。
2. `gh api "repos/futouyiba/noos-shuttle/issues/comments?since=<watermark>&per_page=100"`
   拉取新评论（覆盖 issue 与 PR 评论）；返回满页时续页拉取
   （page=2,3,…）至不满页。
3. 逐条分类（跳过已处理 ID 与无有效标记者），按 verdict 分档路由：
   - `REVIEW: REQUEST_CHANGES` → 向该 PR 的实现会话投 `fix PR#N`
   - `REVIEW: APPROVE` → 通知实现会话与 orchestrator；向
     integrator 会话投递合并交接（PR 链接、分支、exact head、
     review 证据链接；交接消息注明"本交接不构成合并授权"），并
     向人提示可 merge
   - `DESIGN: REQUEST_CHANGES`（开放 PR）→ 向该 PR 的实现会话投
     `fix PR#N`
   - `DESIGN: APPROVE` → 通知实现会话与 orchestrator
   - `DESIGN: REJECTED` → 通知 orchestrator（proposal issue 由
     designer 侧关单流程处理）
   - `DESIGN: REQUEST_CHANGES` 或 `DESIGN: REJECTED` 且 PR 已合并
     → 提示 orchestrator 以新 dispatch 立 follow-up issue
   - `INTEGRATED:` → 记录并通知 orchestrator
4. 会话寻址：`ccd_session_mgmt list_sessions` 按标题 / 分支匹配
   该 PR 的实现会话；匹配不到则进 pending（`{"type":"unrouted",
   "comment":<id>, "action":<拟投暗号>}`）。投递用 send_message，
   消息含 PR 链接与评论链接。
5. stage 链（B.2 多动词跨角色）：`stages` 数组记录
   `{"pr":"PR#N","await":"REVIEW: APPROVE","next":"review PR#N"}`
   形式的待续条目（await 写带收敛性 verdict 的完整标记，避免
   过早触发）；本次轮询见到 await 标记出现即派发 next 并移除，
   否则保留。
6. 写回状态：watermark = 本次见到的最大评论时间；processed 追加
   并截断到最近 500 条；写回前重新读取并按并集合并（防与手动
   运行重叠丢更新）。pending 中已人工处理的清除。
7. 输出简报：处理条数、路由去向、在途 stage、未投递待办。
