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
  暗号与写状态文件。
- 只认首行标记 + 次行 provenance 的评论；无效标记只记录不路由。
- 幂等：每个 comment ID 只处理一次（状态文件去重）。
- 无法解析目标会话时不投递，记入待办并在简报中汇报。

## 步骤

1. 读状态文件 `/Volumes/Mac DS - Data/SharedProjects/noos-shuttle/.tmp/watcher-state.json`
   （无则初始化 `{"watermark": "<now-15min ISO>", "processed": [],
   "pending": []}`）。
2. `gh api "repos/futouyiba/noos-shuttle/issues/comments?since=<watermark>&per_page=100"`
   拉取新评论（该端点同时覆盖 issue 与 PR 评论）。
3. 逐条分类（跳过已处理 ID 与无有效标记者），按 provenance 角色
   路由：
   - `REVIEW: REQUEST_CHANGES`（rev/des 发出）→ 向该 PR 的实现
     会话投 `fix PR#N`
   - `REVIEW: APPROVE` → 通知实现会话与 orchestrator（向人提示
     可 merge）
   - `DESIGN: <verdict>` → 同上；若 PR 已合并 → 提示 orchestrator
     以新 dispatch 立 follow-up issue
   - `INTEGRATED:` → 记录并通知 orchestrator
4. 会话寻址：`ccd_session_mgmt list_sessions` 按标题 / 分支匹配
   该 PR 的实现会话；匹配不到则进 pending。投递用 send_message，
   消息含 PR 链接与评论链接。
5. 写回状态：watermark = 本次见到的最大评论时间；processed 追加
   并截断到最近 500 条；pending 中已人工处理的清除。
6. 输出简报：处理条数、路由去向、未投递待办。

多动词跨角色指令（如 fix 后 review）由本 watcher 负责分 stage：
上一个 stage 的产出标记出现后，再派发下一个（见规范 B.2）。
