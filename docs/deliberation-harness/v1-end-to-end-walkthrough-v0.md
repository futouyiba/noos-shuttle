# V1 End-to-End Walkthrough

> Working Design Note（V0；仅用于 V1 实验，不修改或重新解释 frozen v4）。

## 1. Baseline assumptions

- 一个 Work Item 只有一个 Primary Design Logical Thread（PDLT）。Reviewer、Sedimentation、Evidence Worker 均为 supporting child thread。
- Logical Thread 是持久身份；Provider Conversation 与 Browser Carrier 是可替换载体。当前仓库能证明的浏览器语义来自 `docs/noos-shuttle-page-context-events.md`；用户指定的五份 Harness contract 在当前 checkout 不存在，因此下文不虚构其字段，并将缺少可验证语义的 seam 标为 GAP。
- `SUPPORTED` 表示已有可见 contract 足以可靠完成；`GAP` 表示没有明确 contract 无法保证正确性、幂等性或恢复性。
- Human authority boundary：创建/授权 Work Item、批准 fork、Freeze exact target、接受 Review Result 均需人类确认；自动恢复只恢复状态，不替人作决定。

## 2. Full happy-path trace

| Step | Actor / Logical Thread | Relevant state | Operation | Expected transition | Verdict | Evidence from current contracts |
|---|---|---|---|---|---|---|
| 1. Create Work Item | Human → PDLT（尚未 bootstrap） | Work Item `CREATED`；无 carrier | `CREATE_WORK_ITEM` | 分配 immutable `work_item_id`、PDLT id、goal/scope snapshot、epoch=0 | **GAP** | 现有仓库没有 Work Item/Logical Thread bootstrap contract；thread format 只描述 handoff 对象。 |
| 2. Bootstrap Primary | PDLT | Logical `BOOTSTRAPPING`；provider conversation/carrier 尚无绑定 | `BOOTSTRAP` submission | 创建或绑定 provider conversation，carrier 进入 `READY`，logical state=`CONTINUE` | **GAP** | 缺少 Logical identity→conversation/carrier 初始 binding、epoch 和 READY/CONTINUE 组合的 Harness contract。 |
| 3. GO cycle（数次） | PDLT | carrier `READY`；logical `CONTINUE` | 带 operation id 的 `GO` | `READY+CONTINUE`→提交→观察→logical `WAITING/CONTINUE`；同 operation 重试不重复执行 | **GAP** | page-context 文档只保证 conversation 变化时 reset；没有 GO 状态机、提交 receipt 或重复 GO 判定。 |
| 4. Periodic/event Goal Re-anchor | PDLT + Human authority | goal/scope snapshot 可能过期 | `REANCHOR_GOAL` | 触发条件、去重 key、批准边界明确；成功后更新 goal revision 并 reset 周期计数 | **GAP** | 无 re-anchor trigger、reset、revision 或 authority contract；不能证明 refresh/restart 后不会重复 re-anchor。 |
| 5. Risk grows | PDLT | context/memory risk=`HIGH` | `ASSESS_RISK` | 保持 PDLT 活跃；不改变 provider binding | **GAP** | 没有风险阈值或何时允许 fork 的 contract。 |
| 6. Fork Sedimentation Worker | PDLT → Sedimentation child | parent epoch `e`；child `CREATED` | `FORK_SEDIMENTATION` | child 获得 parent goal/scope + bounded context snapshot；独立 conversation/carrier；parent 不被占用 | **GAP** | primary/child lifecycle 文件缺失，无法证明隔离、fork 幂等键或 parent epoch capture。 |
| 7. Sedimentation writes durable memory | Sedimentation child | child carrier `READY`; logical `RUNNING` | `WRITE_MEMORY` ingest | 写 Crystal/Result，receipt 含 object id/hash；child → `COMPLETED`→`RETIRED` | **GAP** | NOOS system 定义 ingest receipt，但没有 worker completion、写入授权及 exactly-once 与 provenance 约束。 |
| 8. Return to Primary | PDLT | parent仍为 epoch `e`；child retired | `RESUME_AFTER_CHILD` | 读取 child completion/object ids；确认 parent binding 仍 current，否则 rollover；logical→`CONTINUE` | **GAP** | 没有 child completion callback、join barrier、parent epoch compare 或恢复路由 contract。 |
| 9. Continue Design | PDLT | carrier `READY`; logical `CONTINUE` | `GO` | 继续同一 logical thread；memory provenance 可追溯 | **GAP** | 同 Step 3，且 durable memory→conversation 注入没有 Harness contract。 |
| 10. Freeze exact target | Human + PDLT | design candidate active | `FREEZE_TARGET` | 固化 exact target hash/revision、scope、authority；后续 reviewer 只读该快照 | **GAP** | 无 freeze schema、不可变 target identity 或“人类批准后才冻结”的边界定义。 |
| 11. Spawn Fresh Independent Reviewer | Human → Reviewer child | reviewer `CREATED`; independent carrier | `SPAWN_REVIEWER` | 传入 exact target +最小必要 context；禁止继承 PDLT conversation memory；记录 source epoch | **GAP** | 无 fresh reviewer context envelope、independence 证明和 fork 幂等语义。 |
| 12. Reviewer completes | Reviewer child | reviewer carrier `READY`; logical `RUNNING` | `SUBMIT_REVIEW` | 产生 immutable Review Result（target hash、reviewer logical id、source epoch）；child→`RETIRED` | **GAP** | 无 Review Result schema、completion receipt、retired provenance 保留规则。 |
| 13. Route result to current active PDLT conversation | Router/Hub | PDLT 可能 rollover 到 epoch `e+1` | `DELIVER_REVIEW_RESULT` | 按 `(work_item_id, pdlt_id, current_epoch)` 路由到当前 carrier；旧 tab/conversation 只能拒绝或转发 | **GAP** | page context 能发现 conversation change，但无 logical→current carrier resolver、epoch fencing、stale delivery 行为。 |
| 14. Resume/revise | PDLT + Human | current carrier `READY`; logical `CONTINUE` 或 `REVISE` | `GO` / `REVISE_FROM_REVIEW` | 人类决定是否采纳；更新 design revision；保留 review provenance | **GAP** | 无 review acknowledgement、revision lineage 或结果消费幂等 contract。 |

### 关键组合结论

`Browser Carrier READY + Logical Control CONTINUE` 只能作为可提交前置条件；当前可见文档没有定义二者的原子检查，因此不能判为 SUPPORTED。`UNCERTAIN` submission 若无 operation ledger 与 fencing，可能重复 GO、重复 fork 或重复 Review。

## 3. Recovery traces

### Service worker restart

Page context 的 content script 会重新启动，且 refresh/pagehide 会取消等待，这是浏览器层 **SUPPORTED**（`docs/noos-shuttle-page-context-events.md`）。但恢复哪个 Logical Thread、哪个 operation、哪个 epoch 没有持久 ledger，故 Harness transition 为 **GAP**。

### Duplicate tab

两个 tab 可分别报告同一 conversation；现有 page signature 只能识别 conversation 变化，不能选主 carrier 或 fencing duplicate carrier。正确路由与单次提交均为 **GAP**。

### Uncertain GO submission

没有可验证的 submission operation id、状态查询、结果去重和 retry policy；无法证明只执行一次，故 **GAP**。

### Uncertain fork

没有 parent-epoch + deterministic fork key 的 create-or-get 语义；重试可能产生两个 Sedimentation/Reviewer child，故 **GAP**。

### Parent Design rollover while Reviewer active

页面 context reset 可阻止旧 conversation 继续捕获（浏览器层 **SUPPORTED**），但 Review Result 没有 current-epoch route、stale rejection 或 rebind 流程，故 **GAP**。

## 4. Genuine contract gaps

1. Work Item→PDLT bootstrap 的持久 identity、binding、epoch。
2. Submission operation ledger：GO/fork/review 的 idempotency、UNCERTAIN 查询与 fencing。
3. Goal re-anchor 的 trigger、revision、reset 和 human authority。
4. Parent/child lifecycle：隔离、join/resume、completion callback、RETIRED provenance。
5. Freeze exact target 与 reviewer independence 的不可变 context envelope。
6. Current-carrier resolver：按 logical id + epoch 路由，旧 tab/conversation 拒绝；覆盖 rollover、duplicate tab、restart。
7. Review Result acknowledgement/consumption 与 revision lineage。

## 5. Minimal proposed additions

仅补充上述 blocker 所需的最小字段/规则：

- `WorkItemBinding`：`work_item_id`、`logical_thread_id`、`provider_conversation_id`、`carrier_id`、`epoch`、`goal_revision`、`scope_hash`。
- `SubmissionOperation`：`operation_id`、`kind`、`logical_thread_id`、`parent_epoch`、request hash、状态 `PENDING|APPLIED|UNCERTAIN|REJECTED`；provider 重试必须先 query-or-reconcile。
- `ForkKey=(parent_logical_id,parent_epoch,kind,target_hash)`，create-or-get；child completion receipt 必须带 object ids/hash 与 parent epoch；RETIRED 只停止执行，不删除 provenance。
- `GoalAnchor` 与 `FreezeTarget`：不可变 revision/hash、human approver、时间；re-anchor 成功后显式 reset 周期。
- `ContextEnvelope`：Reviewer 只接收 frozen target + 明确列出的 evidence，禁止 provider conversation 继承；记录 source logical/epoch。
- `CarrierLease`：每个 logical/epoch 只有一个 READY carrier；旧 carrier 标记 `STALE`，route 必须按 current epoch resolver。
- `ReviewDelivery`：`review_result_id`、target hash、destination logical id、destination epoch、delivery/ack 状态；epoch 不匹配则进入待人工 rebind，不自动投递旧 tab。

## 6. V1 readiness assessment

结论：**尚不足以进入第一版实现实验**。现有仓库文档能支撑浏览器页面 context 变化检测、refresh/pagehide 取消等待和基础 NOOS 对象 provenance，但不能可靠完成 V1 所需的 bootstrap、幂等 submission、child worker join、freeze/reviewer independence 或 rollover 后结果路由。实现实验前至少应先补齐第 5 节的最小 contract；不需要引入 V2 peer Designer、通用 graph 或 semantic supervisor。
