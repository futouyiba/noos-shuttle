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
- **单实例**：一轮运行必须先取得 `.tmp/noos-watch.lock`。取不到锁
  即**立即退出**，不拉评论、不路由、不写状态。同一时刻只允许一轮
  watcher 存在——这是「重复取件」的结构性防线。
- **先认领后动作**：路由任何一条评论之前，必须先把该评论以
  `CLAIMED` 写回状态文件并确认落盘；投递成功后才转为 `ROUTED`。
  未认领就投递＝重复取件的直接成因。
- **不认识但像正式文件的，必须上报**：无法按下方词表分类、却携带
  权威信号的评论（见步骤 3 末），一律进 pending 并在简报中列出，
  **不得静默跳过**。静默丢弃权威裁定是已知事故，不是可接受行为。
- 只认首行标记 + 次行 provenance 的评论（唤醒不校验委派记录；
  接收方按 B.3 推导规则核对后才行动）。
- 无法解析目标会话时不投递，记入 pending 并在简报中汇报。

## 步骤

0. **取锁（先于一切）**

   ```bash
   node scripts/noos-watch-lock.mjs acquire --session-ref "<本轮标识>"
   ```

   退出码 `1` ＝ 已有活着的运行在持有锁 → **直接结束本轮，不产生任何
   副作用**，简报只写一行「上一轮仍在运行，本轮跳过」。退出码 `0`
   时输出里有 `holderToken`，**记下它**，步骤 7 要用。

   锁的 TTL 默认 10 分钟（一次运行远超此值即属异常）。若本轮确实
   需要更久，用 `refresh` 续期：

   ```bash
   node scripts/noos-watch-lock.mjs refresh --token "<holderToken>"
   ```

1. 读状态文件（主 checkout 下 `.tmp/watcher-state.json`，路径见
   AGENTS.md 环境注记；主 checkout 根不可定位时**立即报错退出**，
   不得静默重置）。schema：

   ```json
   {
     "schemaVersion": 2,
     "watermark": "ISO8601",
     "claims": { "<commentId>": { "state": "CLAIMED|ROUTED|UNROUTED", "action": "...", "claimedAt": "ISO8601", "routedAt": "ISO8601", "note": "..." } },
     "pending": [],
     "stages": [],
     "health": { "lastStartedAt": "ISO8601", "lastSuccessfulAdvanceAt": "ISO8601|null", "consecutiveInterruptions": 0, "lastError": "string|null" }
   }
   ```

   无文件则初始化 `watermark = now - 15min`。**旧的 `processed` 数组
   是 v1 schema**：读到数组且无 `claims` 时迁移——每个 id 记为
   `{ "state": "ROUTED", "note": "migrated from v1 processed" }`，
   保留既有事实，不重放历史评论。

   写入 `health.lastStartedAt = now` 并落盘（**先落心跳后干活**）。

2. `gh api "repos/futouyiba/noos-shuttle/issues/comments?since=<watermark>&per_page=100"`
   拉取新评论（覆盖 issue 与 PR 评论）；返回满页时续页拉取
   （page=2,3,…）至不满页。

3. 逐条分类。**先查 `claims`**：已 `ROUTED` 的跳过；`CLAIMED` 但未
   `ROUTED` 的**不得重发**，列入简报的「未完成投递」项交人判断
   （可能是上轮被中断在投递中途）。其余按首行标记 + 次行 provenance
   分档路由：

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

   **未分类上报（必须执行）**：不匹配上表、但 body 命中以下任一
   保守判据的评论，一律记为 `UNROUTED` 进 pending，并在简报中
   逐条列出「线程 + 评论链接 + 命中的判据」：

   - 含 `noos-governor`（designer 经 connector 的裁定记录标记）
   - 含 `**Decision:**`（同上，原生裁定的判定行）
   - 含形如 `（…: …, 委派: …）` 的 provenance 行
   - 含 `DESIGN:` / `REVIEW:` / `INTEGRATED:` / `IMPLEMENTED:` 但
     取值不在规范枚举内（例如 `DESIGN: PARTIAL_ACCEPT`——规范只定义
     `APPROVE|REQUEST_CHANGES|REJECTED`，**协议缺这个符号**）

   这条的意义是让「丢」变得可见：解析器永远会漏掉下一种没见过的
   格式，而「不认识就上报」使漏变成可观测的。

4. 会话寻址：`ccd_session_mgmt list_sessions` 按标题 / 分支匹配该 PR
   的实现会话；匹配不到则进 pending（`{"type":"unrouted",
   "comment":<id>, "action":<拟投暗号>}`）。

5. **认领后路由**：对每一条将要投递的评论，先把
   `claims[<id>] = {state:"CLAIMED", action, claimedAt}` **写回并
   确认落盘**，然后才 `send_message`。投递成功后改记
   `{state:"ROUTED", routedAt}`。投递失败或本轮被中断时**保留
   `CLAIMED`**——宁可下一轮报「未完成」交人判断，也不重发。

6. stage 链（B.2 多动词跨角色）：`stages` 数组记录
   `{"pr":"PR#N","await":"REVIEW: APPROVE","next":"review PR#N"}`
   形式的待续条目（await 写带收敛性 verdict 的完整标记，避免
   过早触发）；本次轮询见到 await 标记出现即派发 next 并移除，
   否则保留。

7. 写回并**释放锁**：

   - `watermark` 只推进到**最后一个已成功处理（`ROUTED`）或已显式
     记入 `pending` 的评论时间**——**不得越过未投递项**。无法判定
     时保持原值，宁可下轮重读也不吞掉未处理消息。
   - `claims` 追加，`ROUTED` 条目截断保留最近 500 条。
   - 写回前重新读取并按并集合并（防与手动运行重叠丢更新）。
   - 成功推进后更新 `health.lastSuccessfulAdvanceAt = now`、
     `health.consecutiveInterruptions = 0`、`health.lastError = null`；
     若本轮有任何未完成项，`health.lastError` 记明原因。
   - 释放锁：

     ```bash
     node scripts/noos-watch-lock.mjs release --token "<holderToken>"
     ```

     本轮因故提前结束（异常、无法定位主 checkout）时**同样要释放**，
     不要靠 TTL 兜底。

8. 输出简报。**必须显式区分三态**，只有第一种允许静默：

   | 状态 | 简报内容 |
   | --- | --- |
   | 无新评论 | 一行即可 |
   | 有新评论但未全部投递成功 | 列出每条未投递项 + 原因 + 建议动作 |
   | 本轮未完成（异常 / 被中断） | 明确写「本轮未完成」，附 `lastError` 与已认领未投递的评论 |

   另附：处理条数、路由去向、在途 stage、pending 积压总数、
   `consecutiveInterruptions` 当前值（> 0 时提示需要人工查看）。

## 健康信号（本 skill 必须如实产出）

watcher 曾经静默失效 2.5 天而无人察觉，原因有两层：一是失败被报成
成功，二是「启动了但没推进」与「没新评论」不可区分。因此：

- `health.lastStartedAt` 在每次开跑时更新，`health.lastSuccessfulAdvanceAt`
  只在真正推进水位时更新。**两者长期不一起前进即是故障信号。**
- 被中断的运行不写 `lastSuccessfulAdvanceAt`，但 `lastStartedAt` 已前进；
  连续多次只前进前者，说明无人值守下跑不完——这是需要人介入的形态。
- 简报不得把「本轮未完成」表述成「无新评论」。
