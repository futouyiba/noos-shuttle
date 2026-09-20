# Shuttle 快捷动作（沉淀 / 速览 HTML / 查 PR 评论）— 设计提案 v0

Issue: futouyiba/noos-shuttle#61
Branch: `docs/shortcut-actions-proposal`
撰写时 HEAD: `6731a60e7d468e040c86e7e28a5f87161b193e1e`
（本文所有 `file:line` 均绑定该 revision；`git show <rev>:<path>` 可逐条复核。）
状态: **待裁定（proposals 性质，非实现）**。本文不含任何产品代码改动。

上游已裁定文书：

| 文书 | 结论 | 与本提案的关系 |
| --- | --- | --- |
| Issue **#60** Primary Design Disposition | `PARTIAL_ACCEPT` | 提供 payload 注册表与**唯一定位规则**；本提案的 payload 必须落进该注册表，不得另立第二套 |
| Issue **#63** Primary Design Disposition | `PARTIAL_ACCEPT`（10 条 required delta） | delta 9 **明言 v0 不统一 Go × N / 快捷动作 / Outbox 三类 producer**；本提案的边界由此确定 |
| #56 disposition Q1–Q6（转录入 `bcr-multitab-observation-defect-proposal-v0.md` §8） | — | 提供 per-logical-thread authority、provenance 归因、lease/fence 守卫的已裁语义 |
| #54 disposition（`chatgpt-provider-recovery-go-n-proposal-v0.md` §4） | — | Evidence Gate 原文；本提案的「何时算接受」沿用，不重开 |

---

## 0. 结论摘要

本提案主张：**#61 不是一条新的投递通道，而是既有 `dispatchHumanGo` → `HumanGoRuntime` → `SubmissionOperation` 路径上的三个新 payload 生产者**。三条动作全部复用同一套 lease / fence / READY / exactly-once；差异只在 payload 内容、产物落点与账本 kind 标注。

三条主结论，供 designer 直接裁：

- **主张 1（沉淀）**：`SEDIMENT` 应当接通。当前它是死枚举（§2 F1），「沉淀」一律记为 `GO`，导致账本与 Hub 投影无法区分沉淀与普通续跑——这正是 #61 Acceptance 第一条要解决的事。
- **主张 2（速览 HTML）**：产物走 **Thread/Crystal 同族的 marker 包裹通道** + 新增捕获谓词，落点 v0 只做 Downloads；不新增 operation kind。
- **主张 3（查 PR 评论）**：按 Human decision 2026-09-18（#61 正文）走 ChatGPT 注入，**水位落在扩展侧 `chrome.storage.local`**，**v0 只巡检单条 PR**，**绝不与实例侧 watcher 水位（`.tmp/watcher-state.json`）共享**。

以及一条**请求裁定**的边界问题：

- **主张 4（AC_RUN 期间的行为）**：非续跑快捷动作在 BCR run `ACTIVE` 期间**应当被拒绝**，沿用既有 `bcrRunActive` 拒绝路径（`src/content/index.ts:1488`），**不**接入 #63 的 provenance-bound expected-turn 预留机制。理由见 §5.4。

---

## 1. Scope 与与 #60 / #63 的边界

**本提案的语义对象**：三个（含续跑共四个）**用户手动触发、立即执行**的 Shuttle 面板动作——其 payload 归属、账本 kind 标注、产物落点、水位存储、以及它们在 BCR run 生命周期中的门控。

**明确不在本提案内（不重开）**：

| 不重开 | 依据 |
| --- | --- |
| 续跑 token 的取值与语言选择（`继续` / `go on`，跟随 UI locale） | #60 已裁定 |
| payload 注册表的形态（唯一 canonical 定义站点、与 i18n `COPY` 分开） | #60 Required delta 1 |
| #63 的 outbox 全部语义（`OUTBOX_MESSAGE`、queue store、provenance-bound 预留、UNCERTAIN 队首阻塞） | #63 已裁定 10 条 delta |
| #54 Evidence Gate 内容、RecoveryBudget、provider-native Retry、context rebase | #54 已裁定；#56/#63 亦明写不得重开 |
| 既有 `RuntimeObservationLedger` 的 READY/STABILIZING 判据与 2 s quiet 窗口 | #63 正文已认定「硬骨头已经啃完」，本提案不改 |

**与 #60 的接缝**：本提案的 payload 一律经由 #60 建立的注册表站点（`src/core/continuation-payload.ts`，当前 112 行）扩展，**不新建第二个注册表**。见 §3。

**与 #63 的接缝**：本提案是**独立 producer**，不是 `OUTBOX_MESSAGE` 的特化。理由是「投递时机由谁决定」不同——见 §4.1。

---

## 2. 现状证据表

### F1 `SEDIMENT` 是已声明但从未 dispatch 的死枚举

仓内 `SEDIMENT` 的全部出现（`grep -rn SEDIMENT src apps/noos-hub/src apps/llm-wiki/src`）：

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

仓内**已存在** kind 特化 transport composer 的成例：`src/core/deliver-child-result.ts` 自建 `SubmissionOperation(kind=DELIVER_CHILD_RESULT)`（`:112`），并用确定性 operationId（`:35`）保持 create-or-get 幂等；其文件头注释（`:5-7`）明写「canonical transport lifecycle lives entirely on the SubmissionOperation ledger」。**即：kind 特化不需要新账本，只需要新 composer。** 本提案的主张 1 与主张 3 都据此。

### F3 扩展侧目前没有 GitHub 可达性

`public/manifest.json:22-41` 的 `host_permissions` 为 ChatGPT 族 + 飞书族 + `http://127.0.0.1/*` + `http://localhost/*`——**不含 `github.com`**。扩展对外的唯一非 provider 通道是本地 Hub（`src/background/service-worker.ts:114-122`，一律 `http://127.0.0.1:17642/...`）。

**推论（`INFER`）**：任何「扩展自行解析关联 PR」的方案都必须新增 GitHub host permission 或新增 Hub 端点，二者都是新授权面。见 §6 Q6 与 §8。

### F4 扩展侧已有成熟的 durable 存储与 background coordinator

`chrome.storage.local` 已是多个 feature 的持久层（`service-worker.ts:125-126` 的 `{get,set}` 封装）：

| 键 | 位置 |
| --- | --- |
| `noosHubShuttleToken` | `service-worker.ts:123` |
| `noosGoalReanchors` | `background/goal-reanchor-runtime.ts:4` |
| `noosPendingSpawns` | `background/spawn-runtime.ts:33` |
| `noosSubmissionAuthority`（per-logical-thread map） | `submission-operation.ts:92` |

`noosSubmissionAuthority` 的 per-thread 分槽即 #56 disposition Q1 / required delta 2 已裁定的形态（`foldAuthorityMap`，`submission-operation.ts:591-600`，仅对 legacy flat 记录做向前折叠）。

### F5 实例侧 watcher 水位是全局单值，且不在本仓

`noos-watch` 的状态文件在**主 checkout** 的 `.tmp/watcher-state.json`（未纳入版本控制；本 worktree 中不存在）。其形状为：

```json
{ "watermark": "2026-09-20T11:27:48Z", "pending": [ ... ] }
```

单个全局 `watermark`，`pending` 数组逐条记录 CLAIMED / ROUTED 与 `lastRecheckedAt`。**它不是 per-PR 水位**，语义也不同（它服务的是「把我的评论投递给哪个会话」，不是「某 PR 自上次以来有什么新评论」）。见 §6 Q7。

### F6 速览 HTML 全无实现（`CODE`）

`grep -rn` 无任何 HTML 产物相关的 prompt 模板、action、marker 常量或落点。现有 marker 常量只有两组：`NOOS_THREAD:BEGIN/END`（`src/core/noos-thread.ts:1-2`）与 `NOOS_CRYSTAL:BEGIN/END`（`src/core/noos-crystal.ts:1-2`）。

### F7 等待/捕获路径已参数化，可零成本复用

`waitForGeneratedHandoff`（`src/content/index.ts:2334`）与 `waitForGeneratedCrystal`（`:2458`）是**同一状态机**，差异只在捕获谓词（`captureNoosThreads` vs `captureNoosCrystals`）与文案。共享常量：`WAIT_FOR_HANDOFF_TIMEOUT_MS = 120_000`（`:195`）、`GENERATION_START_GRACE_MS = 1_500`（`:196`）、`GENERATION_QUIET_MS = 2_500`（`:197`）、`CAPTURE_RETRY_MS = 1_200`（`:198`）、`CAPTURE_POLL_MS = 1_500`（`:199`）。

**推论（`CODE`→`INFER`）**：新增「速览 HTML」的等待路径是**同一状态机的第三个实例**，不是新机制。这是 #61 正文 §B 待决项 5 的直接答案。

### F8 现有落点适配器是 Markdown 专用

`src/storage/DownloadAdapter.ts:8` 是 `StorageAdapter` 的实现，其 `saveThread` 硬编码 `type: "text/markdown;charset=utf-8"` 与 `thread.rawMarkdown`，并用页内 `<a download>` 触发（未使用 manifest 已声明的 `downloads` 权限）。Vault 侧 `object_type` 现有族为 `handoff` / `crystal` / `result`（`src/core/filename.ts:67`；`src/content/index.ts:729-732` 的 Hub 浏览分组）。

**推论（`CODE`）**：HTML 产物**不能**直接复用 `DownloadAdapter.saveThread()` 的类型签名。见 §6 Q9。

---

## 3. Payload 与定位（对齐 #60 唯一定位规则）

#60 裁定的唯一定位规则原文要求：「canonical uniqueness should be the **payload definition/registry symbol plus exact repository path**」，且「One canonical payload registry/definition site must make each provider-facing payload mechanically discoverable and consumers must reference it rather than duplicating production literals」。

本提案据此提出注册表扩展形态（**示意，非实现**）：

```ts
// src/core/continuation-payload.ts —— 同一个站点，不新建第二个注册表
export type ShortcutActionId = "SEDIMENT" | "OVERVIEW_HTML" | "PR_COMMENT_SWEEP";

export interface ShortcutPayloadDefinition {
  readonly actionId: ShortcutActionId;
  /** 与 payload 一并落账的动作类型标注，供 provenance 使用。 */
  readonly workItemId: string;
  readonly build: (context: ShortcutPayloadContext) => string;
}
```

关键约束（**请 designer 确认是否接受**）：

1. **注册符号唯一性覆盖模板，不覆盖展开后的字符串。** PR 评论巡检 payload 内插 `since` 水位与 PR ref，每次点击的字节都不同；要求「整串字面量全仓唯一」在此不可满足也无意义。
2. **展开后的字节仍必须是对账依据。** 既有对账语义匹配 dispatched bytes（#60 delta 4 明写「Fingerprinting and acceptance matching must use the exact dispatched payload bytes as today」）。实现细节见 `fingerprintSubmissionPayload`（`src/core/submission-operation.ts:648-653`）：它**先把空白折叠为单空格、trim，再截断到前 2000 字符**，然后做 32 位滚动哈希。两点后果：

   - **含水位的 payload 只对账「这一次尝试的字节」**，故它**不可被幂等重试复用**——任何重试必须是新的 operationId + 新 payload。此项**不**与 #54「unknown 不盲重发」冲突，反而是它的实现形态。
   - **截断是有界的**：若某条 payload 的前 2000 个规范化字符完全相同而后段不同（例如把水位/PR ref 放在长段落之后），两条不同 payload 会得到相同指纹。**故实现时水位与 PR ref 必须置于 payload 前部**——这不是本提案要裁的语义，但必须写进实现约束（否则会得到一个静默的 `OBSERVED_ACCEPTED` 误配）。
3. **不得并入 i18n `COPY` 表。** 同 #60 delta 1；`src/shared/i18n.ts` 的 `COPY` 是给人读的面板文案，payload 是给模型读的契约。
4. **面板按钮文案走 `COPY`。** 与 payload 注册表分离：按钮文案是 UI 文案，中英同步（#61 共同要求），落 `src/shared/i18n.ts`，形如 `bcrRunActive`（`i18n.ts:53` 类型 / `:259` 英文 / `:457` 中文）的既有模式。

**是否新增 payload 字面量、是否新增 operation kind**：

| 动作 | 需要新 payload 字面量 | 需要新 operation kind |
| --- | --- | --- |
| 沉淀 | 是（若走比 Crystal 更轻的通道，见 Q1） | **不需要新枚举**——`SEDIMENT` 已在册，只是未接通 |
| 速览 HTML | 是（全新） | **不需要**——可复用死枚举 `REVIEW_DISPATCH`，或标注为 `GO` |
| 查 PR 评论 | 是（全新，含水位插值） | 待裁（Q3）。倾向：**不需要新枚举** |
| 续跑 | 否（#60 已完成） | 不需要 |

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
| Run ACTIVE 期间 | 有优先级规则（#63 delta 4） | **直接拒绝**（本提案主张 4） |
| 与 Run 的关系 | provenance-bound expected-turn 预留 + 对账（#63 delta 3） | 无预留——故只能拒绝 |

**结论**：快捷动作**没有「时机」这个问题域**，它只有「当场能不能拿到合法 lease」这个问题——而那个问题 `dispatchHumanGo` 已经用 6 s READY 轮询 + `HumanGoRuntime` 的 6 道 guard 回答了（`src/content/index.ts:1492-1499`，`src/core/human-go-runtime.ts:66-71`）。**故本提案是独立能力，不是 #63 的 producer。**

**未来统一的可能性（仅记录，非前提）**：#63 delta 9 允许「later share a payload registry or scheduling substrate」。二者真正重合的边界点只有一处——`SubmissionOperation` actuation 边界。若未来要把快捷动作改成「可排队」，那等于把它变成 outbox 的 producer，届时需要的是**新增 provenance-bound 归因**（使该 turn 不被 Run 读成 `USER_INTERVENTION`），那是 #63 delta 3 的能力，不在本提案内。

### 4.2 三个动作的投递形态

| 动作 | 触发 | 投递 | 是否等待产物 |
| --- | --- | --- | --- |
| 沉淀 | 面板按钮 | `dispatchHumanGo`，当场 | 等待（沿用 marker 捕获） |
| 速览 HTML | 面板按钮 | `dispatchHumanGo`，当场 | 等待（新增捕获谓词） |
| 查 PR 评论 | 面板按钮 | `dispatchHumanGo`，当场 | **不等待产物**——注入的指令要求 ChatGPT **在对话里回答**，不产出可捕获的 marker 文档 |

> 「查 PR 评论」不等待，是它与其他两个的结构性差异：它的输出是**给人读的对话回复**，不是待落盘的产物。故它**不占用** `activeWait` 状态机，也就不会与「沉淀 / 速览」的等待互斥（三者共用同一个 `activeWait` 单槽，任意两个同时触发会互相 `cancelActiveWait`）。

---

## 5. Authority / 证据门

### 5.1 三类动作的分类

| 动作 | 向页面输入 | 向 provider 发送 | 写本地 | 分类 |
| --- | --- | --- | --- | --- |
| 沉淀 | 是（composer + submit） | 是 | 是（Vault / Downloads，取决于 Q5） | **actuation** |
| 速览 HTML | 是 | 是 | 是（Downloads，v0） | **actuation** |
| 查 PR 评论 | 是 | 是 | 是（水位，`chrome.storage.local`） | **actuation** |
| 续跑 | 是 | 是 | 否 | **actuation**（已裁定） |

**三者全部是 actuation**，没有「只是读」的动作。这一点必须在提案里写明，因为它排除了一条看似省事的路径：把「查 PR 评论」实现成扩展直接 `fetch` GitHub——那不但需要新增 host permission（F3），还会绕过账本直接改变状态，属 #61 共同要求第一条明禁的形态。

### 5.2 走哪条既有路径

**唯一合法路径**（#61 共同要求第一条；BCR 报告 §3 已确立）：

```
面板按钮
  → dispatchHumanGo(payload, getPageContext(), workItemId, options)   src/content/index.ts:1483
    → HumanGoRuntime.execute()                                        src/core/human-go-runtime.ts:64
      → SubmissionOperationLedger.prepare / claim                     src/core/submission-operation.ts
        → 页内 composer 输入 + submit（不 querySelector 直接提交）
```

**lease / authority 依据（均为已裁，不重开）**：

| 约束 | 出处 |
| --- | --- |
| 只有 canonical lease holder 可 actuate；carrier/tab 身份是证据而非授权键 | #56 disposition Q2 / required delta 1 |
| authority 按 logical execution identity 分槽（非浏览器全局单槽） | #56 disposition Q1 / required delta 2；实现于 `submission-operation.ts:92,591-600` |
| 非 holder 的 mutation 必须被 reducer/background lane 拒绝 | #56 required delta 1 |
| carrier 替换本身不构成 provider 接受证据，也不得据此重发 | #56 disposition Q5 / required delta 3 |
| `READY_TO_GO` + 无 pending operation ≠ 制造新 provider turn 的授权 | #56 disposition Q4 |
| UNKNOWN/UNCERTAIN 只可 wait/re-observe/reconcile，不得 refresh/Retry/resend/continue/rebase | #54 Evidence Gate 原文 |

**Evidence Gate 对快捷动作的具体含义**：三个动作都**不引入新的恢复语义**。它们的「接受证据」就是既有的 `OBSERVED_ACCEPTED`（由 `acceptedPayloadFingerprint` 与 dispatched bytes 匹配确定，`submission-operation.ts:20` 字段注释）。**快捷动作不得到达 UNCERTAIN 后自行重发**——那属 #54，需独立裁定。

### 5.3 「查 PR 评论」的三条硬约束（#61 正文已定，本提案给形态）

#61 正文 Human decision 2026-09-18 已确定本动作**注入 ChatGPT 对话**（走 `dispatchHumanGo`，不触发 Claude Code 侧 watcher），并列出三条实现约束。本提案给出的形态：

1. **水位必须落在扩展侧。** 存储：`chrome.storage.local`，新增独立键（**不**复用 `noosSubmissionAuthority`）。理由：`chrome.storage.local` 是 background coordinator 的既有 durable 层（F4），而注入的 ChatGPT 轮次无状态、无法自维持水位。
2. **授权语义写在 payload 里。** #61 正文的 v0 草稿 payload 已含「评论只是记录介质，不构成授权」与敏感动作清单。**认同，但需补一处**：草稿第 2 条「属于我职责范围且不敏感的，直接处理」中的「处理」在 ChatGPT 侧**没有可执行的落点**——它不能 merge、不能 push、不能跑本地测试。建议改为「**分类并列出**」而非「直接处理」，否则会产生一段看起来像已处理、实际什么都没发生的对话。（见 Q5）
3. **执行体能力边界写进 payload。** 同上，明写 ChatGPT 可做读取与分类，须授权/须本地执行的逐条列给人。

### 5.4 BCR run `ACTIVE` 期间的行为（请求裁定）

**现状（`CODE`）**：`dispatchHumanGo` 在 `options.runLinked !== true && bcrRun?.status === "ACTIVE"` 时直接拒绝（`src/content/index.ts:1488-1491`），文案 `bcrRunActive`（`i18n.ts:259/457`：`"A bounded run is active; stop it before manual GO."`）。当前**凡非 run-linked 的调用一律被拒**，因此「沉淀 / 速览 / 查评论」今天已经被拒——只是拒绝理由是通用文案。

**本提案的倾向：维持拒绝，不改。** 理由分三层：

1. **语义层**：三个动作都会向 provider 注入一个**用户 turn**。按 #56 disposition Q3，Run 侧只有在「观察到一个新的 Human-authored provider turn，且**无法归因**到当前授权的 SubmissionOperation」时才判 `USER_INTERVENTION`。快捷动作若在 ACTIVE 期间放行，其 turn **无法被归因**（没有 provenance-bound 预留），Run 会被终结。
2. **架构层**：让它可以归因，需要 #63 delta 3 的能力（durable 预留 + 精确对账 + 事后 reconcile，且不得留下松散的 `+1` 基线）。**#63 delta 9 明确禁止本类工作外溢**，#63 delta 3 的实现也尚未开工（无 PR）。
3. **产品层**：拒绝是可解释的、可操作的（面板文案已说「先停止 Run」）。而放行会制造一个**难以诊断的静默失败**——正是 #56 报告记录的失效模式。

**需 designer 裁的是**：拒绝文案是否应当从通用 `bcrRunActive` 改成动作专属文案（例如「有界 Run 进行中，快捷动作暂不可用」），或保持一行通用文案。**本提案倾向保持通用文案**——动作专属文案会让用户以为「终将可用」，而实际在 v0 内不会放开。

### 5.5 provenance / 可追踪性

#61 共同要求末条要求「每个快捷动作的产物或触发需有可追踪 provenance（对话 ref、动作类型、时间、产物路径或水位）」。既有账本**已经**给出前三项：`SubmissionOperation.providerConversationRef`（对话 ref）、`workItemId`（动作类型，字符串区分）、`createdAt`（时间）。缺的是**第四项**：

| 动作 | 第四项 provenance | 形态建议 |
| --- | --- | --- |
| 沉淀 | 产物路径（crystal key / preferred_path） | 由既有 Crystal 落点提供；`createCrystalPreferredPath`（`src/core/filename.ts:30`） |
| 速览 HTML | 产物路径 | payload 内**要求模型在产物里内嵌**一行机器可读来源（对话 ref + 动作 id + 时间），由捕获侧读取；**不新建账本投影** |
| 查 PR 评论 | 水位 | 水位记录本身携带 `prRef` / `since` / `until` / `at` |

**本提案倾向：不新建 projection store。** 三个动作的 provenance 都内嵌在既有账本字段 + 产物自身，避免出现第二个真相源（#56 boundary 已明禁「second canonical carrier-binding/lease ledger」，同理）。此项**请 designer 确认**（Q10）。

---

## 6. 待 Epic Designer 裁定的问题（不自行裁定）

### Q1 — 沉淀：复用 Crystal 通道，还是另立更轻的 SEDIMENT 通道？

**背景**：`createGenerateCrystalPrompt()`（`src/core/prompt-templates.ts:109`）要求完整 YAML frontmatter（10 个字段）+ 4 个固定章节。对「先把当前结论存下来」这一诉求偏重。

**倾向：接通 `SEDIMENT`，定义一条比 Crystal 轻的通道；**`SEDIMENT` 与 Crystal **并存但语义分工明确**——SEDIMENT 是「本轮结论的最小 durable 记录」，Crystal 是「可被其他 agent 按 key 检索的结构化结晶」。**理由**：(a) `SEDIMENT` 已在三处白名单内（F1），接通成本仅是一处 composer + 一处校验；(b) #61 Acceptance 明写「每个动作在账本中可归属到明确的 operation kind（而非一律 `GO`）」，若不接通则该项不满足；(c) 明确分工可避免两条路径语义重叠（#61 正文 §A 待决项 2 的顾虑）。

**需裁**：是否接受「SEDIMENT 轻通道 + Crystal 保留」的双轨，还是要求 SEDIMENT 直接复用 Crystal 的 frontmatter 契约（只改 kind 不改形态）？

### Q2 — 沉淀的接通方式：扩展 `HumanGoRuntime`，还是另立 composer？

**背景**：`HumanGoRuntime` 硬编码 `operationKind: "GO"`（F1/F2）。两条路：

- **A**：给 `HumanGoRequest` 加 `operationKind` 字段，由调用方传入。
- **B**：照 `deliver-child-result.ts` 成例，另立 `sediment-dispatch.ts` composer，自建 operation（kind=`SEDIMENT`、确定性 operationId），仅在 actuation 那一步复用相同的 composer 调用方式。

**倾向：B。** 理由：`HumanGoRuntime` 的名字与 guard 链（`explicitGo` 必须为 true）都是 **GO 续跑**专用的；让沉淀从它的 `explicitGo` 门穿过，等于把「沉淀」表达成一种 GO——这正是要消除的混淆。B 同时保留了 A 的可复用性（composer 内仍调 `insertIntoChatInput` + `submitChatInput`）。

**需裁**：确认 B，或裁定 A 可接受。

### Q3 — 速览 HTML 与查 PR 评论是否需要一个新 operation kind？

**背景**：死枚举里还剩 `REVIEW_DISPATCH` 与 `BOOTSTRAP` 未被使用。

**倾向**：**速览 HTML 复用 `REVIEW_DISPATCH`**——它的语义是「派发一个产物生成轮」，与 review dispatch 同族；或者若 designer 认为 `REVIEW_DISPATCH` 已被语义占用，则新增 `OVERVIEW_HTML`。**查 PR 评论**倾向**不新增 kind**：它的实质是「一个读+分类的 GO 轮」，标注为 `GO` 并在 `workItemId` 上区分，代价最小；但若 Acceptance 要求「明确归属」，则同样需要一个 kind。

**需裁**：三条动作各自的 kind 落点（新增 / 复用死枚举 / 标为 GO + workItemId 区分）。**这是本提案最需要 designer 收口的一项**，因为它直接决定 §3 表格与 #61 Acceptance 第二条是否满足。

### Q4 — 三个动作是否共享一个「快捷动作」payload 族，还是各占一个条目？

**倾向**：各占一个条目（`actionId` 判别），共享同一注册站点。理由：#60 的唯一定位规则是按「definition/registry symbol」定位，一个 `ShortcutActionId → definition` 的映射表同时满足唯一性与可机械发现性。

### Q5 — 「查 PR 评论」payload 中的「直接处理」是否必须改为「分类并列出」？

**倾向：必须改。** 见 §5.3 第 2 条。ChatGPT 在网页侧没有 merge / push / 跑测试的能力，保留「直接处理」会产生**看起来已完成、实际未发生**的对话记录——对下游人类是主动误导。

**需裁**：是否接受改写；若接受，改写后仍保留「不敏感者可自行整理」的余地（例如「可自行整理的：把待办归类、把结论摘出来」），还是完全收缩为只读枚举。

### Q6 — 关联 PR 的发现方式（v0 范围）

**背景**：F3——扩展无 GitHub 可达性。

**倾向：v0 由人显式提供 PR ref（面板输入框或 `` `owner/repo#N` `` 形式的文本），不做自动发现。** 理由：(a) 自动发现需要新增 host permission 或新 Hub 端点，两者都是新授权面，应在独立提案中裁定；(b) #61 Acceptance 只要求「PR 评论巡检有 durable 水位且不重复处理」，未要求自动发现；(c) 人显式给定 PR ref 顺便解决 #61 正文 §D 问题 1「『相关 PR』的归属未绑定」——归属由人确定，agent 不再猜。

**需裁**：确认 v0 为「人给定 PR ref」，并将「自动解析当前会话关联 PR」明确记为 non-goal / 后续提案。

### Q7 — 水位与实例侧 watcher 水位的关系

**背景**：F5——`.tmp/watcher-state.json` 是全局单值，服务的是「投递给哪个会话」，且不在本仓。

**倾向：完全不共享，且互不干扰。** 扩展侧水位按 `prRef` 为键存在 `chrome.storage.local`；实例侧 watcher 水位不动。二者服务不同问题，共享只会引入跨进程耦合与一个新的失效模式（#61 正文 §D 待决项 2 已提出此顾虑）。

**需裁**：确认「不共享」，并确认扩展侧水位是否需要防并发写（同一 PR 连点两次按钮）。

### Q8 — 水位基线取什么量：comment `createdAt`，还是 comment id 最大值？

**背景**：GitHub issue comment id 单调递增；`createdAt` 可被编辑 / 时区 / 排序扰动。

**倾向**：**`id` 高水位（取已见最大 comment id）+ 附 `updatedAt` 用于发现被编辑的旧评论**。理由：id 单调且稳定，`since` 语义不会因时区或编辑而漂移。**但这需要在实现时确认 GitHub API 的 `since` 参数语义**（`since` 是按 `updated_at` 过滤），若用 id 高水位则需自行在结果中比较——两者取舍请 designer 连同 Q7 一并裁定。

**本条标 `PENDING_VALIDATION`**：未在本文中实测 GitHub API 行为。

### Q9 — 速览 HTML 的产物落点与形态

子问题（#61 正文 §B 待决 1/3）：

- **单文件 HTML（内联 CSS/JS、无外部依赖）是否作为硬约束写进 payload？** 倾向：是。否则模型输出的 HTML 可能引用外部 CDN，离线不可用，且引入隐私/可达性问题。
- **是否内嵌来源 provenance 行？** 倾向：是（见 §5.5）。
- **落点 v0：仅 Downloads。** 理由：Vault 侧 `object_type` 现有族为 handoff/crystal/result（F8），新增 `overview` 类型会牵动 Hub 投影与浏览分组，超出本提案范围；而 Downloads 已有 `downloads` 权限（`manifest.json:21`）。
- **是否需要「样式/风格」参数？** 倾向：**v0 固定一种版式**（面向技术读者的深入浅出），不做参数。理由：参数化会引入第二维度的 payload 变体，而 #60 的注册表是以 locale 为唯一维度的。

**需裁**：确认以上四点，特别是「仅 Downloads」是否可接受，还是要一并做 Vault。

### Q10 — 速览 HTML 的 marker 与捕获机制

**倾向**：新增 `NOOS:HTML:BEGIN/END` marker 常量，**照 Thread/Crystal 同族通道**包裹（#61 正文 §B 待决 2 的两条路中选第一条）。理由：(a) 内容脚本已有一套可靠的 marker 捕获与「只取最新、且晚于 baseline」的去重逻辑（`newestMarkerBegin` / `newestCrystalMarkerBegin`，`src/content/index.ts:2587/2591`）；(b) 等待状态机可直接复用（F7），只是换捕获谓词；(c) 另设捕获机制会引入第二套识别与去重语义，与 #61「不得绕过既有路径」的精神不符。

**需裁**：确认 marker 族；并确认「速览 HTML 不得使用三反引号围栏」这一约束是否照 Crystal 的写法继续施加（`prompt-templates.ts` 中 Crystal 模板有该约束）——HTML 产物本身会含代码，是否要放宽。

### Q11 — 产物落点与账本的真相源关系

见 §5.5。**倾向**：不新建 projection store；产物路径由产物自身与既有账本字段承载。

**需裁**：确认「不新建投影」；若 designer 认为 #61 Acceptance 的「产物落点确定且可被后续检索」需要一条可枚举的索引，则请指出该索引应当落在扩展侧还是 Hub 侧。

### Q12 — 面板快捷动作区的位置与「续跑」的落位

**背景**：#61 正文 §C 明写续跑「本 issue 只负责它在快捷动作区的位置与交互」，措辞与语言已由 #60 裁定并实现（PR #83，合并进 main `1ee215a`）。

**倾向**：续跑快捷动作落在**现有 `primary-actions` 区**（`src/content/index.ts:528-534`），与 `generate-capture` / `generate-crystal` 同级；沉淀、速览、查评论归入 `supporting-actions`（`:554-559`）。理由：续跑是 Run 的常规推进（主操作），另三个是旁路动作。

**需裁**：确认分区；并确认「快捷动作区」是否需要独立的视觉分组（若需要，那是实现局部，不在本提案裁定范围）。

### Q13 — BCR run ACTIVE 期间的拒绝文案

见 §5.4。**倾向**：维持通用 `bcrRunActive` 文案。

---

## 7. 建议切片（供 designer 收口时调整）

| # | 切片 | 依赖 | 是否含未裁定语义 |
| --- | --- | --- | --- |
| 1 | payload 注册表扩展（`ShortcutActionId` + 三条 definition 站点） | #60 已完成 | 依赖 Q4 |
| 2 | 沉淀接通（`SEDIMENT` composer + 面板入口） | — | 依赖 Q1 / Q2 |
| 3 | 速览 HTML（prompt 模板 + marker 捕获谓词 + Downloads 落点） | 切片 1 | 依赖 Q3 / Q9 / Q10 |
| 4 | 查 PR 评论（水位存储 + payload 定稿 + kind 标注） | 切片 1 | 依赖 Q3 / Q5 / Q6 / Q7 / Q8 |
| 5 | 快捷动作区布局与 i18n 收口（含续跑落位） | — | 依赖 Q12 / Q13 |

> 切片 2 与切片 5 无未裁定依赖，**可在裁定后立即开工**。切片 3/4 各有一组 §6 问题待裁。

---

## 8. 边界 / non-goals

- **不**实现 #63 的 outbox（`OUTBOX_MESSAGE`、queue store、scheduler、provenance-bound expected-turn 预留、UNCERTAIN 队首阻塞）。
- **不**把任何快捷动作编码为 `OUTBOX_MESSAGE`（#63 delta 1 明禁）。
- **不**统一 Go × N / 快捷动作 / Outbox 三类 producer（#63 delta 9）。
- **不**重构 `HumanGoRuntime` 的 GO 语义、`RuntimeObservationLedger`、`continuation-evaluator` 或 Go × N 预算。
- **不**重开 #54 Evidence Gate / RecoveryBudget / provider-native Retry / context rebase / Automation Boundary。
- **不**新建第二套 marker 捕获机制、第二套等待状态机、第二个 payload 注册表、第二个 authority/lease 账本。
- **不**为快捷动作新增任何 GitHub host permission 或 Hub 端点（自动 PR 发现见 Q6，明确记为 non-goal）。
- **不**与实例侧 watcher（`noos-watch` / `.tmp/watcher-state.json`）共享水位或状态。
- **不**授权在 UNCERTAIN 状态下自行重发（#54 语义不变）。
- **不**改 i18n 以外任何 UI 文案契约；不新增语言推断或逐动作语言选择器（#60 boundary 原文）。
- **不**为速览 HTML 新增 Vault `object_type`（v0）。
- 本文**不含运行时代码**；不修改任何产品文件；不关 #61；不 merge、不部署。

---

## 9. 证据索引（行号绑定 `6731a60e7d468e040c86e7e28a5f87161b193e1e`）

| 引用 | 位置 | 本文用途 |
| --- | --- | --- |
| `SubmissionOperationKind` 全枚举（含未接通的 `SEDIMENT` / `REVIEW_DISPATCH` / `BOOTSTRAP`） | `src/core/submission-operation.ts:2` | §2 F1、§6 Q3 |
| `SUBMISSION_AUTHORITY_KEY` per-thread 分槽 | `src/core/submission-operation.ts:92` | §2 F4、§5.2 |
| `foldAuthorityMap`（legacy flat 向前折叠） | `src/core/submission-operation.ts:591-600` | §2 F4 |
| `isSubmissionOperationKind` 校验器 | `src/core/submission-operation.ts:610` | §2 F1 |
| `fingerprintSubmissionPayload`（空白折叠 + 截断 2000 + 32 位哈希） | `src/core/submission-operation.ts:648-653` | §3 约束 2 |
| `HumanGoRuntime.execute` guard 链 | `src/core/human-go-runtime.ts:64-118` | §2 F2、§5.2 |
| **硬编码 `operationKind: "GO"`** | `src/core/human-go-runtime.ts:74` | §2 F1、§6 Q2 |
| `HumanGoResult` BLOCKED 原因枚举 | `src/core/human-go-runtime.ts:33-36` | §2 F2 |
| kind 特化 composer 成例（`DELIVER_CHILD_RESULT`） | `src/core/deliver-child-result.ts:1-12, 35, 112` | §2 F2、§6 Q2 |
| `dispatchHumanGo` 定义 | `src/content/index.ts:1483` | §5.2 |
| `dispatchHumanGo` ACTIVE run 拒绝路径 | `src/content/index.ts:1488-1491` | §5.4、§6 Q13 |
| `dispatchHumanGo` READY 6 s 轮询 | `src/content/index.ts:1492-1499` | §4.1 |
| 页内输入 + submit（唯一合法 actuation） | `src/content/index.ts:1520-1529` | §5.2 |
| 沉淀当前实现（`generate-crystal` 动作） | `src/content/index.ts:1379-1382, 1461-1481` | §2 F1 |
| 面板 `primary-actions` 区 | `src/content/index.ts:528-534` | §6 Q12 |
| 面板 `supporting-actions` 区 | `src/content/index.ts:554-559` | §6 Q12 |
| `waitForGeneratedHandoff` / `waitForGeneratedCrystal`（同状态机） | `src/content/index.ts:2334 / 2458` | §2 F7、§6 Q10 |
| 等待常量（120 s / 1.5 s / 2.5 s / 1.2 s / 1.5 s） | `src/content/index.ts:195-199` | §2 F7 |
| `newestMarkerBegin` / `newestCrystalMarkerBegin`（去重 baseline） | `src/content/index.ts:2587 / 2591` | §6 Q10 |
| Crystal prompt `createGenerateCrystalPrompt`（frontmatter + 4 章节） | `src/core/prompt-templates.ts:109` | §6 Q1 |
| Thread prompt `createGenerateThreadPrompt` | `src/core/prompt-templates.ts:9` | §6 Q10（同族 marker 通道） |
| 续跑 payload 注册表（#60 已实现，本提案的扩展基座） | `src/core/continuation-payload.ts:38-59` | §1、§3 |
| Crystal marker 常量 | `src/core/noos-crystal.ts:1-2` | §2 F6、§6 Q10 |
| Thread marker 常量 | `src/core/noos-thread.ts:1-2` | §2 F6 |
| `captureNoosCrystals` | `src/core/crystal-capture.ts:18` | §2 F7 |
| `createCrystalPreferredPath` | `src/core/filename.ts:30` | §5.5 |
| Vault `object_type` 族（`handoff`） | `src/core/filename.ts:67` | §2 F8、§6 Q9 |
| Hub 浏览分组（handoff / crystal / result） | `src/content/index.ts:729-732` | §2 F8、§6 Q9 |
| `DownloadAdapter`（Markdown 专用） | `src/storage/DownloadAdapter.ts:8` | §2 F8、§6 Q9 |
| background `isPrepareInput` kind 白名单 | `src/background/service-worker.ts:777` | §2 F1 |
| Hub 本地端点（`127.0.0.1:17642`） | `src/background/service-worker.ts:114-122` | §2 F3 |
| `chrome.storage.local` 封装 | `src/background/service-worker.ts:125-126` | §2 F4、§5.3 |
| 既有 durable 键（token / reanchor / spawns） | `service-worker.ts:123`；`goal-reanchor-runtime.ts:4`；`spawn-runtime.ts:33` | §2 F4 |
| manifest `host_permissions`（**无 github.com**） | `public/manifest.json:22-41` | §2 F3、§6 Q6 |
| manifest `downloads` 权限 | `public/manifest.json:21` | §6 Q9 |
| `bcrRunActive` 文案类型 / 英文 / 中文 | `src/shared/i18n.ts:53 / 259 / 457` | §5.4、§6 Q13 |
| Hub fixture `SEDIMENT` | `apps/noos-hub/src/harness/types.ts:63` | §2 F1 |
| 实例侧 watcher 状态文件形状 | `/Volumes/Mac DS - Data/SharedProjects/noos-shuttle/.tmp/watcher-state.json`（**未纳入版本控制**） | §2 F5、§6 Q7 |

---

## 10. 请 designer 关注的收口点（本提案的自我评估）

按「这份提案够不够裁定」自检，最弱的三个位置：

1. **Q3 是本提案的枢纽**。三个动作的 kind 落点一旦定下，§3 的表格、§7 的切片边界、以及 #61 Acceptance 第二条的满足方式都随之确定。其余问题相对独立。
2. **Q5 涉及改 #61 正文已给的 payload 草稿**。这是本提案唯一一处主张修改 issue 正文内容的地方，理由已写在 §5.3，请 designer 明确认可或否决。
3. **Q8 标 `PENDING_VALIDATION`**。水位取 id 还是 `createdAt` 需要实测 GitHub API 行为才能定；本文没有伪造该结论，实现前必须补证。

除上述三点外，其余问题的推荐方案均只依赖已裁定文书或本文 §2 的 `CODE` 证据。

<!-- 本文件为 proposals 性质；不含运行时代码。请勿据此实施，待 Epic Designer 裁定。 -->
