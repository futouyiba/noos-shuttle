# Shuttle 快捷动作（沉淀 / 速览 HTML / 查 PR 评论）— 设计提案 v0（rev.1）

Issue: futouyiba/noos-shuttle#61
Branch: `docs/shortcut-actions-proposal`
证据绑定 revision: `6731a60e7d468e040c86e7e28a5f87161b193e1e`
（本文所有 `file:line` 均绑定该 revision；`git show <rev>:<path>` 可逐条复核。）

**rev.1 提交说明**：本 rev 为**纯文档修订**，不触碰任何 `src/` / `apps/` / `public/` 产品文件，故**证据绑定 revision 保持不变**（仍为 `6731a60e`）。rev.1 的提交对象是 PR #87 上的新 head，其 sha 以 PR head 为准；证据绑定的 revision 不随文档提交而前移，这是刻意的——否则 `file:line` 将失去可复核性。

状态: **已获 Epic Designer 裁定 `PARTIAL_ACCEPT`（15 条 required delta），本 rev 逐条处置完毕，待独立复审。**
本文不含任何产品代码改动；**不 merge、不部署、不关 #61**。

上游已裁定文书：

| 文书 | 结论 | 与本提案的关系 |
| --- | --- | --- |
| **本 Work Item 主裁定**（PR #87 primary design disposition，评论 `5749808986`，裁定对象 head `f44bfb05`） | `PARTIAL_ACCEPT` | **本 rev 的权威范围定义**；15 条 required delta 逐条处置见 §0.1 / §6 |
| Issue **#60** Primary Design Disposition | `PARTIAL_ACCEPT` | 提供 payload 注册表与**唯一定位规则**；本提案的 payload 必须落进该注册表，不得另立第二套（不重开） |
| Issue **#63** Primary Design Disposition | `PARTIAL_ACCEPT`（10 条 required delta） | delta 9 **明言 v0 不统一 Go × N / 快捷动作 / Outbox 三类 producer**；本提案的边界由此确定 |
| #56 disposition Q1–Q6（转录入 `bcr-multitab-observation-defect-proposal-v0.md` §8） | — | 提供 per-logical-thread authority、provenance 归因、lease/fence 守卫的已裁语义 |
| #54 disposition（`chatgpt-provider-recovery-go-n-proposal-v0.md` §4） | — | Evidence Gate 原文；本提案的「何时算接受」沿用，不重开 |

---

## 0. 结论摘要

本提案主张：**#61 不是一条新的投递通道，而是既有 `dispatchHumanGo` → `HumanGoRuntime` → `SubmissionOperation` 路径上的三个新 payload 生产者**。三条动作全部复用同一套 lease / fence / READY / exactly-once；差异只在 payload 内容、产物落点与**账本 operation kind 标注**。

三条主结论（rev.1 已按裁定更新）：

- **主张 1（沉淀）**：`SEDIMENT` 应当接通。当前它是死枚举（§2 F1），「沉淀」一律记为 `GO`，导致账本与 Hub 投影无法区分沉淀与普通续跑——这正是 #61 Acceptance 第二条要解决的事。**裁定 ACCEPT（delta 1）**：沉淀是**独立语义动作**，Crystal 保持「结构化可复用知识结晶」不变，**不把 Crystal 重定义为两者**；两者可共享下游存储原语。
- **主张 2（速览 HTML）**：产物走 **Thread/Crystal 同族的 marker 包裹通道** + 新增捕获谓词，落点 v0 只做 Downloads；**引入专用 operation kind `OVERVIEW_HTML`**。
  > **rev.1 修正**：v0 原文写「不新增 operation kind」并倾向复用死枚举 `REVIEW_DISPATCH`。**裁定 delta 3 REVISE 否决该写法**——详见 §0.1 delta 3 与 §6 Q3。
- **主张 3（查 PR 评论）**：按 Human decision 2026-09-18（#61 正文）走 ChatGPT 注入，**水位落在扩展侧 `chrome.storage.local`**，**v0 只巡检单条 PR**，**绝不与实例侧 watcher 水位（`.tmp/watcher-state.json`）共享**；**引入专用 operation kind `PR_COMMENT_SWEEP`**。
  > **rev.1 修正**：v0 原文倾向标注为 `GO` + `workItemId` 区分。**裁定 delta 3 REVISE 否决**。

- **主张 4（BCR run ACTIVE 期间的行为）**：非续跑快捷动作在 BCR run `ACTIVE` 期间**被拒绝**，沿用既有 `bcrRunActive` 拒绝路径（`src/content/index.ts:1488`），**不**接入 #63 的 provenance-bound expected-turn 预留机制。**裁定 ACCEPT（delta 13）**，维持通用文案。

**rev.1 的中心改动**：三条快捷动作的**账本身份改为真实身份**——沉淀 = `SEDIMENT`，速览 HTML = `OVERVIEW_HTML`（新增枚举），PR 评论巡检 = `PR_COMMENT_SWEEP`（新增枚举）。**这是身份/provenance 修正，不是新的 actuation 通道**：三个 kind 全部留在既有 `SubmissionOperation` 生命周期与 authority/fence/reconciliation 契约内（delta 14，见 §5.6）。

---

## 0.1 对裁定 15 条 required delta 的逐条处置

裁定对象：`docs/deliberation-harness/shuttle-shortcut-actions-proposal-v0.md` @ `f44bfb05`（PR #87）。本表逐条对应裁定原文的 required delta 1–15。

| # | 裁定要求（摘要） | 本版处置 | 落点 |
| --- | --- | --- | --- |
| 1 | Q1 ACCEPT + 语义分离：Crystal 保持结构化可复用结晶；沉淀是独立语义动作，不得重定义 Crystal；两者可共享下游存储原语 | **已按裁定落文**，并补足原文未答的「沉淀产物落点」：沉淀复用既有 auto-delivery 三选一落点（copy / download / vault），不新造落点；并说明为何沉淀复用既有 marker 族与捕获谓词而非新造第二套 | §0 主张 1、§5.1、§5.5、§6 Q1 |
| 2 | Q2 ACCEPT：不得为图省事把 `HumanGoRuntime` 的硬编码 GO 语义摊成通用 kind switch；走 kind 特化 composer，照 `DELIVER_CHILD_RESULT` 成例 | **已按裁定落文**（原文倾向 B 即此，裁定确认 B） | §0 主张 1、§6 Q2 |
| 3 | **Q3 REVISE**：用真实 operation identity。沉淀用 `SEDIMENT`；速览 HTML 与 PR 评论清扫**各自引入专用 kind**；**不得**把速览 HTML 编码为 `REVIEW_DISPATCH`，**不得**把 PR 评论清扫编码为 `GO` | **已改**。v0 原文两处被否决的写法均已删除：速览 HTML 的 `REVIEW_DISPATCH` 复用、PR 评论的 `GO` 标注。新增 `OVERVIEW_HTML` / `PR_COMMENT_SWEEP` 两个枚举成员，并列出新增成员必须同步的全部校验面 | §0 主张 2/3、§3「operation kind 表」、§2 F9、§5.6、§6 Q3 |
| 4 | Q4 ACCEPT：每个快捷动作在 #60 注册表站点各有一条 canonical payload 定义/注册项；允许共享 builder helper，**不得**另立第二注册表 | **已按裁定落文** | §3、§6 Q4 |
| 5 | Q5 ACCEPT：把「直接处理」改为**有界分类/上报**；payload 不得暗示 merge / deploy / push / close / 本地测试执行或其他不可用、敏感 actuation | **已按裁定落文**，并给出定稿后的 payload 草稿（含显式封口清单 + 显式「无新评论不得静默」） | §5.3（payload 定稿）、§6 Q5 |
| 6 | Q6 ACCEPT for v0：要求**显式 PR ref** 作为动作输入/上下文；自动发现是后续能力，**不得**作为本切片内的隐藏启发式 | **已按裁定落文**，并补「无显式 ref 即拒绝，不猜」 | §6 Q6、§3、§8 |
| 7 | Q7 ACCEPT：PR 评论水印是 **feature-local** durable state，**MUST NOT** 共享或推进 `.tmp/watcher-state.json`；两者 subject 与 consumer 不同 | **已按裁定落文**，并补并发写实现约束（同一 prRef 单写者，串行推进） | §2 F5、§5.3、§6 Q7、§8 |
| 8 | **Q8 DEFER pending validation**：不得仅凭推断把 `comment id` 排序冻结为契约；实现选定游标前须**验证所选 connector/API 的检索与排序语义**；durable 游标须支持**确定性去重/重放**；单一标量 id 若不足以确立该性质，改用能确立的游标形状（如稳定事件身份 + 观测到的排序边界）；**不得单用 `createdAt` 作权威** | **已改为验证门**：v0 的「`id` 高水位」**降级为候选之一，明确不予冻结**；新增验证门（要证什么、怎么证、证不出时的退路），并补一条原文未识别的关键约束——**游标由扩展侧持有，但检索发生在 ChatGPT 侧**，故游标必须可由 payload 表达、可由回复观测回传 | §6 Q8（**本 rev 的核心新增**）、§5.3、§7 切片 5 |
| 9 | Q9 ACCEPT for v0：速览产物为**单文件自包含 HTML、无外部依赖、固定呈现、仅 Downloads**；Vault 摄取/object type 是后续 Work Item | **已按裁定落文**（原文四点倾向全部获确认） | §6 Q9、§8 |
| 10 | Q10 ACCEPT：专用 `NOOS:HTML:BEGIN/END` marker 族 + 专用捕获谓词，**可复用既有生成物等待状态机**；**不得**新建第二套等待协议 | **已按裁定落文**；并收口原文遗留的「三反引号围栏约束」子问题（裁定未直接裁定，本版按实现约束明示，见 §6 Q10） | §2 F7、§6 Q10、§8 |
| 11 | Q11 ACCEPT：**不得**仅为 HTML 产物新建 projection store；submission provenance + 实际下载产物/路径对 v0 足够 | **已按裁定落文** | §5.5、§6 Q11、§8 |
| 12 | Q12 ACCEPT as product IA：续跑仍是主操作，沉淀 / 速览 HTML / PR 评论清扫为辅助动作；**不授权更宽的面板重设计** | **已按裁定落文** | §6 Q12、§8 |
| 13 | Q13 ACCEPT：ACTIVE run 期间非 run 快捷动作经既有 `bcrRunActive` 边界继续被拒绝；**不得**消耗 #63 的 expected-turn 预留使其在 run 内可跑 | **已按裁定落文**（原文主张 4 + Q13 倾向即此） | §5.4、§6 Q13 |
| 14 | 三个新语义身份必须留在既有 `SubmissionOperation` 生命周期及其 authority/fence/reconciliation 契约内；**新增枚举成员不得被当作放宽 actuation 权限或绕过账本的借口** | **已改**：新增 §5.6 专章正面声明，并列出新增枚举成员必须同步的**全部**校验面（4 处）与「新增 kind 不改变任何 guard / 不改变任何 authority 判据」的边界 | §5.6（**新增专章**）、§2 F9、§8 |
| 15 | 更新 §3 / §6 / §7 与 **Issue #61 acceptance mapping**，使 operation-kind 表与实现切片与该裁定一致 | **已改**：§3 operation-kind 表重写；§6 全节改为「裁定结果 + 本版处置」；§7 切片按新 kind 与 Q8 门重排；**新增 §11 = #61 Acceptance 逐条映射** | §3、§6、§7、§11（**新增**） |

> 表中**无一条**处置为「已满足，无需改动」——15 条全部要求了或确认了文本改动（ACCEPT 类 delta 亦须把「待裁」框架改写为「已裁 + 本版处置」，见 §6 开头说明）。逐条「裁定要求 / 本版处置 / 落点」的对照以上表为准。

---

## 1. Scope 与与 #60 / #63 的边界

**本提案的语义对象**：三个（含续跑共四个）**用户手动触发、立即执行**的 Shuttle 面板动作——其 payload 归属、**账本 operation kind 身份**、产物落点、水位存储、以及它们在 BCR run 生命周期中的门控。

**明确不在本提案内（不重开）**：

| 不重开 | 依据 |
| --- | --- |
| 续跑 token 的取值与语言选择（`继续` / `go on`，跟随 UI locale） | #60 已裁定 |
| payload 注册表的形态（唯一 canonical 定义站点、与 i18n `COPY` 分开） | #60 Required delta 1 |
| #63 的 outbox 全部语义（`OUTBOX_MESSAGE`、queue store、provenance-bound 预留、UNCERTAIN 队首阻塞） | #63 已裁定 10 条 delta |
| #54 Evidence Gate 内容、RecoveryBudget、provider-native Retry、context rebase | #54 已裁定；#56/#63 亦明写不得重开 |
| 既有 `RuntimeObservationLedger` 的 READY/STABILIZING 判据与 2 s quiet 窗口 | #63 正文已认定「硬骨头已经啃完」，本提案不改 |
| 本 Work Item 的裁定结论本身（15 条 delta） | 主裁定 `5749808986`；本 rev 只做处置，不重开 |

**与 #60 的接缝**：本提案的 payload 一律经由 #60 建立的注册表站点（`src/core/continuation-payload.ts`，当前 112 行）扩展，**不新建第二个注册表**。见 §3。

**与 #60 的一处形态澄清（rev.1 补充）**：`continuation-payload.ts:38-59` 的注册表形状是 `Readonly<Record<ShuttleLocale, ContinuationPayloadDefinition>>`——**以 locale 为唯一维度**，且该文件的头注释（`:12-16`）明写内部身份不变、`SubmissionOperationKind="GO"` 与 continuation mode 是**内部账本/求值器契约**，只有被派发的字面量随 locale 变化。故快捷动作在**同一站点**扩展时：

- 复用的是「canonical 定义站点」这一**属性**，不是 `ContinuationPayloadDefinition` 这一**形状**；
- 快捷动作 payload **不以 locale 为维度**（下 §6 Q9 已裁 v0 固定版式、无风格参数），故不并入 locale 映射；
- 快捷动作的 operation kind **不是** continuation mode 的变体——它是新的账本身份（delta 3）。

**与 #63 的接缝**：本提案是**独立 producer**，不是 `OUTBOX_MESSAGE` 的特化。理由是「投递时机由谁决定」不同——见 §4.1。

---

## 2. 现状证据表

### F1 `SEDIMENT` 是已声明但从未 dispatch 的死枚举

仓内 `SEDIMENT` 的全部出现（`grep -rn '"SEDIMENT"' src apps tests`）：

| 位置 | 用途 | 是否构成 dispatch |
| --- | --- | --- |
| `src/core/submission-operation.ts:2` | 类型别名成员 | 否 |
| `src/core/submission-operation.ts:610` | `isSubmissionOperationKind` 校验器成员 | 否（只做白名单放行） |
| `src/background/service-worker.ts:777` | background 侧 `isPrepareInput` 白名单 | 否 |
| `apps/noos-hub/src/harness/types.ts:63` | Hub fixture 类型 | 否 |

**结论（`CODE`）**：无任何调用点以 `operationKind: "SEDIMENT"` 调用 `ledger.prepare()`。当前「沉淀」经 `dispatchHumanGo` 走完全同一条路径，而 `HumanGoRuntime` 在 `src/core/human-go-runtime.ts:74` **硬编码 `operationKind: "GO"`**：

```ts
const prepared = await this.ledger.prepare({
  operationId: request.operationId,
  operationKind: "GO",          // ← 单一硬编码，HumanGoRequest 无字段可覆盖
  ...
```

`src/content/index.ts:1483` 的 `dispatchHumanGo(payload, context, workItemId, options)` 只允许调用方区分 `workItemId`（`"noos-generate-crystal"` / `"noos-generate-handoff"` / `"shuttle-bcr-run"`），**无法区分 kind**。故 #61 正文所述「现在每次『沉淀』实际记录为一条 `GO`」属实。

> **rev.1 复核**：以上四处位置在本 rev 的证据绑定 revision 上逐条实测一致；此外 `REVIEW_DISPATCH` 与 `BOOTSTRAP` 同样属**声明但零 dispatch** 的死枚举（见 F9）。

### F2 `HumanGoRuntime` 是「GO 专用」通道，但存在 kind 特化先例

`HumanGoRuntime.execute()`（`src/core/human-go-runtime.ts:64-118`）是唯一被面板动作使用的 actuation composer，其 guard 链为：

| 顺序 | 检查 | 失败返回 |
| --- | --- | --- |
| 1 | `explicitGo && operationId` | `claim_lost` |
| 2 | `carrier.carrierState === "READY"` | `carrier_not_ready` |
| 3 | `carrier.logicalControl === "CONTINUE"` | `control_not_continue` |
| 4 | `carrier.explicitGo` | `claim_lost` |
| 5 | `providerConversationRef` 双方齐备 | `identity_missing` |
| 6 | `sameFence(carrier, context)` | `fence_mismatch` |
| 7 | `initializeAuthority` → `prepare` → 复读 carrier → `claim` | `claim_lost` / `UNCERTAIN` |
| 8 | `dispatch()` → 回执 → 对账 | `DISPATCHED` / `UNCERTAIN` |

仓内**已存在** kind 特化 transport composer 的成例：`src/core/deliver-child-result.ts` 自建 `SubmissionOperation(kind=DELIVER_CHILD_RESULT)`（`:112`），并用确定性 operationId（`childDeliveryOperationId`，`:40`）保持 create-or-get 幂等；其文件头注释（`:5-7`）明写「canonical transport lifecycle lives entirely on the SubmissionOperation ledger」。**即：kind 特化不需要新账本，只需要新 composer。** 本提案的主张 1 与主张 3 都据此。

> 该成例另有一条可迁移的实现约束：其注释（`:32-37`）写明 operation id 不能用分隔符保证单射，故用**哈希 delivery 身份**生成确定性 id，且**跨交付的哈希碰撞以 `operation_id_reuse_conflict` 大声失败（fail-closed），绝不静默合并**。三个快捷动作的确定性 operationId 生成应沿用同一 fail-closed 立场。

### F3 扩展侧目前没有 GitHub 可达性

`public/manifest.json:22-41` 的 `host_permissions` 为 ChatGPT 族 + 飞书族 + `http://127.0.0.1/*` + `http://localhost/*`——**不含 `github.com`**。扩展对外的唯一非 provider 通道是本地 Hub（`src/background/service-worker.ts:114-122`，一律 `http://127.0.0.1:17642/...`）。

**推论（`INFER`）**：任何「扩展自行解析关联 PR」的方案都必须新增 GitHub host permission 或新增 Hub 端点，二者都是新授权面。见 §6 Q6 与 §8。

**在 Q8 上的额外推论（rev.1 新增，`CODE`→`INFER`）**：PR 评论的**检索**发生在 ChatGPT 侧（人 decision：注入 ChatGPT 对话），而水位的**持有**在扩展侧（F4）。扩展自身**无法**独立复核 ChatGPT 报回的检索结果——它既不持有评论、也没有 GitHub 可达性。故 Q8 的游标形状不是单纯的「选一个标量」，而是「选一个**能经 payload 表达、并能从被注入轮次的回复中被观测回传**的游标」。这是原文未识别、裁定亦未指定的第三条约束，本 rev 把它并入 Q8 验证门。见 §6 Q8。

### F4 扩展侧已有成熟的 durable 存储与 background coordinator

`chrome.storage.local` 已是多个 feature 的持久层（`service-worker.ts:125-126` 的 `{get,set}` 封装）：

| 键 | 位置 |
| --- | --- |
| `noosHubShuttleToken` | `service-worker.ts:123` |
| `noosGoalReanchors` | `background/goal-reanchor-runtime.ts:4` |
| `noosPendingSpawns` | `background/spawn-runtime.ts:33` |
| `noosSubmissionAuthority`（per-logical-thread map） | `submission-operation.ts:92` |

`noosSubmissionAuthority` 的 per-thread 分槽即 #56 disposition Q1 / required delta 2 已裁定的形态（`foldAuthorityMap`，`submission-operation.ts:594-603`，仅对 legacy flat 记录做向前折叠）。

### F5 实例侧 watcher 水位是全局单值，且不在本仓

`noos-watch` 的状态文件在**主 checkout** 的 `.tmp/watcher-state.json`（未纳入版本控制；本 worktree 中不存在）。其形状为：

```json
{ "watermark": "2026-09-20T11:27:48Z", "pending": [ ... ] }
```

单个全局 `watermark`，`pending` 数组逐条记录 CLAIMED / ROUTED 与 `lastRecheckedAt`。**它不是 per-PR 水位**，语义也不同（它服务的是「把我的评论投递给哪个会话」，不是「某 PR 自上次以来有什么新评论」）。**裁定 delta 7 ACCEPT：两者 subject 与 consumer 不同，MUST NOT 共享或推进。** 见 §6 Q7。

### F6 速览 HTML 全无实现（`CODE`）

`grep -rn` 无任何 HTML 产物相关的 prompt 模板、action、marker 常量或落点。现有 marker 常量只有两组：`NOOS_THREAD:BEGIN/END`（`src/core/noos-thread.ts:1-2`）与 `NOOS_CRYSTAL:BEGIN/END`（`src/core/noos-crystal.ts:1-2`）。

### F7 等待/捕获路径已参数化，可零成本复用

`waitForGeneratedHandoff`（`src/content/index.ts:2334`）与 `waitForGeneratedCrystal`（`:2458`）是**同一状态机**，差异只在捕获谓词（`captureNoosThreads` vs `captureNoosCrystals`）与文案。共享常量：`WAIT_FOR_HANDOFF_TIMEOUT_MS = 120_000`（`:195`）、`GENERATION_START_GRACE_MS = 1_500`（`:196`）、`GENERATION_QUIET_MS = 2_500`（`:197`）、`CAPTURE_RETRY_MS = 1_200`（`:198`）、`CAPTURE_POLL_MS = 1_500`（`:199`）。

状态机的实际形状（`waitForGeneratedCrystal`，`:2458-2472`）= `capture(getPageText())` → `findNewest<X>After(candidates, baselineBegin)` → 命中则落 viewState。**故「第三个实例」的增量是 `captureNoosOverviews` + `findNewestHtmlAfter` 两个谓词，不是新机制。** 这是 #61 正文 §B 待决项 5 的直接答案，也是裁定 delta 10 的落点。

### F8 现有落点适配器是 Markdown 专用

`src/storage/DownloadAdapter.ts:8` 是 `StorageAdapter` 的实现，其 `saveThread` 硬编码 `type: "text/markdown;charset=utf-8"` 与 `thread.rawMarkdown`，并用页内 `<a download>` 触发（未使用 manifest 已声明的 `downloads` 权限）。Vault 侧 `object_type` 现有族为 `handoff` / `crystal` / `result`（`src/core/filename.ts:67`；`src/content/index.ts:729-731` 的 Hub 浏览分组）。

**推论（`CODE`）**：HTML 产物**不能**直接复用 `DownloadAdapter.saveThread()` 的类型签名。见 §6 Q9。

### F9 operation kind 的校验面共 4 处（rev.1 新增）

`grep -rn '"REVIEW_DISPATCH"\|"SEDIMENT"\|"BOOTSTRAP"' src apps tests` 的完整结果——新增任何 operation kind 成员都必须**同步这 4 处**，否则出现「类型层放行、运行时拒绝」或反向的静默错配：

| # | 位置 | 作用 | 漏改后果 |
| --- | --- | --- | --- |
| 1 | `src/core/submission-operation.ts:2` | `SubmissionOperationKind` 类型别名 | TS 层不可表达 |
| 2 | `src/core/submission-operation.ts:610` | `isSubmissionOperationKind` 运行时守卫 | **持久化记录复读被判定为非法，落账 fail-closed** |
| 3 | `src/background/service-worker.ts:777` | background 侧 `isPrepareInput` 白名单 | **prepare 消息被 background 丢弃** |
| 4 | `apps/noos-hub/src/harness/types.ts:61-64` | Hub fixture 类型 | Hub 侧 fixture/投影无法表达新 kind |

> 这 4 处是**纯声明/校验面**，不含任何授权判据。裁定 delta 14 要求新增枚举成员**不得**成为放宽 actuation 权威或绕过账本的借口；本表即是该约束的机械落点——它说明「加一个 kind」在实现上是 4 行声明同步，而在语义上是零授权增量。见 §5.6。
>
> 另注：`REVIEW_DISPATCH` 与 `BOOTSTRAP` 在本 revision 上同样**零 dispatch**。裁定 delta 3 明言 `REVIEW_DISPATCH` **命名的是 review dispatch 语义**，不是「让 ChatGPT 产出点什么」的通用桶。故本 rev **既不占用它、也不删除它**——它留给本 Work Item 范围之外的真实 review-dispatch 消费者，保持未认领状态。

---

## 3. Payload 与定位（对齐 #60 唯一定位规则）

#60 裁定的唯一定位规则原文要求：「canonical uniqueness should be the **payload definition/registry symbol plus exact repository path**」，且「One canonical payload registry/definition site must make each provider-facing payload mechanically discoverable and consumers must reference it rather than duplicating production literals」。

本提案据此提出注册表扩展形态（**示意，非实现**；形态已按裁定 delta 3 更新）：

```ts
// src/core/continuation-payload.ts —— 同一个站点，不新建第二个注册表（delta 4）
// 注意：与 CONTINUATION_PAYLOADS 的 locale 映射形状不同（见 §1 形态澄清），
// 符号唯一性由 registry symbol + 本文件路径确立。
export type ShortcutActionId = "SEDIMENT" | "OVERVIEW_HTML" | "PR_COMMENT_SWEEP";

export interface ShortcutPayloadDefinition {
  readonly actionId: ShortcutActionId;
  /**
   * 与 payload 一并落账的动作类型标注。delta 3 后它与 ledger 的 operationKind
   * 同名同义——这正是该修正的目的：账本对「实际发生了什么操作」不再说谎。
   */
  readonly workItemId: string;
  readonly build: (context: ShortcutPayloadContext) => string;
}
```

**`actionId` 与 `operationKind` 的关系（delta 3 的正面表述）**：对这三个快捷动作，二者**刻意重合**。v0 原文把它们拆开（`actionId` 一套、kind 复用 `GO`/`REVIEW_DISPATCH` 一套）造成账本与 payload 两个真相源对同一动作给出不同身份。修正后：

| 快捷动作 | registry symbol（payload 侧） | ledger operationKind（账本侧） | 是否新增枚举 |
| --- | --- | --- | --- |
| 沉淀 | `SEDIMENT` | `SEDIMENT` | 否（死枚举接通，F1） |
| 速览 HTML | `OVERVIEW_HTML` | `OVERVIEW_HTML` | **是** |
| 查 PR 评论 | `PR_COMMENT_SWEEP` | `PR_COMMENT_SWEEP` | **是** |
| 续跑 | （#60 已完成，`ContinuationPayloadMode`） | `GO` | 否 |

> 续跑一行的 kind 为 `GO` 是**既有已裁事实**，不是本提案的标注选择：`continuation-payload.ts:12-16` 明写 `SubmissionOperationKind="GO"` 是 continuation 的内部账本契约。本提案不重开。

**不新增枚举的动作（边界声明）**：既有面板动作 `noos-generate-crystal`（`src/content/index.ts:1461-1481`）与 `noos-generate-handoff` 属**既有**动作，不在 #61 的三个快捷动作之内。它们今日经 `HumanGoRuntime` 记为 `GO`，**本 Work Item 不改其记录**。裁定 delta 1 要求的是「沉淀不得把 Crystal 重定义为两者」，未要求为 Crystal 引入新 kind；本 rev 严格照此办理，不扩大范围。

关键约束（**其中 1–3 项为 v0 原文既有，第 4 项 rev.1 新增**）：

1. **注册符号唯一性覆盖模板，不覆盖展开后的字符串。** PR 评论巡检 payload 内插 `since` 水位与 PR ref，每次点击的字节都不同；要求「整串字面量全仓唯一」在此不可满足也无意义。
2. **展开后的字节仍必须是对账依据。** 既有对账语义匹配 dispatched bytes（#60 delta 4 明写「Fingerprinting and acceptance matching must use the exact dispatched payload bytes as today」）。实现细节见 `fingerprintSubmissionPayload`（`src/core/submission-operation.ts:648-653`）：它**先把空白折叠为单空格、trim，再截断到前 2000 字符**，然后做 32 位滚动哈希。两点后果：

   - **含水位的 payload 只对账「这一次尝试的字节」**，故它**不可被幂等重试复用**——任何重试必须是新的 operationId + 新 payload。此项**不**与 #54「unknown 不盲重发」冲突，反而是它的实现形态。
   - **截断是有界的**：若某条 payload 的前 2000 个规范化字符完全相同而后段不同（例如把水位/PR ref 放在长段落之后），两条不同 payload 会得到相同指纹。**故实现时水位与 PR ref 必须置于 payload 前部**——这不是本提案要裁的语义，但必须写进实现约束（否则会得到一个静默的 `OBSERVED_ACCEPTED` 误配）。
3. **不得并入 i18n `COPY` 表。** 同 #60 delta 1；`src/shared/i18n.ts` 的 `COPY` 是给人读的面板文案，payload 是给模型读的契约。
4. **面板按钮文案走 `COPY`。** 与 payload 注册表分离：按钮文案是 UI 文案，中英同步（#61 共同要求），落 `src/shared/i18n.ts`，形如 `bcrRunActive`（`i18n.ts:53` 类型 / `:259` 英文 / `:457` 中文）的既有模式。

**与 `OUTBOX_MESSAGE` 的关系（必须显式声明）**：#63 delta 1 已把 `OUTBOX_MESSAGE` 定义为「a Human-authored message whose actuation time was delegated to Shuttle」，并明写它 **MUST NOT be encoded as `GO`, `SEDIMENT`, or a focus request**——反向亦成立。因此本提案：

- **不**把任何快捷动作编码成 `OUTBOX_MESSAGE`；
- **不**要求 v0 统一二者的 producer；
- 仅在 §4.1 记录「未来统一」的接缝位置，**不作为本提案的实现前提**（#63 delta 9）。

---

## 4. 投递时机：独立能力，不是 #63 的 producer

### 4.1 为什么不是 #63 的 producer

#63 的 outbox 与 #61 的快捷动作在**表面**上都是「准备 payload + 合适时机投递」，但分界点在 #63 正文自己写下的那句：

> 即区分不在消息内容（手打的那条同样是用户真写的），而在**投递时机由谁决定**。

| 维度 | #63 Outbox | #61 快捷动作 |
| --- | --- | --- |
| 谁决定时机 | **Shuttle 决定**（用户排入队列，Shuttle 等空闲） | **人决定**（点击即此刻执行） |
| 投递前状态 | 排队等待；队首未就绪则等 | 无队列；`dispatchHumanGo` 当场等最多 6 s 拿 READY，拿不到就 BLOCKED |
| 条目生命周期 | 可编辑 / 可取消 / 可暂停 / 有序 | 无条目——点击即一次操作，无中间态 |
| Run ACTIVE 期间 | 有优先级规则（#63 delta 4） | **直接拒绝**（§5.4，裁定 delta 13 ACCEPT） |
| 与 Run 的关系 | provenance-bound expected-turn 预留 + 对账（#63 delta 3） | 无预留——故只能拒绝（**不得**消耗该预留，delta 13） |

**结论**：快捷动作**没有「时机」这个问题域**，它只有「当场能不能拿到合法 lease」这个问题——而那个问题 `dispatchHumanGo` 已经用 6 s READY 轮询 + `HumanGoRuntime` 的 6 道 guard 回答了（`src/content/index.ts:1492-1499`，`src/core/human-go-runtime.ts:66-71`）。**故本提案是独立能力，不是 #63 的 producer。**

**未来统一的可能性（仅记录，非前提）**：#63 delta 9 允许「later share a payload registry or scheduling substrate」。二者真正重合的边界点只有一处——`SubmissionOperation` actuation 边界。若未来要把快捷动作改成「可排队」，那等于把它变成 outbox 的 producer，届时需要的是**新增 provenance-bound 归因**（使该 turn 不被 Run 读成 `USER_INTERVENTION`），那是 #63 delta 3 的能力，不在本提案内。

### 4.2 三个动作的投递形态

| 动作 | 触发 | 投递 | 是否等待产物 |
| --- | --- | --- | --- |
| 沉淀 | 面板按钮 | `dispatchHumanGo`，当场 | 等待（复用既有 marker 捕获与等待状态机，见 §6 Q1） |
| 速览 HTML | 面板按钮 | `dispatchHumanGo`，当场 | 等待（新增捕获谓词，复用同一状态机） |
| 查 PR 评论 | 面板按钮 | `dispatchHumanGo`，当场 | **不等待产物**——注入的指令要求 ChatGPT **在对话里回答**，不产出可捕获的 marker 文档 |

> 「查 PR 评论」不等待，是它与其他两个的结构性差异：它的输出是**给人读的对话回复**，不是待落盘的产物。故它**不占用** `activeWait` 状态机，也就不会与「沉淀 / 速览」的等待互斥（三者共用同一个 `activeWait` 单槽，任意两个同时触发会互相 `cancelActiveWait`）。
>
> **推论（rev.1 补充）**：既然「查 PR 评论」的输出是对话回复而非产物，Q8 的游标**观测回传**必须依赖那段回复本身（见 §6 Q8），不能依赖捕获谓词。

---

## 5. Authority / 证据门

### 5.1 三类动作的分类

| 动作 | 向页面输入 | 向 provider 发送 | 写本地 | 分类 |
| --- | --- | --- | --- | --- |
| 沉淀 | 是（composer + submit） | 是 | 是（复用既有 auto-delivery 三选一：copy / download / vault） | **actuation** |
| 速览 HTML | 是 | 是 | 是（Downloads，v0，裁定 delta 9） | **actuation** |
| 查 PR 评论 | 是 | 是 | 是（水位，`chrome.storage.local`） | **actuation** |
| 续跑 | 是 | 是 | 否 | **actuation**（已裁定） |

> **rev.1 修正**：v0 原文「沉淀」行的落点写作「取决于 Q5」——**该交叉引用是错的**（Q5 是 PR 评论 payload 的封口问题，与沉淀落点无关）。裁定 delta 1 要求沉淀「可共享下游存储原语」，故本版明确：沉淀**不新造落点**，复用面板既有的 auto-delivery 三选一（`src/content/index.ts:540-546` 的 `delivery-options`：`copy` / `download` / `vault`）。这也正面回答了 #61 正文 §A 待决项 3「沉淀产物的落点」。

**三者全部是 actuation**，没有「只是读」的动作。这一点必须在提案里写明，因为它排除了一条看似省事的路径：把「查 PR 评论」实现成扩展直接 `fetch` GitHub——那不但需要新增 host permission（F3），还会绕过账本直接改变状态，属 #61 共同要求第一条明禁的形态。

### 5.2 走哪条既有路径

**唯一合法路径**（#61 共同要求第一条；BCR 报告 §3 已确立）：

```
面板按钮
  → dispatchHumanGo(payload, getPageContext(), workItemId, options)   src/content/index.ts:1483
    → <kind 特化 composer>（照 deliver-child-result.ts 成例，delta 2）
      → SubmissionOperationLedger.prepare / claim                     src/core/submission-operation.ts
        → 页内 composer 输入 + submit（不 querySelector 直接提交）
```

**lease / authority 依据（均为已裁，不重开）**：

| 约束 | 出处 |
| --- | --- |
| 只有 canonical lease holder 可 actuate；carrier/tab 身份是证据而非授权键 | #56 disposition Q2 / required delta 1 |
| authority 按 logical execution identity 分槽（非浏览器全局单槽） | #56 disposition Q1 / required delta 2；实现于 `submission-operation.ts:92,594-603` |
| 非 holder 的 mutation 必须被 reducer/background lane 拒绝 | #56 required delta 1 |
| carrier 替换本身不构成 provider 接受证据，也不得据此重发 | #56 disposition Q5 / required delta 3 |
| `READY_TO_GO` + 无 pending operation ≠ 制造新 provider turn 的授权 | #56 disposition Q4 |
| UNKNOWN/UNCERTAIN 只可 wait/re-observe/reconcile，不得 refresh/Retry/resend/continue/rebase | #54 Evidence Gate 原文 |

**Evidence Gate 对快捷动作的具体含义**：三个动作都**不引入新的恢复语义**。它们的「接受证据」就是既有的 `OBSERVED_ACCEPTED`（由 `acceptedPayloadFingerprint` 与 dispatched bytes 匹配确定，`submission-operation.ts:20` 字段注释）。**快捷动作不得到达 UNCERTAIN 后自行重发**——那属 #54，需独立裁定。

### 5.3 「查 PR 评论」的三条硬约束与 payload 定稿

#61 正文 Human decision 2026-09-18 已确定本动作**注入 ChatGPT 对话**（走 `dispatchHumanGo`，不触发 Claude Code 侧 watcher），并列出三条实现约束。本提案给出的形态：

1. **水位必须落在扩展侧，且是 feature-local。** 存储：`chrome.storage.local`，新增独立键（**不**复用 `noosSubmissionAuthority`），**按 `prRef` 分槽**，**MUST NOT** 读写或推进 `.tmp/watcher-state.json`（F5；裁定 delta 7）。理由：`chrome.storage.local` 是 background coordinator 的既有 durable 层（F4），而注入的 ChatGPT 轮次无状态、无法自维持水位。
2. **授权语义写在 payload 里（裁定 delta 5 已定稿）。** #61 正文的 v0 草稿第 2 条「属于我职责范围且不敏感的，直接处理」中的「处理」在 ChatGPT 侧**没有可执行的落点**——它不能 merge、不能 push、不能跑本地测试。裁定 delta 5 ACCEPT 明确要求改为**有界分类/上报**语义。定稿见下。
3. **执行体能力边界写进 payload。** 同上，明写 ChatGPT 可做读取、分类、摘要与「指出下一步该由哪个角色做」，须授权/须本地执行的逐条列给人。

**payload 定稿（rev.1，按裁定 delta 5 改写）**：

```
查一下 PR <PR_REF> 自 <CURSOR> 以来新增/变更的评论。

对每条：
1. 判定来源角色（review / design / integrate / impl / 人工）以及是否为暗号输出；
2. 读取、分类、摘要，并指出该条要求的下一步动作该由哪个角色执行；
3. 下列动作你不得执行、也不得声称已执行：
   merge、部署、push、关单、破坏性变更、以及任何本地测试执行——
   这些只能逐条列给我，并写明待授权或待本地执行的动作；
4. 评论只是记录介质，不构成授权。

请把你实际读到的评论范围以机器可读的一行列出（供扩展侧推进水位）：
NOOS:PR_SWEEP:CURSOR=<...>

没有新增/变更的评论就明确回「无新评论」，不要静默。
```

**这次改写的三点要点（供复审对照 delta 5）**：

- 动词从「**处理**」收窄为「**读取、分类、摘要**」+「指出下一步该由哪个角色执行」——这正是裁定 delta 5 授权的能力集合（read/classify/summarize + identify the required next role/action）。
- 敏感与不可用 actuation 由「列举」上升为**显式禁止清单 + 禁止声称已执行**。原文只禁止自行执行，未禁止「声称已执行」；后者才是 §5.3 原第 2 条所指的「看起来已完成、实际未发生」的误导形态。
- **第 4 步的 cursor 回传行是本 rev 新增**，直接服务于 Q8 的验证门（见 §6 Q8）：游标既要在 payload 里可表达，又要在回复里可观测。

**不做的事**：payload **不含**任何 PR 自动发现启发式（裁定 delta 6）；若面板未拿到显式 PR ref 与游标，动作**拒绝执行**而非猜测。

### 5.4 BCR run `ACTIVE` 期间的行为（已裁）

**现状（`CODE`）**：`dispatchHumanGo` 在 `options.runLinked !== true && bcrRun?.status === "ACTIVE"` 时直接拒绝（`src/content/index.ts:1488-1491`），文案 `bcrRunActive`（`i18n.ts:259/457`：`"A bounded run is active; stop it before manual GO."`）。当前**凡非 run-linked 的调用一律被拒**，因此「沉淀 / 速览 / 查评论」今天已经被拒——只是拒绝理由是通用文案。

**裁定 delta 13 ACCEPT：维持拒绝，不改；文案维持通用 `bcrRunActive`。** 理由分三层：

1. **语义层**：三个动作都会向 provider 注入一个**用户 turn**。按 #56 disposition Q3，Run 侧只有在「观察到一个新的 Human-authored provider turn，且**无法归因**到当前授权的 SubmissionOperation」时才判 `USER_INTERVENTION`。快捷动作若在 ACTIVE 期间放行，其 turn **无法被归因**（没有 provenance-bound 预留），Run 会被终结。
2. **架构层**：让它可以归因，需要 #63 delta 3 的能力（durable 预留 + 精确对账 + 事后 reconcile，且不得留下松散的 `+1` 基线）。**#63 delta 9 明确禁止本类工作外溢**，#63 delta 3 的实现也尚未开工（无 PR）。裁定 delta 13 另外明写：**不得消耗该 expected-turn 预留**来让快捷动作在 active run 内可跑。
3. **产品层**：拒绝是可解释的、可操作的（面板文案已说「先停止 Run」）。而放行会制造一个**难以诊断的静默失败**——正是 #56 报告记录的失效模式。

**文案取值（已裁）**：保持一行通用文案。动作专属文案会让用户以为「终将可用」，而实际在 v0 内不会放开。

### 5.5 provenance / 可追踪性

#61 共同要求末条要求「每个快捷动作的产物或触发需有可追踪 provenance（对话 ref、动作类型、时间、产物路径或水位）」。既有账本**已经**给出前三项：`SubmissionOperation.providerConversationRef`（对话 ref）、`workItemId`（动作类型）、`createdAt`（时间）。**delta 3 修正后，第四项「动作类型」不再依赖 `workItemId` 的字符串约定——`operationKind` 本身就是真实动作身份。**

| 动作 | 第四项 provenance | 形态 |
| --- | --- | --- |
| 沉淀 | 产物路径（crystal key / preferred_path） | 由共享的下游落点原语提供；`createCrystalPreferredPath`（`src/core/filename.ts:30`） |
| 速览 HTML | 产物路径 | payload 内**要求模型在产物里内嵌**一行机器可读来源（对话 ref + 动作 id + 时间），由捕获侧读取；**不新建账本投影**（裁定 delta 11） |
| 查 PR 评论 | 水位 | 水位记录本身携带 `prRef` / cursor / observed ordering boundary / `at`（游标形状待 Q8 验证门定，本 rev 不冻结） |

**裁定 delta 11 ACCEPT：不为 HTML 产物新建 projection store。** 三个动作的 provenance 都内嵌在既有账本字段 + 产物自身，避免出现第二个真相源（#56 boundary 已明禁「second canonical carrier-binding/lease ledger」，同理）。

### 5.6 新增 operation kind 的边界声明（裁定 delta 14，rev.1 新增专章）

裁定 delta 14 原文要求：三个新语义身份必须留在既有 `SubmissionOperation` 生命周期及其 authority/fence/reconciliation 契约内；**新增枚举成员不得被当作放宽 actuation 权限或绕过账本的借口**。本提案正面声明如下：

**（a）新增 kind 不改变任何 guard。** `HumanGoRuntime.execute()` 的 8 步 guard 链（§2 F2）与 `deliver-child-result.ts` 的 kind 特化 composer 都**只因 kind 不同而有不同的 `operationKind` 字面量**；`explicitGo`、`carrierState === "READY"`、`logicalControl === "CONTINUE"`、`providerConversationRef` 齐备、`sameFence`、`initializeAuthority`、claim 复读、dispatch 回执与对账——**逐条不变**。三个快捷动作拿到的新 kind **不附带任何新的通行权**。

**（b）新增 kind 不改变任何 authority 或 fence 判据。** operations 的 authority 仍按 logical execution identity 分槽（`submission-operation.ts:92`），fence 仍是那五个 authority 字段，carrier 身份仍只是证据而非授权键（§5.2 表）。**没有一条新增的 authorization 分支**。

**（c）新增 kind 在实现上只是 4 处声明/校验同步，零授权增量。** 见 §2 F9。这 4 处全部是类型/白名单/fixture，**不含任何 guard 或阈值**。

**（d）新增 kind 不改变对账语义。** 接受判定仍是 dispatched bytes 的指纹匹配（`acceptedPayloadFingerprint`），不因 kind 而放松或收紧。

**（e）不新增投递通道。** 三个动作仍全部经 `dispatchHumanGo` 的页内 composer + submit（§5.2 路径图），不出现新的 actuation 出口、不出现 `fetch` GitHub（F3）、不出现新 Hub 端点。

**（f）不做 outbox 特化。** 三个新 kind **不是** `OUTBOX_MESSAGE`；不引入排队、不引入 provenance-bound expected-turn 预留、不触碰 UNCERTAIN 队首阻塞（§4.1、§8）。

**（g）死枚举的处置。** `REVIEW_DISPATCH` 与 `BOOTSTRAP` 保持未认领、不删除、不占用（§2 F9）。**特别地：本 rev 不使用 `REVIEW_DISPATCH` 承载速览 HTML**——裁定 delta 3 已明确它命名的是 review dispatch 语义。

---

## 6. 裁定结果与本版处置（逐 Q）

**本节写法说明**：v0 原文的 13 个 Q 都是「请求裁定的问题」。裁定已逐条给出结论，故本节由「问题清单」改写为「**裁定结论 + 本版处置**」。每条的「v0 倾向」保留，以便复审对照「裁定是否被我错误解读」——这是本 rev 的可审性要求，不是冗余。**裁定未强制改动的条目，本版亦如实标注为「原文已一致」并给出位置，不为显得改了而制造改动**；但 ACCEPT 类条目仍须把「待裁」框架改写为「已裁 + 本版处置」，属 delta 15 要求的文本一致化。

### Q1 — 沉淀：复用 Crystal 通道，还是另立更轻的 SEDIMENT 通道？

**裁定：ACCEPT，附语义分离（delta 1）。** 保留 Crystal 作为「结构化可复用知识结晶」；沉淀是**独立语义动作**；不得把 Crystal 重定义为两者；两者**可共享下游存储原语**。

**v0 倾向**：双轨并存，语义分工。→ **与裁定一致，原文即此。**

**本版处置**：

1. **落点明确化（原文未答）**：沉淀**不新造落点**，复用面板既有 auto-delivery 三选一（copy / download / vault，`src/content/index.ts:540-546`）。这是 delta 1「可共享下游存储原语」的直接实现，也补上了原文 §5.1 的错引（原文写「取决于 Q5」）。
2. **捕获路径明确化（原文未答，本版派生并声明为实现约束）**：沉淀**复用既有 `NOOS:CRYSTAL` marker 族 + `captureNoosCrystals` 谓词 + 同一等待状态机**，不新建 marker 族、不新建捕获谓词、不新建等待协议。理由见下。
3. **「轻」落在哪里**：轻在**契约**，不在**传输**——沉淀的 payload 不要求 10 个 frontmatter 字段与 4 个固定章节。

**为何复用而非新造（`CODE` 依据）**：`captureNoosCrystals`（`src/core/crystal-capture.ts:18`）**是宽容解析**——`validateCrystal`（`:171-198`）产出的是 **warnings 而非 errors**，且 `deriveTitle`（`:141`）、`deriveSummary`（`:150`）、`deriveKey`（`:162`）在 frontmatter 字段缺失时**均有 fallback**。故一个不含完整 frontmatter 与四章节的沉淀产物**仍可被既有谓词捕获**，并有既有的 `crystalCapturedWithWarnings` 分支（`src/content/index.ts:2472`）承接。新建第二套 marker/等待协议既无必要，也撞 §8 的 non-goal 与裁定 delta 10 的精神（「不得新建第二套等待协议」）。

**必须向复审暴露的可观测后果（本版不掩饰）**：因共用谓词与 envelope，沉淀产物在 UI 与投影里会**呈 crystal 形状**并带 validation warnings。裁定 delta 1 要求的是**语义**分离（Crystal 不得被重定义为两者），本版据此把分离落在**账本 kind（`SEDIMENT`）+ payload 契约**上，而**不改 envelope**。若复审认为产物层也必须可区分，则需在**布局切片（§7 切片 6）**里解决，且必须避开两条被 foreclose 的路（新 marker 族 / 第二套等待协议）——本版不预设其解法，明示为待复审点。

**仍需实现层回答**：沉淀产物与 Crystal 产物在 Hub 浏览分组（`src/content/index.ts:729-731`）里是否需要区分。本版**不裁定**（属呈现层，且 delta 12 不授权更宽的面板重设计）。

### Q2 — 沉淀的接通方式：扩展 `HumanGoRuntime`，还是另立 composer？

**裁定：ACCEPT（delta 2）。** 不得为图省事把 `HumanGoRuntime` 的硬编码 GO 语义摊成通用 kind switch；用 kind 特化 composer，照 `DELIVER_CHILD_RESULT` 成例，同时复用同一套 authority/fence/reconciliation 不变量。

**v0 倾向**：B（另立 `sediment-dispatch.ts`）。→ **与裁定一致，原文即此。**

**本版处置**：确认 B，并把「不做什么」写实——**不给 `HumanGoRequest` 加 `operationKind` 字段**（即否决 v0 的方案 A）。理由与裁定同：`HumanGoRuntime` 的名字与 guard 链（`explicitGo` 必须为 true）都是 **GO 续跑**专用的；让沉淀从它的 `explicitGo` 门穿过，等于把「沉淀」表达成一种 GO。

**三个动作均适用同一形态**：`OVERVIEW_HTML` 与 `PR_COMMENT_SWEEP` 同样各自走 kind 特化 composer，不扩 `HumanGoRuntime`。

### Q3 — 三条动作各需哪种 operation kind？（**v0 的枢纽问题**）

**裁定：REVISE（delta 3）。** 用**真实的 durable operation identity**：沉淀用 `SEDIMENT`；为速览 HTML 与 PR 评论清扫**各自引入专用 kind**（命名随仓库风格，如 `OVERVIEW_HTML` / `PR_COMMENT_SWEEP`）。**不得**把速览 HTML 编码为 `REVIEW_DISPATCH`；**不得**把 PR 评论清扫编码为 `GO`。这是**身份/provenance 修正，不是新的 actuation 通道**。

**v0 倾向**：速览 HTML 复用死枚举 `REVIEW_DISPATCH`；查评论标 `GO` + `workItemId` 区分。→ **被裁定否决。本版已按裁定改写。**

**裁定的理由（照录，本版认同并采纳）**：把语义不同的动作编码成既有 kind 会让 durable ledger **对「实际发生了什么操作」说谎**，并违反 #61 自己的验收要求（每个快捷动作要有清晰的 operation-kind 归属，而非被压平成 `GO`）。`REVIEW_DISPATCH` 也不是「让 ChatGPT 产出点什么」的通用桶——它命名的是 review dispatch 语义，拿它生成 HTML 会制造这个功能本要消除的 provenance 歧义。

**本版处置**：

| 动作 | v0 写法（否决） | rev.1 写法 | 同步面 |
| --- | --- | --- | --- |
| 沉淀 | `SEDIMENT`（已在册，接通即可） | `SEDIMENT`（不变） | 0 处新增，0 dispatch → 1 dispatch |
| 速览 HTML | `REVIEW_DISPATCH` 或 `GO` | **`OVERVIEW_HTML`（新增枚举成员）** | §2 F9 的 4 处 |
| 查 PR 评论 | `GO` + `workItemId` 区分 | **`PR_COMMENT_SWEEP`（新增枚举成员）** | §2 F9 的 4 处 |

并新增 §5.6 专章承接 delta 14（新 kind 不得放宽权威或绕过账本），新增 §2 F9 列出新增成员的**全部**校验面。

**对 `REVIEW_DISPATCH` 的处置**：未认领、不删除、不占用（§2 F9、§5.6(g)）。

### Q4 — 三个动作共享一个「快捷动作」payload 族，还是各占一个条目？

**裁定：ACCEPT（delta 4）。** 每个快捷动作在 #60 注册表站点各有一条 canonical payload 定义/注册项；允许共享 builder helper；**不**另立第二注册表。

**v0 倾向**：各占一个条目，共享同一注册站点。→ **与裁定一致，原文即此。**

**本版处置**：确认；并补 §1 的形态澄清——复用 #60 站点的是「canonical 定义站点」属性，快捷动作 payload **不以 locale 为维度**，故不并入 `CONTINUATION_PAYLOADS` 的 locale 映射形状。

### Q5 — 「查 PR 评论」payload 中的「直接处理」是否必须改为「分类并列出」？

**裁定：ACCEPT（delta 5）。** 改为**有界分类/上报**语义；注入的 ChatGPT 动作可 read/classify/summarize 并指出所需的下一个角色/动作；merge、deploy、push、close、本地测试执行或其他不可用/敏感 actuation **不得**被 payload 暗示。

**v0 倾向**：必须改。→ **与裁定一致，原文即此。**

**本版处置**：写出**定稿 payload**（§5.3），并做两处超出 v0 倾向的收口（均已标注理由）：(a) 把敏感/不可用 actuation 从「列举」升级为**显式禁止 + 禁止声称已执行**；(b) 新增 cursor 回传行，服务 Q8 验证门。v0 曾问「改写后仍保留『不敏感者可自行整理』的余地，还是完全收缩为只读枚举」——裁定给的是前者（read/classify/summarize allowed），故定稿保留摘要与分类。

### Q6 — 关联 PR 的发现方式（v0 范围）

**裁定：ACCEPT for v0（delta 6）。** 要求**显式 PR ref** 作为动作输入/上下文；自动发现是**后续**能力，**不是**本切片内的隐藏启发式。

**v0 倾向**：v0 由人显式提供 PR ref，不做自动发现。→ **与裁定一致，原文即此。**

**本版处置**：确认；并补一条缺口：**若无显式 ref 与游标，动作拒绝执行而不是猜测**（§5.3 末）。「不是隐藏启发式」在实现上就等于「无输入即拒绝」——这是原文未写死的部分。

### Q7 — 水位与实例侧 watcher 水位的关系

**裁定：ACCEPT（delta 7）。** PR 评论清扫的水印是 **feature-local** durable state，**MUST NOT** 共享或推进 `.tmp/watcher-state.json`；两个水印的 **subject 与 consumer 不同**。

**v0 倾向**：完全不共享，且互不干扰。→ **与裁定一致，原文即此。**

**本版处置**：确认；并收口 v0 自己提出的并发写问题（「同一 PR 连点两次按钮」）：**按 `prRef` 分槽 + 同槽单写者串行推进**，游标推进是 compare-and-set 语义（只在观测到本次回复的 cursor 回传后才推进）。「不重复处理」只有在「不并发推进」下才成立，故此为 Acceptance 第四条（§11）的必要实现约束，不是可选优化。

### Q8 — 水位基线取什么量？（**本 rev 的核心改动**）

**裁定：DEFER pending validation（delta 8）。** 不得仅凭推断把 `comment id` 排序冻结为契约。实现选定游标前，须**验证所选 connector/API 的检索与排序语义**。durable 游标须支持**确定性去重/重放安全**；若单一标量 id 在所选检索路径下不足以确立该性质，改用能确立游标形状（例如稳定事件身份 + 观测到的排序边界）。**不得单用 wall-clock `createdAt` 作权威。**

**v0 倾向**：`id` 高水位 + `updatedAt` 查编辑，标 `PENDING_VALIDATION`。→ **被裁定降级：不得冻结。本版已改为验证门。**

**本版处置**：

**(1) 明确不予冻结。** 本文档**不**把 `comment id` 高水位、也不把任何其他单一标量设为已定契约。§5.3 定稿 payload 中的 `<CURSOR>` 与 `NOOS:PR_SWEEP:CURSOR=<...>` 均为**占位**，其形状由下列验证门产出后才定。

**(2) 本版新增的第三条约束（原文未识别、裁定亦未指定）：检索在 ChatGPT 侧，游标在扩展侧。** 由 F3 + F4 与 Human decision 2026-09-18 共同推出：扩展**无** `github.com` 可达性，无法自行复核 ChatGPT 报回的检索结果；被注入的轮次又**无状态**（F4 理由）。故游标形状必须同时满足三条，缺一即不可实现：

| # | 约束 | 来源 |
| --- | --- | --- |
| i | 可由 payload **表达**（能写进注入文本） | delta 8「实现选定游标前须验证」+ §5.3 payload |
| ii | 可从回复**观测回传**（ChatGPT 能按格式回报） | 本版新增；§4.2 推论 |
| iii | durable 且支持**确定性去重/重放安全** | delta 8 原文 |

v0 的「单一 comment id 高水位」在 (iii) 上即已可疑（编辑过的旧评论会改变排序可见性），在 (ii) 上更未被检验——这正是裁定判 DEFER 的实质。

**(3) 验证门（实现切片 5 的开工前置，未过不得选定游标）**。要证的命题与证伪退路：

| 命题 | 为何要证 | 证伪/不足时的退路 |
| --- | --- | --- |
| 所选检索路径下评论的**排序语义**（按 id？按 updated？分页边界？） | delta 8 原文要求 | 记录实测语义，不假设 |
| 单一标量游标能否确立**去重/重放安全** | delta 8 原文要求 | 改用「稳定事件身份 + 观测到的排序边界」复合游标 |
| ChatGPT 能否**按格式稳定回报**其实际读到的范围 | 本版 (ii) | 若不能稳定回报，则退回「人指定范围」（#61 正文已列的退化路径） |
| 被编辑的旧评论是否会被本次巡检重新纳入 | #61「不重复处理」的真实含义 | 若会，游标需带「已见事件身份集合」而非纯水位 |

**(4) 明确禁用**：`createdAt` **不得单独**作为权威（delta 8 原文）；`updatedAt` 亦不得单独作权威（同类 wall-clock 脆弱性）。

**(5) 本版不伪造该结论。** 同 v0 立场：本文未实测，故不给结论。这与 v0 的差别不在「有验证门」——v0 也标了 `PENDING_VALIDATION`——而在**游标形状从「倾向」降级为「未定」**：v0 已经倾向 `id` 高水位并把验证当作确认，裁定要求的是把它当成**仍待证伪的候选**。

### Q9 — 速览 HTML 的产物落点与形态

**裁定：ACCEPT for v0（delta 9）。** 单文件自包含 HTML、无外部依赖、固定呈现、**仅 Downloads**。Vault 摄取/object type 是**后续** Work Item。

**v0 倾向**：四点全确认（单文件 / 无外部依赖 / 固定版式无参数 / v0 仅 Downloads）。→ **与裁定一致，原文即此。**

**本版处置**：确认四点，条目化落文（§0 主张 2、§8）。Downloads 侧注意 F8：HTML **不能**复用 `DownloadAdapter.saveThread()` 的 Markdown 类型签名，需新的落点调用，但**不新造落点类别**（仍是 Downloads）。

### Q10 — 速览 HTML 的 marker 与捕获机制

**裁定：ACCEPT（delta 10）。** 专用 `NOOS:HTML:BEGIN/END` marker 族 + 专用捕获谓词，**可复用**既有生成物等待状态机；**不得**新建第二套等待协议。

**v0 倾向**：新增 `NOOS:HTML:BEGIN/END`，照 Thread/Crystal 同族通道。→ **与裁定一致，原文即此。**

**本版处置**：确认；并按 F7 把「复用同一状态机」写实为**两个谓词**（`captureNoosOverviews` + `findNewestHtmlAfter`）+ 复用 `baselineBegin` 去重（`newestMarkerBegin` 族，`src/content/index.ts:2587/2591`），**零新状态机**。

**v0 遗留子问题收口**：v0 曾问「速览 HTML 不得使用三反引号围栏」这一约束（Crystal 模板有）是否继续施加。裁定 delta 10 未直接裁定此项，本版按**实现约束**明示：**继续施加**——HTML 产物本身不需要三反引号，而判据是**必须避开**的：Crystal 的 `normalizeCapturedCrystal`（`crystal-capture.ts:71-82`）会尝试剥离外层围栏，若 HTML 内容里出现围栏会产生与捕获层的歧义。**本项非裁定结论，属本版派生，标注供复审否决。**

### Q11 — 产物落点与账本的真相源关系

**裁定：ACCEPT（delta 11）。** **不得**仅为 HTML 产物新建 projection store；submission provenance + 实际下载产物/路径对 v0 足够。

**v0 倾向**：不新建 projection store。→ **与裁定一致，原文即此。**

**本版处置**：确认（§5.5）。v0 曾请 designer 指出「若需要可枚举索引，应落扩展侧还是 Hub 侧」——裁定未指定索引，等于确认 v0 倾向；本版据此**不再保留该开放问题**。

### Q12 — 面板快捷动作区的位置与「续跑」的落位

**裁定：ACCEPT as product IA（delta 12）。** 续跑仍是**主操作**；沉淀 / 速览 HTML / PR 评论清扫为**辅助动作**。**不授权更宽的面板重设计。**

**v0 倾向**：续跑入 `primary-actions`（`src/content/index.ts:528-534`），其余入 `supporting-actions`（`:554-559`）。→ **与裁定一致，原文即此。**

**本版处置**：确认分区。v0 曾问「快捷动作区是否需要独立视觉分组」并自答「属实现局部，不在本提案裁定范围」——裁定 delta 12 的「不授权更宽的面板重设计」与之同向，故本版**明确记为 non-goal**（§8），不再作为开放问题。

### Q13 — BCR run ACTIVE 期间的拒绝文案

**裁定：ACCEPT（delta 13）。** 非 run 快捷动作经既有 `bcrRunActive` 边界继续被拒绝；**不得**消耗 #63 的 expected-turn 预留使其在 run 内可跑。

**v0 倾向**：维持通用 `bcrRunActive` 文案。→ **与裁定一致，原文即此。**

**本版处置**：确认，并按 §5.4 三层理由落文；「不得消耗 #63 预留」作为独立边界写入 §5.4 与 §8。

---

## 7. 建议切片（rev.1，已按裁定重排）

| # | 切片 | 依赖 | 未裁定语义 | 裁定对应 |
| --- | --- | --- | --- | --- |
| 1 | payload 注册表扩展（`ShortcutActionId` + 三条 definition 站点，**不以 locale 为维度**） | #60 已完成 | 无（Q4 已裁） | delta 4 |
| 2 | 沉淀接通（`SEDIMENT` kind 特化 composer + 面板入口 + 复用既有 marker/等待/落点） | — | 产物层是否需与 Crystal 区分（§6 Q1 末，**呈现层**，不阻塞切片开工） | delta 1/2/3 |
| 3 | **operation kind 声明同步**（`OVERVIEW_HTML` + `PR_COMMENT_SWEEP` 两成员 × §2 F9 的 4 处） | — | 无（纯声明/校验面，零授权增量） | delta 3/14 |
| 4 | 速览 HTML（prompt 模板 + `NOOS:HTML` marker + 两个捕获谓词 + Downloads 落点） | 切片 1、3 | 无（Q9/Q10/Q11 已裁） | delta 9/10/11 |
| 5 | 查 PR 评论（**Q8 验证门先行** → 游标定形 → 水位存储 → payload 定稿 → `PR_COMMENT_SWEEP` composer） | 切片 1、3、**Q8 验证门** | **Q8 未过则本切片不可开工** | delta 5/6/7/8 |
| 6 | 快捷动作区布局与 i18n 收口（含续跑落位） | — | 无（Q12/Q13 已裁；不做更宽面板重设计） | delta 12/13 |

> 切片 2 / 3 / 6 **无未裁定依赖，裁定后可立即开工**。
> 切片 4 依赖切片 3 的枚举成员先落地（否则 `prepare` 会被 §2 F9 的第 2/3 处守卫拒绝）。
> 切片 5 的**第一件事是 Q8 验证门**，不是写代码——这是裁定 delta 8 把游标从「倾向」降级为「未定」的直接后果。
> 每个运行期切片仍需各自的 exact-head 复审与常规晋升门（裁定 Resume condition）。

---

## 8. 边界 / non-goals

- **不**实现 #63 的 outbox（`OUTBOX_MESSAGE`、queue store、scheduler、provenance-bound expected-turn 预留、UNCERTAIN 队首阻塞）。
- **不**把任何快捷动作编码为 `OUTBOX_MESSAGE`（#63 delta 1 明禁）——特别地，**三个新 kind 不得被扩大解释为投递通道或 outbox 特化**（裁定 delta 14）。
- **不**消耗 #63 delta 3 的 expected-turn 预留来让快捷动作在 active run 内可跑（裁定 delta 13）。
- **不**统一 Go × N / 快捷动作 / Outbox 三类 producer（#63 delta 9）。
- **不**重构 `HumanGoRuntime` 的 GO 语义、`RuntimeObservationLedger`、`continuation-evaluator` 或 Go × N 预算；**不**给 `HumanGoRequest` 加 `operationKind` 字段（§6 Q2）。
- **不**重开 #54 Evidence Gate / RecoveryBudget / provider-native Retry / context rebase / Automation Boundary；**不**改 #54/#56 的恢复、lease/fence 语义。
- **不**新建第二套 marker 捕获机制、第二套等待状态机、第二个 payload 注册表、第二个 authority/lease 账本；**不**为 HTML 产物新建 projection store（裁定 delta 11）。
- **不**占用、删除或重新解释死枚举 `REVIEW_DISPATCH` / `BOOTSTRAP`；**不**以 `REVIEW_DISPATCH` 承载速览 HTML（裁定 delta 3）。
- **不**为快捷动作新增任何 GitHub host permission 或 Hub 端点；**v0 的 PR ref 仍是显式输入**，**不**做自动发现、**不**做隐藏启发式（裁定 delta 6）。
- **不**与实例侧 watcher（`noos-watch` / `.tmp/watcher-state.json`）共享或推进水位/状态；**不**把 PR 评论动作做成第二个 watcher（裁定 delta 7）。
- **不**为速览 HTML 新增 Vault `object_type`、样式/风格参数、或自动敏感 GitHub 动作（裁定 delta 9）。
- **不**授权在 UNCERTAIN 状态下自行重发（#54 语义不变）。
- **不**改 i18n 以外任何 UI 文案契约；不新增语言推断或逐动作语言选择器（#60 boundary 原文）。
- **不**做更宽的面板重设计（裁定 delta 12）。
- 本文**不含运行时代码**；不修改任何产品文件；不关 #61；不 merge、不部署。

---

## 9. 证据索引（行号绑定 `6731a60e7d468e040c86e7e28a5f87161b193e1e`）

| 引用 | 位置 | 本文用途 |
| --- | --- | --- |
| `SubmissionOperationKind` 全枚举（含未接通的 `SEDIMENT` / `REVIEW_DISPATCH` / `BOOTSTRAP`） | `src/core/submission-operation.ts:2` | §2 F1/F9、§3、§6 Q3 |
| `isSubmissionOperationKind` 运行时守卫 | `src/core/submission-operation.ts:610` | §2 F1/F9、§5.6(c) |
| `SUBMISSION_AUTHORITY_KEY` per-thread 分槽 | `src/core/submission-operation.ts:92` | §2 F4、§5.2 |
| `foldAuthorityMap`（legacy flat 向前折叠） | `src/core/submission-operation.ts:600-606` | §2 F4 |
| `fingerprintSubmissionPayload`（空白折叠 + 截断 2000 + 32 位哈希） | `src/core/submission-operation.ts:648-653` | §3 约束 2 |
| `acceptedPayloadFingerprint`（对账依据） | `src/core/submission-operation.ts:20` | §5.2、§5.6(d) |
| `HumanGoRuntime.execute` guard 链 | `src/core/human-go-runtime.ts:64-118` | §2 F2、§5.2、§5.6(a) |
| **硬编码 `operationKind: "GO"`** | `src/core/human-go-runtime.ts:74` | §2 F1、§6 Q2 |
| `HumanGoResult` BLOCKED 原因枚举 | `src/core/human-go-runtime.ts:33-36` | §2 F2 |
| kind 特化 composer 成例（`DELIVER_CHILD_RESULT`，含 fail-closed 冲突立场） | `src/core/deliver-child-result.ts:5-7, 32-37, 40, 112` | §2 F2、§6 Q2 |
| `dispatchHumanGo` 定义 | `src/content/index.ts:1483` | §5.2 |
| `dispatchHumanGo` ACTIVE run 拒绝路径 | `src/content/index.ts:1488-1491` | §5.4、§6 Q13 |
| `dispatchHumanGo` READY 6 s 轮询 | `src/content/index.ts:1492-1499` | §4.1 |
| 页内输入 + submit（唯一合法 actuation） | `src/content/index.ts:1520-1529` | §5.2、§5.6(e) |
| 既有 crystal 动作（**不在本 Work Item 范围**） | `src/content/index.ts:1461-1481` | §3 边界声明 |
| `crystalCapturedWithWarnings`（宽容解析的承接分支） | `src/content/index.ts:2472` | §6 Q1 |
| 面板 `primary-actions` 区 | `src/content/index.ts:528-534` | §6 Q12 |
| 面板 auto-delivery 三选一（沉淀复用的落点） | `src/content/index.ts:540-546` | §5.1、§6 Q1 |
| 面板 `supporting-actions` 区 | `src/content/index.ts:554-559` | §6 Q12 |
| `waitForGeneratedHandoff` / `waitForGeneratedCrystal`（同状态机） | `src/content/index.ts:2334 / 2458-2472` | §2 F7、§6 Q10 |
| 等待常量（120 s / 1.5 s / 2.5 s / 1.2 s / 1.5 s） | `src/content/index.ts:195-199` | §2 F7 |
| `newestMarkerBegin` / `newestCrystalMarkerBegin`（去重 baseline） | `src/content/index.ts:2587 / 2591` | §6 Q10 |
| Hub 浏览分组（handoff / crystal / result） | `src/content/index.ts:729-731` | §2 F8、§6 Q1 末 |
| **`captureNoosCrystals`（宽容解析入口）** | `src/core/crystal-capture.ts:18` | §6 Q1 |
| **`validateCrystal` 产出 warnings 而非 errors** | `src/core/crystal-capture.ts:171-198` | §6 Q1（复用判据） |
| `deriveTitle` / `deriveSummary` / `deriveKey` frontmatter 缺失时的 fallback | `src/core/crystal-capture.ts:141 / 150 / 162` | §6 Q1（复用判据） |
| `normalizeCapturedCrystal`（外层围栏剥离） | `src/core/crystal-capture.ts:71-82` | §6 Q10（围栏约束） |
| Crystal prompt `createGenerateCrystalPrompt`（frontmatter + 4 章节） | `src/core/prompt-templates.ts:109` | §6 Q1 |
| Thread prompt `createGenerateThreadPrompt` | `src/core/prompt-templates.ts:9` | §6 Q10（同族 marker 通道） |
| 续跑 payload 注册表（#60 已实现，本提案的扩展基座） | `src/core/continuation-payload.ts:38-59` | §1、§3 |
| 续跑注册表头注释（kind 是内部契约，只有派发字面量随 locale 变） | `src/core/continuation-payload.ts:12-16` | §1 形态澄清、§3 |
| Crystal marker 常量 | `src/core/noos-crystal.ts:1-2` | §2 F6、§6 Q1/Q10 |
| Thread marker 常量 | `src/core/noos-thread.ts:1-2` | §2 F6 |
| `createCrystalPreferredPath` | `src/core/filename.ts:30` | §5.5 |
| Vault `object_type` 族（`handoff`） | `src/core/filename.ts:67` | §2 F8、§6 Q9 |
| `DownloadAdapter`（Markdown 专用） | `src/storage/DownloadAdapter.ts:8` | §2 F8、§6 Q9 |
| background `isPrepareInput` kind 白名单 | `src/background/service-worker.ts:777` | §2 F1/F9、§5.6(c) |
| Hub 本地端点（`127.0.0.1:17642`） | `src/background/service-worker.ts:114-122` | §2 F3 |
| `chrome.storage.local` 封装 | `src/background/service-worker.ts:125-126` | §2 F4、§5.3 |
| 既有 durable 键（token / reanchor / spawns） | `service-worker.ts:123`；`goal-reanchor-runtime.ts:4`；`spawn-runtime.ts:33` | §2 F4 |
| manifest `host_permissions`（**无 github.com**） | `public/manifest.json:22-41` | §2 F3、§6 Q6 |
| manifest `downloads` 权限 | `public/manifest.json:21` | §6 Q9 |
| `bcrRunActive` 文案类型 / 英文 / 中文 | `src/shared/i18n.ts:53 / 259 / 457` | §5.4、§6 Q13 |
| Hub fixture kind 联合（含 `SEDIMENT` / `REVIEW_DISPATCH`） | `apps/noos-hub/src/harness/types.ts:61-64` | §2 F1/F9、§5.6(c) |
| 实例侧 watcher 状态文件形状 | `/Volumes/Mac DS - Data/SharedProjects/noos-shuttle/.tmp/watcher-state.json`（**未纳入版本控制**） | §2 F5、§6 Q7 |
| **本 Work Item 主裁定**（15 条 required delta） | PR #87 评论 `5749808986`，裁定对象 head `f44bfb05` | §0.1、§6 全节 |

---

## 10. 本提案的自我评估（rev.1）

按「这份提案够不够复审」自检：

1. **Q3 已由裁定收口**，v0 的枢纽不确定性消除。本 rev 的最大新增面是 **Q8 验证门**——它是唯一一处裁定判 DEFER 的条目，也是本 rev 唯一**故意不给结论**的地方。请复审重点看：(a) 验证门要证的命题是否覆盖了裁定的三项要求（检索/排序语义、去重重放安全、不得单用 wall-clock）；(b) 本版新增的第三条约束（检索在 ChatGPT 侧、游标在扩展侧、须可观测回传）是否为真——它直接决定游标形状的可选空间。
2. **§6 Q1 的派生实现约束需被复核**：沉淀复用既有 crystal marker 族/捕获谓词/等待状态机，是「不新建第二套机制」与「沉淀是独立语义动作」之间的一处取舍。本版把取舍理由与**可观测后果**（沉淀产物呈 crystal 形状且带 warnings）都摊开写了，但这是**本版派生、非裁定指定**，请明确认可或否决。
3. **§6 Q10 的围栏约束同样属本版派生**（裁定未直接裁该项），已标注供否决。
4. **未伪造任何未取证结论**：Q8 的游标形状保持未定；本文不声称已实测 GitHub 检索语义。

若上述第 2/3 点被否决，替代方案必须避开两条已被 foreclose 的路（新 marker 族 / 第二套等待协议），请复审据此给出方向。

---

## 11. Issue #61 Acceptance 逐条映射（裁定 delta 15）

#61 正文 Acceptance 共 5 条，逐条映射到本提案的落点与承载切片：

| # | #61 Acceptance 原文 | 本提案如何满足 | 落点 | 承载切片 |
| --- | --- | --- | --- | --- |
| 1 | 面板可直接触发沉淀、速览与 PR 评论巡检，无需手打长指令 | 三个面板按钮 + 三条 canonical payload；续跑为第四个（#60 已实现） | §0、§3、§6 Q12 | 切片 2 / 4 / 6 |
| 2 | 每个动作在账本中可归属到**明确的 operation kind**（而非一律 `GO`），或明确不走账本并说明理由 | **三者全部走账本且各有真实 kind**：`SEDIMENT` / `OVERVIEW_HTML` / `PR_COMMENT_SWEEP`；无一个标注为 `GO` | §0、§3 operation-kind 表、§6 Q3、§2 F9 | 切片 2 / 3 |
| 3 | BCR run 期间的行为**已裁定且一致** | 非 run 快捷动作在 ACTIVE 期间经既有 `bcrRunActive` 拒绝；文案保持通用；**不**消耗 #63 预留 | §5.4、§6 Q13 | 切片 6 |
| 4 | 产物落点确定且可被后续检索；PR 评论巡检有 durable 水位且不重复处理 | 沉淀 = 复用 auto-delivery 三选一；速览 = Downloads 单文件；水位 = `chrome.storage.local` per-`prRef` 槽、**与 `.tmp/watcher-state.json` 隔离**、「不重复处理」以 Q8 验证门 + 单写者串行推进为实现前提 | §5.1、§5.3、§5.5、§6 Q1/Q7/**Q8** | 切片 2 / 4 / 5 |
| 5 | 中英文文案同步 | 按钮文案落 `src/shared/i18n.ts` 的 `COPY`，照 `bcrRunActive` 既有模式中英同步；payload 与 `COPY` 严格分离 | §3 约束 3/4、§6 Q12 | 切片 6 |

**Acceptance 第二条是本 rev 的中心改动**：#61 原文允许「或明确不走账本并说明理由」这一退路，而 v0 曾实质走在该退路附近（速览标 `REVIEW_DISPATCH`、查评论标 `GO`）。裁定 delta 3 否决该形态，本版改为**三者全部有真实 kind**，不再使用退路。

**Acceptance 第四条与 Q8 的耦合是本 rev 需复审关注的一点**：「PR 评论巡检有 durable 水位且**不重复处理**」在游标形状未定前**无法声称已满足**。本版的处理方式是：把 Q8 验证门列为**切片 5 的开工前置**（§7），而非在文档里给出一个未经证实的游标形状。即：**本条在本 rev 的状态是「已裁定方向、待验证门产出后满足」**，不谎称已完成。

---

<!-- 本文件为 proposals 性质；不含运行时代码。rev.1 已按 PR #87 主裁定（评论 5749808986）逐条处置；请勿据此实施，待独立复审与该 head 的裁定。 -->
