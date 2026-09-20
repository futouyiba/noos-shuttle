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
  暗号与写状态文件。通知类动作（投递暗号、send_message 交接、
  投递兜底评论）不是敏感动作，直接执行、无需向人请示。
- **gh 写入仅限投递兜底**：本 skill 对 GitHub 只做只读拉取，唯一
  例外是步骤 5 的兜底评论（`send_message` 不可用时，在已确认的 canonical task issue 留
  一条只含暗号 + provenance 的评论）。不得用该通道写任何其他内容。
- **单实例**：一轮运行必须先取得主 checkout 的 `.tmp/noos-watch.lock`。取不到锁
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

   helper 用 `git worktree list --porcelain -z` 定位主 checkout；从主目录、
   linked worktree 或子目录启动都使用同一个锁。不能定位时退出码 `2`，停止。
   退出码 `1` 表示锁或 mutation guard 已占用（**不代表原运行仍活着**），
   立即结束，不拉评论、不写状态。简报写「锁被占用，本轮跳过；必要时人工恢复」。
   退出码 `0` 时记下 `holderToken` 和返回的 canonical 绝对路径 `lock`。
   **后续所有调用必须传同一个 `--lock-file "<lock>"`**，不得随 cwd 重算路径。

   TTL 默认 10 分钟，**仅供诊断，永不自动接管**，暂停的运行可能恢复。
   空、半写、损坏锁与遗留 `<lock>.mutation` 也一律阻塞，不覆盖、不删除。
   `refresh` 只更新诊断时间；任何失败都停止后续路由/状态写入：

   ```bash
   node scripts/noos-watch-lock.mjs refresh --lock-file "<lock>" --token "<holderToken>"
   ```

   恢复必须由人确认**所有使用该路径的运行和 helper 均已停止、不会恢复**，
   然后才可人工移除锁及 mutation guard；仅 TTL 过期或 acquiring helper 已退出
   不足以证明。未确认则保持阻塞。本 skill 不自动执行恢复。

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
     "health": { "lastStartedAt": "ISO8601", "lastSuccessfulAdvanceAt": "ISO8601|null", "lastCompletedPollAt": "ISO8601|null", "activeRun": null, "consecutiveInterruptions": 0, "lastError": "string|null" }
   }
   ```

   无文件则初始化 `watermark = now - 15min`。**旧的 `processed` 数组
   是 v1 schema**：读到数组且无 `claims` 时迁移——每个 id 记为
   `{ "state": "ROUTED", "note": "migrated from v1 processed" }`，
   保留既有事实，不重放历史评论。

   旧 health 缺字段时，补 `lastCompletedPollAt = null`、`activeRun = null`；
   不凭旧时间差推断中断。取得锁后若读到旧的非空 `activeRun`（人工恢复后），
   将 `consecutiveInterruptions += 1`，`lastError` 记「前轮未完成」，再设置
   `activeRun = holderToken`、`lastStartedAt = now` 并落盘（先落心跳后干活）。
   正常完成清空 activeRun；可捕获异常时计数加一并清空 activeRun，避免下轮重复计数。
   硬中断来不及写账，只能在人工确认停跑并恢复后由下一轮识别旧 activeRun。

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
   确认落盘**，然后才投递。投递成功后改记
   `{state:"ROUTED", routedAt, deliveredVia}`。投递失败或本轮被中断时
   **保留 `CLAIMED`**——宁可下一轮报「未完成」交人判断，也不重发。

   **投递通道与兜底**（规范 §4.4 允许的兜底通道）：

   - **首通道 `send_message`**：按步骤 4 解析到的会话直投。成功记
     `deliveredVia: "session"`。
   - **兜底（`send_message` 不可用或返回不可用）**：在**canonical task issue** 留一条评论，内容**只含** `role:` 前缀的暗号与 provenance 行：

     ```
     impl: fix PR#53
     （watch: relay）
     ```

     - 先从 PR/任务的明确关联或委派记录确定 canonical task issue；来源 PR
       不是默认兜底地址。缺失、多个候选或关系不确定时不发评论，保留 CLAIMED
       并报「canonical task issue 未确认」。记录目标 issue URL，暗号仍引用原 PR。
       首通道投递结果未知/超时时也不走兜底，避免两条通道重复投递。
     - `role:` 用 `orch` / `impl` / `rev` / `des` / `intg`；**不用 `@role`**。
     - 评论**不得**附带解释、总结、建议或任何自由文本——它不是分析，
       只是把唤醒信号放进规范定义的持久邮箱，由人或其他会话转达。
     - 成功记 `deliveredVia: "comment:<commentId>"`。
   - **两条通道都不可用**：维持 `CLAIMED`，并在简报中明确写
     「投递通道不可用」+ 逐条列出待投递项。**不得**因为送不出去就
     把评论标记为已处理。

   兜底评论本身也是投递，**同样先认领后写**：先落 `CLAIMED` 再发评论，
   避免并发或重跑导致同一条唤醒被投递两次。

6. stage 链（B.2 多动词跨角色）：`stages` 数组记录
   `{"pr":"PR#N","await":"REVIEW: APPROVE","next":"review PR#N"}`
   形式的待续条目（await 写带收敛性 verdict 的完整标记，避免
   过早触发）；本次轮询见到 await 标记出现即派发 next 并移除，
   否则保留。

7. 写回并**释放锁**：

   - `watermark` 只推进到**最后一个已成功处理（`ROUTED`）或已显式
     记入 `pending` 的评论时间**——**不得越过未投递项**。无法判定
     时保持原值，宁可下轮重读也不吞掉未处理消息。
   - `claims` 追加，**不截断 ROUTED，也不删除 CLAIMED**。水位被欠账钉住时，
     最近 500 条截断会让旧已投递评论重读后重发。本版本不做自动 GC。
   - 所有状态写入必须持有同一个锁，手动运行也一样；并集合并不是并发写保护。
   - 完整拉取并完成本轮处理/记账后，更新 `lastCompletedPollAt = now`，
     清空 `activeRun`，重置 `consecutiveInterruptions = 0`；**无新评论同样更新**。
     只有实际推进水位才更新 `lastSuccessfulAdvanceAt`。有 pending/CLAIMED
     的已完成轮询仍算完成，但 `lastError` 记欠账原因；没有欠账才清空错误。
     异常提前结束不更新完成/推进时间，按步骤 1 计中断。
   - 释放锁：

     ```bash
     node scripts/noos-watch-lock.mjs release --lock-file "<lock>" --token "<holderToken>"
     ```

     本轮因故提前结束（异常、无法定位主 checkout）时**同样要释放**，
     释放失败要显式报告并停止；没有 TTL 自动清理。

8. 输出简报。**必须显式区分三态**，只有第一种允许静默：

   | 状态 | 简报内容 |
   | --- | --- |
   | 无新评论 | 一行即可 |
   | 有新评论但未全部投递成功 | 列出每条未投递项 + 原因 + 建议动作 |
   | 本轮未完成（异常 / 被中断） | 明确写「本轮未完成」，附 `lastError` 与已认领未投递的评论 |

   另附：处理条数、路由去向、在途 stage、pending 积压总数、
   `consecutiveInterruptions` 当前值（> 0 时提示需要人工查看），
   以及**本轮经兜底评论投递的条数**——大于 0 时提示「唤醒已进持久
   邮箱，需人在线转达或由有会话通道的会话排空」。

## 健康信号（本 skill 必须如实产出）

watcher 曾经静默失效 2.5 天而无人察觉，原因有两层：一是失败被报成
成功，二是「启动了但没推进」与「没新评论」不可区分。因此：

- `lastStartedAt` 与 `lastCompletedPollAt` 区分启动和完整轮询；完成时间长期不前进
  才需排查（无新评论也会更新完成时间），不能用水位是否前进判断中断。
- `lastSuccessfulAdvanceAt` 只表示水位推进；pending 钉住水位不等于轮询中断。
- `activeRun` 与中断计数按步骤 1/7 更新；锁阻塞时不得写共享状态，报告阻塞即可。
- 简报不得把「本轮未完成」表述成「无新评论」。这些健康规则由 skill 执行，
  不是独立 watchdog；硬中断后的自动恢复和外部告警不在本版本保证内。
