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
  未认领就投递＝重复取件的直接成因。（判 `DISMISSED` 不触发投递，
  故不经过 `CLAIMED`；但终态的写回同样必须持锁。）
- **终态是结论，不是逃生门**：判 `DISMISSED` 只允许走步骤 3 的
  D1–D5 闭集判据。任何「这条大概不用管」的判断都必须落回未分类上报
  ——未分类是安全侧；静默丢弃权威裁定是已知事故，不是可接受行为。
- **不认识但像正式文件的，必须上报**：无法按下方词表分类、却携带
  权威信号的评论（见步骤 3 末），一律进 pending 并在简报中列出，
  **不得静默跳过**。静默丢弃权威裁定是已知事故，不是可接受行为。
- 只认首行标记 + 次行 provenance 的评论（唤醒不校验委派记录；
  接收方按 B.3 推导规则核对后才行动）。
- 无法解析目标会话时不投递，记入 pending 并在简报中汇报。

**判据与实现一一对应**：步骤 3 的 D1–D5 判据在
`scripts/noos-watch-state.mjs` 里有可执行定义（纯函数、只读、不写状态），
测试在 `tests/noos-watch-state.test.ts`。改判据必须同时改正文与实现，
否则两者会漂移。存量欠账的一次性迁移用
`scripts/noos-watch-migrate-dismissed.mjs`（**默认 dry-run**，`--apply`
才落盘且必须先取得同一把锁）。

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
     "claims": { "<commentId>": { "state": "CLAIMED|ROUTED|UNROUTED|DISMISSED", "action": "...", "claimedAt": "ISO8601", "routedAt": "ISO8601", "dismissRule": "D1|D2|D3|D4|D5", "dismissedAt": "ISO8601", "dismissReason": "...", "note": "..." } },
     "pending": [],
     "stages": [],
     "health": { "lastStartedAt": "ISO8601", "lastSuccessfulAdvanceAt": "ISO8601|null", "lastCompletedPollAt": "ISO8601|null", "activeRun": null, "consecutiveInterruptions": 0, "lastError": "string|null" }
   }
   ```

   **两个终态，语义不同、后果一致**：`ROUTED` 是「已投递」，
   `DISMISSED` 是「已作出结论：不投递」。两者都**不再进简报的
   「未完成投递」项**。只有 `CLAIMED`（认领了、结果未知——可能是被
   中断在投递中途）与 `UNROUTED`（未分类）构成欠账。

   简报投影**必须同时收这两个状态**（`scripts/noos-watch-state.mjs` 的
   `undelivered`）。今天没有写方会置 `UNROUTED`，但 schema 允许它、
   步骤 3 也写着「记为 `UNROUTED` 进 pending」——一个存在却从不进简报
   的状态就是静默丢信号的口子，不能因为「现在用不到」就漏掉。

   没有 `DISMISSED` 时，`CLAIMED` 同时承担「投递失败/被中断」与
   「我判定不投递」两种含义，而按步骤 3 它**每轮都要报成未完成投递**
   ——人工分诊成本随轮次无上限复现。终态把前者（结论）从欠账里择出，
   后者（未知）继续上报。

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

3. 逐条分类。**先查 `claims`**：命中终态（`ROUTED` / `DISMISSED`）的
   跳过——`ROUTED` 是已投递，`DISMISSED` 是已作出「不投递」的结论，
   **两者都不再进简报的「未完成投递」项**；仍为 `CLAIMED` 且未判终态的
   **不得重发**，列入简报的「未完成投递」项交人判断（可能是上轮被中断
   在投递中途）。其余按首行标记 + 次行 provenance 分档路由：

   - `REVIEW: REQUEST_CHANGES` → 向该 PR 的实现会话投 `fix PR#N`
   - `REVIEW: APPROVE` → 以 PR 指针通知实现会话补 PR body／转 Ready，
     并通知 orchestrator。确认 PR 线程已有带 provenance 的
     `intg: merge PR#N` 委派记录后，才向 integrator 会话投递同一指针；
     缺失时只唤醒实现会话／orchestrator 补记录，不唤醒 integrator。
     消息只负责唤醒且不构成授权；各角色从 PR、标记及原授权通道核验
     head、证据与授权，不在消息中复制
   - `DESIGN: REQUEST_CHANGES`（开放 PR）→ 向该 PR 的实现会话投
     `fix PR#N`
   - `DESIGN: APPROVE` → 通知实现会话与 orchestrator
   - `DESIGN: REJECTED` → 通知 orchestrator（proposal issue 由
     designer 侧关单流程处理）
   - `DESIGN: REQUEST_CHANGES` 或 `DESIGN: REJECTED` 且 PR 已合并
     → 提示 orchestrator 以新 dispatch 立 follow-up issue
   - `INTEGRATED:` → 记录并通知 orchestrator
   - `IMPLEMENTED: PR#M @ <head>` → **已知输出标记、无唤醒动作**。它是实现在
     任务 issue 上的完成记录（规范 B.3）；唤醒 integrator 的证据是
     `REVIEW: APPROVE`，不是本条。记为「已知、不路由」并按 D2 判终态，
     **不进 pending**

   **终态 `DISMISSED`（已作出结论：不投递）**：命中以下判据的评论，
   记为 `DISMISSED` 并写 `dismissRule` / `dismissedAt` / `dismissReason`
   （可审计），**不进 pending、不进简报的「未完成投递」项、不投递**。
   判据全部是**闭集匹配**：命中不了就落回下方的「未分类上报」，绝不因
   「看着不像要投递的」而消失。

   **转移的起点是欠账状态——`CLAIMED` 或 `UNROUTED` 都可以**，不只是
   `CLAIMED`。活状态里出现过一条被记成 `UNROUTED` 的委派记录（`action`
   字面写着「记录不路由」）：若终态只从 `CLAIMED` 收，这条既判不了终态、
   又会因为进了欠账投影而**每轮复报**——正是本任务要杀的那个病换个形态。
   真未分类的条目命中不了 D1–D5，开了这个口子也移不动。

   - **D1 委派记录**：首行匹配 `^(orch|impl|rev|des|intg)\s*[:：]`
     （大小写无关、全角归一后匹配；只认**首行**，正文提到角色不算）。
     B.3 委派记录是**唤醒行**，不是 verdict 输出标记；要路由的是紧跟其
     后、承载结论的那条首行标记。所以委派记录本身不路由，判终态。
   - **D2 已知标记、无唤醒动作**：首行是规范已知输出标记，但上表未定义
     对应动作——**当前仅 `IMPLEMENTED:`**。这条闭集之外的未知标记一律
     走「未分类上报」，**不得套用本判据**。
   - **D3 被同线程更晚的同族收敛 verdict 取代**：本条首行是
     `REVIEW:` / `DESIGN:` 且取值为非收敛值（`REQUEST_CHANGES` /
     `REJECTED`），而同线程存在 **commentId 更大**（GitHub 评论 id 单调
     递增）、同族、取值为 `APPROVE`（**逐字等于**——`APPROVE WITH
     FINDINGS` 不算）的评论。记 `supersededBy: <commentId>`。判据成立的
     理由是：派发 `fix PR#N` 会在已 APPROVE 的 head 上诱发新改动并作废
     该 APPROVE，投递它比不投递更有害。
   - **D4 无匹配接收方且已记录原因**：步骤 4 解析不到接收方会话，
     **且**已在该条 pending 上记录结构化原因（`recipient: null` +
     `recipientNote`），**且**该原因是线程的结构性事实（例如「该工作流
     由 orchestrator 会话直评驱动，不存在独立实现会话可唤醒」），不是
     暂时性查找失败。暂时性失败维持 `CLAIMED` 并继续上报——**通道不可用
     与「没有收件人」是两回事**，前者是环境故障、后者是结论。
     （本轮新解析失败的条目在步骤 4 记录原因后判；历史上已记录原因的
     旧条目在步骤 3 重判。两者判据相同。）
   - **D5 合并交接已无对象**：本条是 `REVIEW:` / `DESIGN:` 的 `APPROVE`，
     而同线程已有 **commentId 更大**的 `INTEGRATED:` 记录——合并已经
     发生，通知与合并交接都没有对象了。

   **判据不得越界**：`REVIEW:` / `DESIGN:` 取值不在规范枚举内（如
   `APPROVE WITH FINDINGS`）、designer 的自由文本裁定、`noos-governor`
   与 `**Decision:**` 记录，**一条都不适用 D1–D5**，必须继续进 pending
   等人工分类。那是规范侧的枚举缺口（另立提案处理），不是本层可以自动
   判掉的东西。D1–D5 只覆盖「本 skill 已经能确定不投递」的情形。D5 相对
   前述三类是**超出最小要求的一条**（见 PR 说明），若复审认为它越界，
   直接删掉该判据即可，其余判据不依赖它。

   **未分类上报（必须执行）**：不匹配上表、未命中上述终态判据、但 body
   命中以下任一保守判据的评论，一律记为 `UNROUTED` 进 pending，并在简报中
   逐条列出「线程 + 评论链接 + 命中的判据」。

   pending 条目**必须**带上可复算的分类信息：

   ```json
   { "type": "unclassified-authority", "comment": <id>, "issue": <N>,
     "marker": "<评论首行的原文>", "reason": "<命中的判据>", "action": "人工分类权威信号；不自动转写 verdict" }
   ```

   `marker` 记**首行原文**（不是复述）：简报投影靠它复算这条属于哪一档，
   缺了它投影就只能默认上报（见下），噪音会上去。`type` 用
   `unclassified-authority` 标记「已判定为未分类」，与 `unrouted`（能路由
   但没有接收方，见步骤 4）区分开。

   保守判据：

   - 含 `noos-governor`（designer 经 connector 的裁定记录标记）
   - 含 `**Decision:**`（同上，原生裁定的判定行）
   - 含形如 `（…: …, 委派: …）` 的 provenance 行，**且首行不是
     `orch:` / `impl:` / `rev:` / `des:` / `intg:` 形式的 B.3 委派记录**
     ——委派记录按 D1 处理。不排除就会自我触发：B.3 要求每条委派记录都
     带 provenance 行，写一条合规委派记录等于自动给自己造一条 pending
   - 含 `DESIGN:` / `REVIEW:` / `INTEGRATED:` 但取值不在规范枚举内
     （例如 `DESIGN: PARTIAL_ACCEPT`——规范只定义
     `APPROVE|REQUEST_CHANGES|REJECTED`，**协议缺这个符号**）

   `IMPLEMENTED:` 已从上一条摘出（它是已知标记，按 D2 判终态，不再是
   「未分类」判据的一部分）。

   这条的意义是让「丢」变得可见：解析器永远会漏掉下一种没见过的
   格式，而「不认识就上报」使漏变成可观测的。

   **前三条判据只有 skill 侧能判**：它们要求回看评论**正文**，而简报投影
   只拿得到 `marker`（首行）。所以**「body 级护栏」始终是 skill 侧的义务**，
   不是投影能兜住的——投影在认不出档位时一律**默认上报**（宁可多报，
   不可静默丢），但真正把 `noos-governor` 与 `**Decision:**` 捞出来靠的是
   本步骤，不是投影。

   **未知 ≠ 已判定不路由**：一条评论要么被上表路由、要么命中 D1–D5 判
   终态、要么进本 pending——三者互斥且穷尽。**不得**因为「看起来不需要
   投递」而既不路由也不上报。

4. 会话寻址：`ccd_session_mgmt list_sessions` 按标题 / 分支匹配该 PR
   的实现会话；匹配不到则进 pending，并**把「为什么没有收件人」记成
   结构化字段**：

   ```json
   { "type": "unrouted", "comment": <id>, "action": <拟投暗号>,
     "recipient": null, "recipientNote": "<为什么解析不到可唤醒的会话>" }
   ```

   `recipientNote` 是 D4 的判据依据，必须写清「线程的结构性事实」还是
   「暂时性查找失败」；只有前者才可能判终态，后者维持 `CLAIMED` 继续上报。
   **投递通道不可用不是「没有收件人」**，不写进 `recipientNote`。

5. **认领后路由**：对每一条将要投递的评论，先把
   `claims[<id>] = {state:"CLAIMED", action, claimedAt}` **写回并
   确认落盘**，然后才投递。投递成功后改记
   `{state:"ROUTED", routedAt, deliveredVia}`。投递失败或本轮被中断时
   **保留 `CLAIMED`**——宁可下一轮报「未完成」交人判断，也不重发。

   判 `DISMISSED` 的条目（步骤 3 的 D1–D5）**不经过 `CLAIMED`**：它不
   触发任何投递，所以在步骤 3 内就地写回
   `{state:"DISMISSED", dismissRule, dismissedAt, dismissReason}`，或与
   步骤 7 的写回一并落盘——两者都安全，因为重跑只会重算出同一个结论。
   起点可以是 `CLAIMED` 或 `UNROUTED`（见步骤 3）。但**必须在持锁状态下
   写**；状态文件的所有写入都受同一条锁约束。

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
     - 第二行的 `（watch: relay）` 是**传输注记**，不是 B.3 的 provenance 标记：
       `watch` 不在规范的角色枚举（orch / impl / rev / des / intg）内，本行也不用
       `委派:` 字段。首行是**暗号**而非输出标记，因此不参与 B.3 的推导链，也不会
       被误读为某个角色的结论。若将来规范为传输层定义角色，再改用该枚举值。
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
   - `claims` 追加，**不截断 `ROUTED`，不删除 `CLAIMED`，也不删除
     `DISMISSED`**。水位被欠账钉住时，最近 500 条截断会让旧已投递评论
     重读后重发；终态同理——删掉 `DISMISSED` 会让同一评论重读后重新进入
     分类，已经判过的条目又会变回欠账。本版本不做自动 GC。
   - 所有状态写入必须持有同一个锁，手动运行也一样；并集合并不是并发写保护。
   - 完整拉取并完成本轮处理/记账后，更新 `lastCompletedPollAt = now`，
     清空 `activeRun`，重置 `consecutiveInterruptions = 0`；**无新评论同样更新**。
     只有实际推进水位才更新 `lastSuccessfulAdvanceAt`。有 pending/CLAIMED
     的已完成轮询仍算完成，但 `lastError` 记欠账原因；没有欠账才清空错误。
     判为终态的条目**不算欠账**，不进 `lastError`。已完成的轮询若仍有欠账，
     必须同步刷新 pending 里 `channel-blocked` 条目的 `pendingUndelivered`
     计数，别让它停留在旧值上自相矛盾。
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

   **「未完成投递」项只含 `CLAIMED`（及 `UNROUTED`）——不含终态。**
   `ROUTED` 已投递，`DISMISSED` 已作出结论，两者都不是待办：把它们列进
   欠账会让同一条目每轮复现一次，人工分诊成本无上限。

   另附：处理条数、路由去向、在途 stage、pending 积压总数、
   **终态计数**（按 `dismissRule` 分组，如 `D1=12 D2=2`）、
   `consecutiveInterruptions` 当前值（> 0 时提示需要人工查看），
   以及**本轮经兜底评论投递的条数**——大于 0 时提示「唤醒已进持久
   邮箱，需人在线转达或由有会话通道的会话排空」。

   终态计数出现在简报里是为了让「本层判过什么」可复核（每条的
   `dismissedAt` / `dismissReason` 都在状态文件里可查），**它本身不是
   待办**，不得表述成「未完成」。

## 健康信号（本 skill 必须如实产出）

watcher 曾经静默失效 2.5 天而无人察觉，原因有两层：一是失败被报成
成功，二是「启动了但没推进」与「没新评论」不可区分。因此：

- `lastStartedAt` 与 `lastCompletedPollAt` 区分启动和完整轮询；完成时间长期不前进
  才需排查（无新评论也会更新完成时间），不能用水位是否前进判断中断。
- `lastSuccessfulAdvanceAt` 只表示水位推进；pending 钉住水位不等于轮询中断。
- `activeRun` 与中断计数按步骤 1/7 更新；锁阻塞时不得写共享状态，报告阻塞即可。
- 简报不得把「本轮未完成」表述成「无新评论」。这些健康规则由 skill 执行，
  不是独立 watchdog；硬中断后的自动恢复和外部告警不在本版本保证内。
