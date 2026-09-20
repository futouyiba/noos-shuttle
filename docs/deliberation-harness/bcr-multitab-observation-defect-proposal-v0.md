# BCR 多标签页 / 后台节流下的观测层与 watcher 层缺陷 — 证据与候选提案 v0

Issue: futouyiba/noos-shuttle#56
Branch: `futou-/sharp-leavitt-798409`
Worktree: `.claude/worktrees/sharp-leavitt-798409`
基线 revision: `5703312`（本文撰写时的 HEAD~1；运行中的扩展 dist 亦构建自该 revision，故本文行号对运行代码具权威性）
上游 handoff: `.noos/handoffs/active/chatgpt-provider-recovery-go-n-handoff.md` @ `61d5d434ed0ab97449c3e8746b110bea64c4f411`
上游 proposal: `docs/deliberation-harness/chatgpt-provider-recovery-go-n-proposal-v0.md` @ 同上 SHA
上游 issue: #54（draft PR #55）

---

## 0. 结论摘要

用户报告：「同一标签页 Go × N 正常；在多个标签页间来回切换 → 跑了一轮就停住，切回也接不上。」

**核心结论：这不是（主要不是）节流问题，而是多标签页/多会话下的**身份与授权（identity & authority）**问题。** 节流真实存在（已实测 1/min），但它只是放大器与次级停滞源；**最能解释症状的机制不需要节流**。

按严重度排序的四条代码级根因：

| # | 根因 | 关键位置 | 等级 |
| --- | --- | --- | --- |
| **F1** | submission claim authority 是**单条全局记录**，且 `reconcile` **不回收** authority。两个会话各自持有在飞 operation 时，被抢走 authority 的一方**反复 `STILL_AMBIGUOUS`**（`reconcile` 内无自愈出口）→ 其 operation 不 `COMPLETED` → Run 停在 `STABILIZING`。**静默、无日志、无候选记录。** 停滞时长 = 该页面持有 in-memory `activeSubmission` 的时长；页面重载或会话切换（`:3509` 置 `null`）可解除。 | `src/core/submission-operation.ts:62, 272-284, 361-389, 394-405, 705-707`；`src/content/index.ts:3201-3202, 3310, 3343, 3509` | `CODE` + `STORE` + `INFER` |
| **F3** | `bcrWatcherTick` **无任何 lease/fence 守卫**，却能对全局 run store 施加 `USER_INTERVENTION` / `CARRIER_FAILURE` / `CARRIER_PHASE`；`apply` 的 wire 不携带 provenance，reducer 无从拒绝。**与 #54「只有 canonical lease holder 可 actuate」直接冲突**（重复标签页/同一会话的第二个标签页即可触发）。 | `src/content/index.ts:1866-1899`；`src/background/service-worker.ts:246-249, 365-366` | `CODE` |
| **F2** | Run 采纳**只在挂载时发生一次**，且会话引用未解析即静默早退；1 Hz 轮询**不会周期性重新采纳**。另一处调用点仅在 `bcrRun` 已非空时可达，对未采纳的页面无帮助。→「接不上」。 | `src/content/index.ts:327, 1609, 1614-1615, 2622-2633, 3134-3151` | `CODE` |
| **F4** | 介入判定基于**每标签页、可陈旧、终局化**的计数差值（且 `?? 0` 会塌缩）。实测到**系统性误判签名**：两个不同会话的 Run 相隔 **11.4 s** 被先后判为「人为介入」；另一 Run 在**消耗 0 轮**时即被判介入。**触发机制未定**（见 §3 H-C）。 | `src/content/index.ts:223, 1588, 1707, 1748, 1767, 1883` | `CODE` + `STORE`；机制 `PENDING_VALIDATION` |

另两条次级/结构性缺陷：**F5** `issueRunGo` 失败即停泊且 AUTO 下无出口（被 1/min 节流直接放大）；**F5'** Page Lifecycle `freeze`/`resume` 完全未处理、`suspended` 语义混淆。

**假设裁定**：H-A **证实**（实测塌到 1/min，但切回无 burst）；H-B **证伪**（普通切换只发 `visibilitychange`，持续隐藏也不发 `freeze`）；H-C **证实（结构性）**，误判签名的**归因**为 `PENDING_VALIDATION`；H-D **证实（结构性）**，症状归因为 `INFER`（即 F1/F3）；H-E **未复现**（`PENDING_VALIDATION`）。

**需要什么**：F1 与 F4 触及未裁定语义，需 Epic Designer 窄裁定（§6 `Q1`/`Q3`，另见 `Q2`/`Q4`/`Q5`）；**F3** 属**实现落后于已裁定边界**（修法形态待 `Q2`）；**F2 / F5 / F5'** 属**可实现任务**，各自需先经 `Q2`/`Q4`/`Q5` 确认不越界（见 §6 分类表与 F1/F3 不对称说明）。

---

## 1. Scope and 与 #54 的边界

**本 proposal 的语义对象**：BCR Go × N 在浏览器侧的**观测层（`RuntimeObservationLedger` / `observeRuntimePage`）与 watcher 层（`bcrWatcherTick` / `checkPageContext` / run 采纳与对账路径）** 在「后台标签页节流」与「多标签页切换」下的行为。

**明确不在本 proposal 内**（属 #54，不重开）：

- Evidence Gate、provider-native Retry 语义、`CONTINUE_PROVIDER_TURN`、context rebase 的最小 pack、Automation Boundary、RecoveryBudget 的构成。

**与 #54 已裁定边界的接缝**：本 proposal 只判定**实现是否落后于**下列已裁定语义，不重新裁定语义本身：

1. 「重新获得合法 lease/runtime eligibility 可以恢复同一 Run」
2. 「Browser Carrier identity 可以改变」
3. 「Duplicate tab 本身不结束 Run，只有 canonical lease holder 可 actuate」
4. 「任何不能归因于当前 Run/recovery operation 的 Human user input → `USER_INTERVENTION` 并结束 Run」

凡修复需要改动上述边界之外的语义（例如「全局唯一 claim authority」是否本就是有意的策略），本文在 §6 单独标为 `NEEDS_ADJUDICATION` 并给出待裁定问题，不自行裁定。

---

## 2. 证据等级

本文所有结论按下列等级标注，**工程推断一律显式标注，不得被读作实测事实**。

| 等级 | 含义 |
| --- | --- |
| `CODE` | 直接读当前 revision 源码得出，附精确 `file:line`。可复核。 |
| `LIVE` | 真实 dogfood 浏览器（Chrome 151.0.7922.173，CDP 9229，profile 在仓库 `.tmp/issue-3/`）上的只读观测。 |
| `STORE` | 从 `chrome.storage.local` 只读取证到的持久化状态。 |
| `INFER` | 工程推断：由 `CODE` + `STORE` 组合出的因果链。**未经受控复现。** |
| `PENDING_VALIDATION` | 未能取证。 |

**取证约束（全程遵守）**：只读调研 + proposal；**未**自动发送「继续」/「go」、**未**点击 Retry、**未**刷新 provider 页面、**未**制造限流、**未**接触凭据。所有 CDP 观测均为只读（`Runtime.evaluate` 读状态 / 事件监听 / `Page.bringToFront`），未对被测页面做任何状态变更。

**环境提示（影响证据解读）**：取证期间该浏览器处于降级网络状态，页面日志持续出现 `net::ERR_INTERNET_DISCONNECTED`、`wss://ws.chatgpt.com` 连接失败、以及 ChatGPT 自身的 `RequestError: Too many requests`。故**凡涉及「provider 未响应」的停滞，均不能唯一归因于本文缺陷**，本文对此类项一律降级或标 `PENDING_VALIDATION`。

---

## 3. 复现与证据表（按假设）

### H-A 定时器节流 —— **证实：隐藏标签页塌到 1/min**；切回时的 burst **未证实**

`CODE`：watcher 为 `window.setInterval(..., 1_200)`（`src/content/index.ts:1856`）；页面上下文轮询为 `PAGE_CONTEXT_POLL_MS = 1_000`（`src/content/index.ts:188`，轮询体在 `:2622-2633`）。二者都是 `setInterval`，均在 Chrome 后台标签页节流范围内。

`LIVE`（被动探针，装好后**脱离调试器**，避免附加 debugger 干扰节流判定）：

**短窗口（隐藏约 1 分钟）**：

| 标签页 | 观测窗口 | 1 s 计时器 | 1.2 s 计时器 | 观测事件 | 最大间隔 |
| --- | --- | --- | --- | --- | --- |
| `6aab8aaa`（隐藏，刚被切走） | 55 s | 54 次 | 45 次 | 55 次（≈1 Hz） | 1 035 ms |
| `6aaa566f`（隐藏较久） | 57 s | 26 次 | 23 次 | 26 次 | 11 047 ms |

**长窗口（同一对标签页，持续隐藏、无调试器附加，跨度 ≈ 320 s）**：

| 标签页 | 累计间隔序列（尾部） | 观测事件最大间隔 |
| --- | --- | --- |
| `6aab8aaa` | `…1004, 992, **42161, 59910, 60114, 60092**` | **60 111 ms** |
| `6aaa566f` | `…1002, 998, **11047, 60163, 59894, 60147, 59999**` | **60 184 ms** |

观测事件本身也同步塌到 1/min（例如 `6aab8aaa` 最后三次观测时刻间隔为 `60 111 ms`、`60 023 ms`，即精确的 60 s）。

结论：
- **证实**：后台标签页把 **1.2 s 的 watcher 与 1 s 的上下文轮询一并压到 ≈1/min**（连续间隔 ≈60 000 ms，最大 60 184 ms）。观测发布同样被压到 1/min。
- **实测补充**：本配置下塌到 1/min 的**延迟远小于文档所述的 5 分钟**——本窗口内标签页被隐藏后约 16 s（经历一个 42 s 的过渡间隔）即进入稳定的 60 s 档位。**按实测记录，不按文档推断。**
- **未证实**：**切回前台时的 burst（补跑积压 tick）**。切回后测得的是恢复 1 s 周期（12 s 窗口内 12 次），未观察到补跑积压。H-A 的后半段不成立。
- 方法论坑：附加 debugger 观测时，隐藏标签页亦测得 1 Hz，**说明调试器自身会干扰节流**；故本文节流结论只采用被动探针数据。

### H-B 冻结的 ledger 永不 resume —— **证伪**（作为本症状的机制）

`CODE`：
- `RuntimeObservationLedger.suspend()` / `resume()` 各有**且仅有**一个调用点：`pagehide`（`src/content/index.ts:2618`）与 `pageshow`（`src/content/index.ts:2612`）。
- `visibilitychange` 的处理体（`src/content/index.ts:2613-2617`）**只**在可见时调用 `scheduleContextCheck()`，**不触碰 ledger**。
- 全仓库**不存在任何 Page Lifecycle `freeze` / `resume` 监听器**（`grep` 结果为 0）。

`LIVE`（被动探针记录生命周期事件）：

- 普通切换标签页（`6aab8aaa`，隐藏瞬间）：只收到

  ```
  focus → blur → visibilitychange(visible→hidden)
  ```

- **持续隐藏 ≈ 320 s、且已确认降到 1/min 的整段窗口内，两个标签页均未收到任何 `freeze` 事件**（`events` 数组除上述三条外为空）。

因此：

- **普通切换标签页不会触发 `suspend()`**，ledger 不会被冻结；**持续隐藏导致的降频是「节流」，不是「冻结」**——本场景下 Chrome 并未冻结这些标签页。所谓「冻结的 ledger 永不 resume」在本场景**不成立**。
- 真正的 gap 是另一回事：`suspended` 语义把「页面即将消失」与「观测暂不可用」混为一谈，且 **Page Lifecycle 的 `freeze` / `resume` 完全未处理**。这条作为实现 gap 保留（见 §4 F5'），但不作为本症状的机制。
- **但 1/min 本身足以致命**：watcher 一分钟一次，而 `waitForReadyObservation()` 的窗口只有 6 s（`src/content/index.ts:1937-1944`）。后台标签页里该窗口内可能**一次轮询都不发生**，于是 `issueRunGo` 必然取到空值并停泊（见 §4 F5）。H-A 与 F5 由此直接串联。

### H-C 误判 `USER_INTERVENTION` —— **证实（结构性）**，且发现系统性误判签名

`CODE`（判定链，逐行）：

- 基线是**每标签页的模块级变量**：`let bcrExpectedUserCount = -1;`（`src/content/index.ts:223`）。
- 基线只从**该标签页自己的** ledger 取：采纳时 `bcrExpectedUserCount = runtimeObservationLedger.value?.userMessageCount ?? -1`（`:1588`）；开跑时 `= observation.userMessageCount ?? 0`（`:1707`）；发 go 时 `= (observation.userMessageCount ?? 0) + 1`（`:1748`）；被 BLOCKED 时回写为当前观测值（`:1767`）。
- 判定是**不对称且终局**的：只有 `observedUserCount > bcrExpectedUserCount`（`:1883`）触发，且一旦触发即 `USER_INTERVENTION`（`:1885`）→ `status CANCELLED / phase ENDED`（`src/core/continuation-run.ts:217-222`）。**没有差值上限、没有幂等重放、没有时间戳比较。**
- `?? 0` 兜底（`:1707`、`:1748`）：当观测缺少 `userMessageCount` 时基线塌缩为 `0`／`1`，于是任何真实计数都满足 `>`。
- `issueRunGo` 用于计算基线的 `observation` 来自 `waitForReadyObservation()`（`:1937-1944`），其值是**该时刻的 ledger 快照**；在节流标签页里这个快照可以相当陈旧。

`STORE`（持久化取证，14 条已结束 Run / 23 条候选）：

| runId | 会话 | 模式 | 消耗 | stopReason | 候选捕获时刻 |
| --- | --- | --- | --- | --- | --- |
| `bcr-mu53kkug-mq8gcf` | `6aaa0840` | AUTO_X5 | 1 | USER_INTERVENTION | 06:05:04.868 |
| `bcr-mu53m4pl-e1jzxx` | `6aa8bd9a` | ASSISTED | 1 | USER_INTERVENTION | 06:04:53.432 |
| `bcr-mu4xoqkr-p6jp9z` | `6aa9ffaa` | AUTO_X5 | **0** | USER_INTERVENTION | 04:06:52.520 |
| `bcr-mu4mp3xh-2dr1o4` | `6aa9ffaa` | ASSISTED | 5 | USER_INTERVENTION | 02:27:01.753 |

**系统性误判签名**：前两条属于**两个不同会话**，却被判定为「人为介入」的时刻仅相隔 **11.4 秒**（算术：`06:05:04.868 − 06:04:53.432 = 11.436 s`）。一个人类无法在 11 秒内先后在两种不同 provider 会话里各插入一条消息，因此这至少说明判定路径存在**非人类来源的计数跳变**。第三条在 **消耗 0 轮**时即被判定介入（`consumedContinuations = 0`），即该 Run **一轮都没走完**就被终止——与该 Run 所属会话 `6aa9ffaa` 另有更早的 `USER_INTERVENTION` 记录（`bcr-mu4mp3xh-2dr1o4`，02:27）并存，符合「同会话再跑一轮时基线落后于实际计数」。

`INFER`（机制候选，**已收窄**）：可用的误判机制必须能在**单个标签页内**成立，因为每条 tick 只能作用于该标签页自己的会话的 Run：

- `bcrWatcherTick` 的计数全来自**本页 DOM**（`:1870`、`:3195` 的 `document.querySelectorAll(...)`），比较对象是本页模块级 `bcrExpectedUserCount`（`:223`）。
- run store 按会话分槽（`src/core/continuation-run.ts:329/338` 的 `store.activeByConversation[run.providerConversationRef]`），`apply` 以 `mutationKey(store, mutation.runId)` 定位（`src/core/continuation-run.ts:344`/`:357`/`:363`，`mutationKey` 定义于 `:391`）——而一个标签页只可能通过 `refreshActiveRun` 拿到**自己会话**的 run，故**跨会话施加 `USER_INTERVENTION` 在本实现中不可达**。

因此在代码上可成立的候选是：(i) 同一标签页内**基线陈旧/塌缩**（`?? 0`，`:1707`/`:1748`）导致的同会话误判；(ii) **同一会话的第二个标签页**（重复标签页）以自己那份陈旧基线 tick，对**共享的那一个 Run** 施加终局事件——这正是 §4 F3 无 lease 守卫所允许的。

**哪一种造成了上述 11.4 s 签名，本文未有受控复现，标 `PENDING_VALIDATION`**（复现需在同会话开两个标签页并各自持有陈旧基线，或制造基线塌缩，均超出本任务只读取证边界）。签名本身（两个不同会话的 Run 在 11.4 s 内先后被判介入、且其中一条消耗 0 轮）作为**误判存在的证据仍然成立**，但其**归因未定**。

### H-D 多标签页 carrier / fence 失配 —— **证实（结构性）**；症状归因 `INFER`（见 §4 F1、F3）

见 §4。核心：submission claim authority 是**单条全局记录**，与「每个 Run 有自己的 canonical lease holder」冲突。**「证实」限于结构性事实**——全局单槽 + `reconcile` 不回收 + watcher 无 lease 守卫，均在代码中确证（`CODE`）；**本文「多标签页切换 → Go × N 停住」这一症状由该结构导致，是推断**（`INFER`），因其受控复现需要两个会话各自持有在飞 operation，超出只读取证边界。现网停滞实例（§3 末表）为该推断提供了 `STORE` 侧支持，但不构成因果证明。

### H-E ChatGPT 在隐藏标签页暂停流式渲染 —— **未复现**，`PENDING_VALIDATION`

`LIVE`：
- 隐藏标签页 `6aaa566f` 的观测事件显示 `state = GENERATING`、`quietSince = null`，即隐藏期间**输出仍在变化**，未见「暂停渲染导致误判 quiet」。
- 隐藏标签页上的 AUTO_X5 Run `bcr-mu5nl8wn-ckix47` 在 15:01–15:04 约 4 分钟内正常推进 `go:1 → go:4`，说明**隐藏标签页可以正常推进 Run**。

结论：`OBSERVATION_QUIET_MS = 2_000`（`src/content/runtime-observer.ts:36`）在隐藏标签页下误判 quiet 的路径**未取得证据**，保留 `PENDING_VALIDATION`。

### 现网停滞实例（`STORE`，用于交叉验证）

| 字段 | 值 |
| --- | --- |
| runId | `bcr-mu5860hg-g61kyd` |
| providerConversationRef | `6aab8aaa-1d24-83ee-84a2-86c48df126ac` |
| mode / status / phase | AUTO_X5 / **ACTIVE** / **STABILIZING** |
| consumedContinuations | 1 / 5 |
| pendingSubmissionOperationId | `bcr-mu5860hg-g61kyd:go:1-mu5860hv` |
| acceptedOperationId | 同 pending |
| bindingEpoch | 3 |
| updatedAt | 2026-09-17T08:08:22.225Z（读取时已停滞 ≈ 7 小时） |
| 该 Run 的候选记录数 | **0** |

对应 submission operation：`state = OBSERVED_ACCEPTED`、`leaseGeneration = 3`、`leaseOwnerRef` 尾 8 位 `8490df36`、`targetCarrierRef = browser-tab:557761588`；**从未推进到 `COMPLETED`**。

同一时刻该标签页的实时观测（`LIVE`）：

```json
{ "state": "READY", "carrierIdentityState": "browser-tab",
  "carrierRef": "browser-tab:557761588", "executionInstanceRef": "...8490df36",
  "sourceEpoch": 3, "quietSince": <约 264 s 前>, "userMessageCount": 3, "assistantMessageCount": 2 }
```

即：**观测健康（1 Hz、READY、carrier / epoch / lease 全部与 op 的 fence 一致），但对账事件自 08:08 起再未产生。** 这把停滞位置收窄到「对账/恢复路径」而非「观测路径」。

---

## 4. 当前实现差距报告

### F1（最高严重度）submission claim authority 是全局单槽，reconcile 不回收 authority → 多会话下该页面的操作冻结，无页内自愈出口

`CODE`：

- authority 存于**单一键**：`SUBMISSION_AUTHORITY_KEY = "noosSubmissionAuthority"`（`src/core/submission-operation.ts:62`），`getAuthority` 读的就是这一个键（`:361-365`）。
- `ensureAuthority`（`:366-389`）在**同一个槽**里覆盖：新 context 更新则覆盖，较旧则抛 `submission_authority_stale`（`:381`）。
- 「谁更新谁持有」由 `isNewerAuthorityContext` 决定（`:705-707`）：`context.sourceObservedAt > existing.sourceObservedAt || (相等 && sourceEpoch 更大)` —— 即 **authority 跟随全局最新的观测**，与 logical thread 无关。
- `reconcile` 的准入门（`:272-284`）：

  ```ts
  const authority = this.store.getAuthority ? await this.store.getAuthority() : undefined;
  if (!authority || authority.logicalThreadId !== operation.logicalThreadId || ... )
    return { records, result: { outcome: "STILL_AMBIGUOUS", ... } };
  ```

  **`authority.logicalThreadId !== operation.logicalThreadId` 即 `STILL_AMBIGUOUS`；`reconcile` 路径中没有任何 `ensureAuthority` 调用，即不会回收 authority。故该 outcome 在该页面反复返回，无页内自愈出口。**
- 而 `recover` **会**回收（chrome store 版 `:394-405`，并在 `:413` 用 context 覆写 `operation.dispatchFence`），但其准入要求 `isNewerOrSameAuthorityContext` + `sameRecoveryFence`（`:404-405`）。
- 生产路径下 `reconcile` 走的确实是上面这条通用路径：SW 用 `createChromeSubmissionStore(storage, { claimViaCoordinator: false })`（`src/background/service-worker.ts:268`），该分支返回的 store **没有 `dispatch`**（`src/core/submission-operation.ts:391-393` 与 `:440-452` 是两个互斥返回），因此 `SubmissionOperationLedger.reconcile` 的 `if (this.store.dispatch)`（`:262`）不成立，落入 `:263` 的通用 `mutate`。
- `recover` 的**唯一**调用来源是 `restoreActiveSubmission`（`src/content/index.ts:3343`，mutation `type: "recover"`），而它被 `if (activeSubmission || ...) return;`（`:3310`）挡住 —— **只有 `activeSubmission === null` 时才可能走到 recover**。

`INFER`（因果链，闭环）：

1. 标签页 A 在会话 A 上 dispatch → `ensureAuthority(contextA)` → A 持有 authority。
2. 标签页 B 在会话 B 上 dispatch → contextB 更新 → **authority 被 B 抢走**。
3. A 的页面里 `activeSubmission` 非空 → A 只走 `reconcile`（`:3201-3202`）→ 因 `authority.logicalThreadId ≠ operation.logicalThreadId` → **反复 `STILL_AMBIGUOUS`**。
4. A 走不到 `recover`（`activeSubmission` 非空），**因此无法回收 authority** → 该 operation 不 `COMPLETED` → 该 Run 停在 `STABILIZING`。
5. **该停滞的持续时间 = A 页面持有 in-memory `activeSubmission` 的时长。** 解除条件只有两个，且都不是「自愈」：页面重载，或 `resetForConversationChange`（`:3507-3512`，其 `:3509` 置 `activeSubmission = null`）——即**离开/更换该会话**。换句话说：**用户不重载、不切走，Run 就一直停住**；这与症状「进行了一轮，然后就停住了」一致。
6. 该停滞**静默**：无错误、无 UI 文案、无候选记录（与 `bcr-mu5860hg-g61kyd` 候选数为 0 一致）。

`STORE` 佐证：读取时 authority 全槽记录为 `logicalThreadId = thread:6aaa566f-…`、`targetCarrierRef = browser-tab:557761592`、`leaseOwnerRef` 尾 8 位 `66de631d`、`authorityGeneration = 15`、`authorityEstablishedAt = 15:04:20` —— 与停滞 Run 的会话 `6aab8aaa` / carrier `557761588` / lease `8490df36` **完全不同**。且会话 `6aaa566f` 的 AUTO_X5 Run 当时正在正常推进 `go:1→go:4`，即「**其中一个会话活着，另一个会话的 operation 被冻死**」——与报告症状「进行了一轮，然后就停住了」逐字吻合。

**这与节流无关**：只要有两个会话各自持有在飞 operation，就可发生。

### F3 watcher 层无 lease 守卫，任意标签页可对全局 Run 施加终局事件

`CODE`：`bcrWatcherTick`（`src/content/index.ts:1866-1899`）**没有任何 carrier / lease / fence 校验**，却能施加三种会改变全局 run store 的事件：

- `:1883-1886` `USER_INTERVENTION` → `status CANCELLED, phase ENDED`（`src/core/continuation-run.ts:217-222`）
- `:1889-1891` `CARRIER_FAILURE`
- `:1893-1897` `CARRIER_PHASE`

对照：**其他所有 actuation 路径都是严格 fence 化的** —— `NOOS_DISPATCH_GOAL_REANCHOR`（`:3218-3225`）、`NOOS_DISPATCH_DELIVER_CHILD_RESULT`（`:3249-3256`）均校验 `leaseOwnerRef === current.executionInstanceRef`、`bindingEpoch === current.sourceEpoch`、`targetCarrierRef === current.carrierRef`、`providerConversationRef` 全等；`isCurrentSubmissionObservation`（`:3484-3492`）与 `restoreActiveSubmission` 的过滤（`:3322-3328`）同样如此。

服务端同样挡不住：`isKnownContinuationRunMutation` 对 `apply` 只做**形状校验**（`src/background/service-worker.ts:246-249`：runId / event.type / now 是字符串或数字即可），而 sender 校验仅为「是允许的 provider 标签页 + frameId 0」（`:365-366`）。**`apply` 的 wire 上根本不携带 carrier / lease 信息，reducer 无从拒绝非 lease holder。**

**这与 #54 已裁定边界直接冲突**：「Duplicate tab 本身不结束 Run，只有 canonical lease holder 可 actuate」——当前实现里，**任何**投影到该 Run 的标签页都能 actuate。

### F2 Run 采纳只在挂载时发生一次（观测循环从不驱动采纳），且依赖挂载瞬间已解析的会话引用

`CODE`：

- `refreshActiveRun()` 全仓库**有两个调用点**，但都在「已采纳」或「挂载时」语境：
  1. `src/content/index.ts:327`（shuttle 挂载时）。
  2. `src/content/index.ts:1609`：`applyContinuationRunEvent` 内 `if (!result.ok) await refreshActiveRun();`——该函数开头即 `if (!bcrRun) return;`（`:1606`），**故对「尚未采纳」的页面不可达**。
- 它在会话引用未解析时**静默早退**：`const conversationRef = runtimeObservationLedger.value?.providerConversationRef || currentPageContext.conversationId; if (!conversationRef) return;`（`:1614-1615`）。
- 1 Hz 轮询（`:2622-2633`）调用的是 `attachCarrier()` 与 `checkPageContext()`；`checkPageContext`（`:3134-3151`）只发布观测并在页面签名未变时直接 `return` —— **不会重新采纳 Run**。
- `adoptRunState` 也只能经 `mutateContinuationRun` 到达；而 `mutateContinuationRun` 的调用方向只有 `refreshActiveRun` / `start` / `check_dispatch` / `applyContinuationRunEvent`（后者要求 `bcrRun` 已非空，`:1606`）。

即：**周期性的观测循环从来不驱动采纳**；两个 `refreshActiveRun` 调用点都要求「已经在采纳语境里」或「恰好在挂载瞬间」。这是一条**循环依赖**——需要一个已采纳的 Run 才能触发重新采纳。

后果：若页面在会话引用解析出来之前完成挂载（或挂载时正处于 `WEB:` 临时路由 —— `providerConversationRef` 被显式置 `undefined`，`:3186`），该标签页**永远不会采纳**该 Run，`bcrRun` 恒为 null，watcher 永不安装，且**没有任何重试路径**。`resetForConversationChange`（`:3507-3530`）在会话切换时清空 `bcrRun` 并停表，之后同样无人重新采纳。→ 对应「切回去也无法顺利接上」。

### F4 `bcrExpectedUserCount` 基线：每标签页、可陈旧、终局化、且有 `?? 0` 塌缩

见 §3 H-C 的 `CODE` 清单。补充要点：这是一条**基于计数差值的启发式**，而非基于消息身份或时间戳的判定；`>` 是终局的，没有「差值上限」也没有与 fence 绑定的重定基线。

### F5 `issueRunGo` 失败即停泊，无重试、无回滚；且停泊态在 AUTO 下无出口

`CODE`：

- `issueRunGo` 在 `waitForReadyObservation()` 返回空时：`viewState.message = copy.bcrCarrierNotReady; render(app); return;`（`:1715-1720`）—— **不重试、不回滚 phase、不置任何可重入标志**。
- `waitForReadyObservation`（`:1937-1945`）是 `Date.now()` 期限 + `await new Promise(r => window.setTimeout(r, 100))` 的轮询；在节流标签页里 100 ms 会被拉长到 ≥1 s（甚至更久），6 s 窗口内的轮询次数随之塌缩。
- **相位已先行推进**：`autoAdvanceRound` 先 `EVALUATION_PASSED`（使 phase 进 `READY_TO_GO`，`:1821`）**再**调 `issueRunGo`（`:1832-1834`）。因此失败会留下「`phase = READY_TO_GO` 且**无** pending operation」的停泊态。
- 该停泊态**没有出口**：`bcrWatcherTick` 只在 `pendingSubmissionOperationId !== undefined` 时才推进相位（`:1888`），不会重新发 go；`adoptRunState` 只对 `mode === "AUTO_X5" && phase === "EVALUATING"` 自动续跑（`:1593`），`READY_TO_GO` 被明确排除。

### F5' Page Lifecycle `freeze` / `resume` 完全未处理；`suspended` 语义混淆

`CODE`：无任何 `freeze` / `resume` 监听器（`grep` 为 0）。`suspend()`（`src/content/runtime-observer.ts:99-104`）把 `state` 置 `SUSPENDED` 并清空 `quietSince`，`resume()`（`:106-109`）置 `RECOVERING` 并清空 `quietSince`；二者仅由 `pagehide` / `pageshow` 驱动。语义上「页面即将离开」与「观测暂不可用」混为一体，缺少「切标签页」这一中间态的表达。另注：`deriveRuntimeState` 中 `previous === "SUSPENDED"` 的分支（`:74`）在当前调用方式下不可达（`normalizeObservation:53-54` 传入的 `previous` 只会是 `"STABILIZING"` 或 `undefined`）—— 属既存死分支，非本次症状成因。

---

## 5. 候选修复提案

以下均为**候选机制描述，不是实现指令**（本任务不实现运行时代码，亦不规定字段命名或 API 形态）。每条给出：改动对象、机制、以及必须同时回答的边界问题。措辞中的「应 / 让 / 改为」描述**期望达成的语义**，具体实现方式留有实现者空间；凡触及语义边界者，一律先经 §6 裁定再实现。

### C1 让 claim authority 的作用域与 Run 的 canonical lease 对齐（对应 F1）

候选机制（择一，需裁定）：

- **C1a 按 logical thread 分槽**：把 `SUBMISSION_AUTHORITY_KEY` 的单条记录改为以 `logicalThreadId`（或 `providerConversationRef`）为键的表，使会话之间互不驱逐。
- **C1b 让 `reconcile` 具备回收语义**：在 `reconcile` 的准入失败处，若 `operation` 处于 execution-owning 状态且 `sameRecoveryFence(operation, observation 派生 context)` 成立，则允许以「同一 Run 的合法 lease 重获」语义回收 authority（与 `recover` 同规则），而不是反复 `STILL_AMBIGUOUS`。
- **C1c 消除不对称**（机制描述，非实现指令）：既然 `restoreActiveSubmission` 只在 `activeSubmission === null` 时可达，期望的语义是「持有 in-memory `activeSubmission` 但 authority 已被他人夺走」的页面**不必靠页面重载才可能重获**——即重获的**可达性**不应唯一地绑在「页面重载/会话切换」上。具体以何条件、何种证据重获，属 `Q1` 裁决范围，本候选不预设。

**必须回答的边界问题**：claim authority 究竟是「整个浏览器一个 actutation 权威」还是「每个 Run 一个 canonical lease」？若是前者，当前行为是设计而非缺陷，则 F1 不成立；若是后者，#54 的「只有 canonical lease holder 可 actuate」已蕴含后者，当前实现即为落后。→ 见 §6 `Q1`。

### C2 给 watcher 层加上与其它 actuation 路径同级的 lease/fence 守卫（对应 F3）

候选机制：

- `bcrWatcherTick` 在施加 `USER_INTERVENTION` / `CARRIER_FAILURE` / `CARRIER_PHASE` 之前，先校验当前观测与 Run 的绑定（至少 `providerConversationRef` 全等；并按裁定补上 lease/carrier 归属）。
- 在 `apply` 的 wire 上补一个可验证的 provenance（例如发起方的 `carrierRef` / `executionInstanceRef` / `bindingEpoch`），使 **reducer 层**可拒绝非 lease holder 的事件，而不是只靠 content script 自律。这是让「只有 canonical lease holder 可 actuate」在**共享的 run store** 上真正成立的必要条件。

**必须回答的边界问题**：一个 Run 的 canonical lease 用什么自然键表达（`executionInstanceRef`？`carrierRef`？二者组合？），以及 lease 如何在多标签页间合法交接（见 C3）。→ `Q2`。

### C3 多标签页 carrier / lease 交接对齐「Browser Carrier identity 可以改变」（对应 F2、F3、F1）

候选机制（**机制描述，非实现指令**——交接判据本身即 `Q2` 的裁定对象，本候选不预设实现）：

- 让 Run 采纳由**观测循环驱动**而非仅挂载驱动：在 `checkPageContext` 的 1 Hz 路径里，当页面签名稳定、会话引用已解析、且本标签页**尚未**采纳当前 active Run 时，触发一次采纳（即给 `refreshActiveRun()` 增加一个受节流保护的周期性重试入口，而非仅在 `:327`）。
- 明确「采纳 ≠ 可 actuate」：采纳只建立投影；actuate 仍需通过 C2 的 lease 校验。
- 明确 lease 交接规则：当原 lease holder 所在 carrier 消失/被冻结时，谁接管、以什么证据接管、旧 lease 何时失效。

**必须回答的边界问题**：交接是否需要人类显式授权，还是可自动？「重新获得合法 lease/runtime eligibility 可以恢复同一 Run」已裁定可恢复，但**接管的判据**未裁定。→ `Q2`。

### C4 让介入判定摆脱「每标签页计数差值」（对应 F4）

候选机制（可组合）：

- **作用域化**：把基线从 content script 模块级变量（`src/content/index.ts:223`）提升为**与 Run/fence 绑定**的状态，采纳时由被测 Run 的权威身份派生，而不是由本标签页自报的 DOM 计数派生。
- **幂等重放 / 身份化**：用「消息身份（fingerprint）+ 时间戳」取代「计数差值」；对同一证据重复观测幂等。
- **每 tick 重定基线的保守版**：在每个 tick 先确认本标签页观察到的计数变化是否能归因于本 Run 已记录的 dispatch（如 `acceptedPayloadFingerprint`），不能归因时才考虑介入。
- **去掉 `?? 0` 塌缩**：`userMessageCount` 缺失时应视为「证据不足」而**不比较**，而非塌缩成 `0`/`1`（`:1707`、`:1748`）。
- **差值上限 + 需连续确认**：单 tick 跳变需满足上限且连续 N tick 一致才判定介入，且判定前必须能排除本 Run 自身的在飞 dispatch。

**必须回答的边界问题**：多标签页下「什么算人类介入」本身触及任务契约 §16 的语义（多标签页协同是否算介入）。→ `Q3`。

### C5 `issueRunGo` 失败不得停泊；停泊态必须有出口（对应 F5）

候选机制（**机制描述，非实现指令**；「自动重发 go 是否已获授权」是 `Q4` 的裁定对象，本候选不预设）：

- `waitForReadyObservation()` 失败时，**先回滚可重入**：不要留下「`READY_TO_GO` 且无 pending op」的不可恢复态（例如把失败记录为一个可被 watcher 重新尝试的挂起意图）。
- 让 watcher 在 `phase === "READY_TO_GO"` 且无 pending operation 时具备重试发 go 的能力（受恢复预算/节流约束），或在 AUTO 模式下提供显式的可见出口而不静默停泊。
- 把「相位已推进但动作未发出」这一中间态显式建模，而不是靠时序巧合保证。

**必须回答的边界问题**：AUTO 模式下自动重试发 go 是否属于「未授权自动化」？#54 已允许 `WAIT + REOBSERVE + RECONCILE` 自动执行，而「重发 go」是新的 provider turn。→ `Q4`。

### C6 把「provider 接受证据」与「观测可用性」解耦（对应 F1 的可观测性、F5'）

观察：F1 的停滞之所以能潜伏 7 小时，是因为它对 UI、日志、候选记录**完全不可见**。候选机制：

- `reconcile` 长期返回 `STILL_AMBIGUOUS` 且超过阈值时应产生**可观测的降级信号**（例如 Run 上的 `observationUnavailable` / `reconcileBlocked` 标记与 UI 提示），而不是静默。
- `suspended` / Page Lifecycle：新增 `freeze` / `resume` 监听，并让「切标签页（观测降频）」与「真正导航离开（观测中断）」在状态上可区分（例如新增降级而非 `SUSPENDED` 的语义）。
- 明确「provider 是否接受」这一证据的**权威来源**是 submission ledger 的 durable 状态，而「本地观测是否可用」只是**可用性**问题；后者不应阻断前者的收敛。

**必须回答的边界问题**：新增 `freeze`/`resume` → `ledger.resume()` 是否会与既有 `pagehide`/`pageshow` 语义重复或冲突（bfcache 与 tab freeze 是不同机制）。→ `Q5`。

---

## 6. 是否需要设计裁定

**结论：部分属「实现落后于已裁定语义」（可实现任务直接推进），部分需窄裁定。**

| 项 | 分类 | 依据 |
| --- | --- | --- |
| F3（watcher 无 lease 守卫；`apply` wire 无 provenance） | **已裁定边界的实现落后** | #54 已裁定「Duplicate tab 本身不结束 Run，只有 canonical lease holder 可 actuate」。当前实现与之直接冲突，属实现未跟上。**但其修法（C2 的 provenance 字段形态、canonical lease 的自然键）需 `Q2` 窄裁定。** |
| F2（采纳只发生一次） | 可实现任务（低风险） | 不改变语义，只让既有的采纳逻辑被观测循环重新驱动。但「采纳是否等同可 actuate」须与 C2/C3 一并裁定（`Q2`）。 |
| F4（计数基线） | **需窄裁定** | 「多标签页下什么算人类介入」触及任务契约 §16 / #54 边界 3 的 `USER_INTERVENTION` 语义，不只是实现细节。`Q3`。 |
| F5（`issueRunGo` 停泊） | 可实现任务 | 不改语义（回滚可重入 + 停泊态出口）。但「AUTO 下自动重发 go」触及自动化边界。`Q4`。 |
| F5'（`freeze`/`resume` 未处理、`suspended` 语义混淆） | 可实现任务，但需确认不冲突 | `Q5`。 |
| F1（全局单槽 claim authority） | **需裁定（最高优先）** | 若「全局唯一 actuation 权威」是有意设计，F1 非缺陷；若「每 Run 一个 canonical lease」是意图，F1 是落后实现。二者语义后果差别很大，**不能由本文代为裁定**。`Q1`。 |

**关于 F1 / F3 分类的不对称（须显式说明）**：F3 与 F1 出自同一结构（§3 H-D 将二者同列），却被分入不同类别——F3 记为「已裁定边界的实现落后」，F1 记为「需裁定」。理由如下，且该不对称本身是**待确认项**：

- F3 的**方向**已由 #54 裁定唯一确定：「只有 canonical lease holder 可 actuate」意味着**非** lease holder 的 tick 不得 actuate。当前 `bcrWatcherTick` 无守卫、`apply` wire 无 provenance，属**与该裁定相反**，故判为落后实现。分歧点只在**实现形态**（canonical lease 的自然键、provenance 字段），归 `Q2`。
- F1 则**未必**与既有裁定冲突：若「整个浏览器同一时刻仅一个 submission authority」是有意设计，则 `STILL_AMBIGUOUS` 是**该设计下的预期行为**，问题降级为「多会话并发时不应一方活、一方冻结」的**新语义问题**（`Q1`），而非实现落后。
- **两者是否应合并为同一类，取决于 `Q1` 的答案**：若裁定「authority 按 logical thread / canonical lease 分槽」，则 F1 亦落入「#54 已蕴含」，与 F3 同类，本文的分类应随即修正。**该分类不对称属待确认项，不由本文单方收束。**（Q1 已裁定为**按 logical thread / per-Run 分槽**，故本待确认项依 Q1 裁定即行收束——见 [§8](#8-designer-裁定记录)。**此收束系依 Q1 推得，非 designer 原句。**）

### 待 Epic Designer 裁定的问题（不自行裁定）

- **Q1**：submission claim authority 的作用域应是「全局单槽（整个浏览器同一时刻只有一个 actuation 权威）」还是「按 logical thread / canonical lease 分槽」？若是前者，多会话并发时应如何不发生「一方活、一方冻死」？
- **Q2**：一个 Run 的 canonical lease 用什么自然键表达，如何跨 carrier 合法交接？「重新获得合法 lease/runtime eligibility 可以恢复同一 Run」的**接管判据**是什么（是否需要人类授权）？
- **Q3**：多标签页场景下「人类介入」的判定语义是什么？计数跳变在何种条件下**不**构成介入？是否允许以「本 Run 自身 dispatch 的可归因性」替代计数差值？
- **Q4**：AUTO_X5 下，`READY_TO_GO` 且无 pending operation 时自动重试发 go，是否属于 #54 允许的 `WAIT + REOBSERVE + RECONCILE` 自动化，还是新的 provider turn（需人类授权）？
- **Q5**：新增 Page Lifecycle `freeze`/`resume` 处理、以及区分「切标签页」与「导航离开」的 `suspended` 语义，是否与已裁定的 reload/reattach 恢复语义重复或冲突？
- **Q6**（建议）：是否要求 `reconcile` 长期 `STILL_AMBIGUOUS` 时产生可观测降级信号（C6）——「静默停滞」是否本身即为可接受行为？

**Q1–Q6 均已作答。** 裁定记录见 [§8. Designer 裁定（记录）](#8-designer-裁定记录)。本节问题清单保留原样，**不因 §8 而重开**。

---

## 7. Authority / Addressability

- 本文所引 #54 handoff 落在**可寻址 revision** `61d5d434ed0ab97449c3e8746b110bea64c4f411`（该 revision 上 `.noos/handoffs/active/chatgpt-provider-recovery-go-n-handoff.md` 已被 track）。
- 本文所引源码行号绑定 revision `5703312`（**本文撰写时的 HEAD~1**；本文档所在 commit 为 `8e1bf41bc67714ac64b2052400f30fd297d64c53`。`5703312` 是运行中扩展 dist 的构建来源，故行号对运行代码具权威性）。
- 本文对 #54 的引用仅用于**边界约束**，不替代 #54 的 proposal；本 proposal 的语义对象是观测层与 watcher 层。
- 本 proposal **未**实现任何运行时代码，**未**自动发送「继续」/「go」、**未**点击 Retry、**未**刷新 provider 页面、**未**制造限流。

---

## 8. Designer 裁定（记录）

§6 的 Q1–Q6 已由 Epic Designer 作答。本节**记录**该裁定：它是转录，不是新一轮讨论，**不重开** Q1–Q6——Q1–Q6 自此已答、不再开放。§6 的问题清单保留原样，作为「当初的请求」，其地位不变。

**Provenance**

| 字段 | 值 |
|---|---|
| 作者 | Epic Designer（`futouyiba`），标题 `## Primary Design Disposition` |
| 裁定 | **`PARTIAL_ACCEPT`** |
| 精确目标 | `docs/deliberation-harness/bcr-multitab-observation-defect-proposal-v0.md` @ `bd4163bd4adb0d95c7ec03f85c9ce93c5ad344be`（PR #57 / Issue #56 派单） |
| 出处 | PR #57 comment `5717432171`，2026-09-17T16:02:12Z |
| Governor event | `event=issue56-design-dispatch-5716935789 head=bd4163bd4adb0d95c7ec03f85c9ce93c5ad344be action=primary-design-partial-accept` |
| 家族记录 | Issue #56 comment `5718137417`（含 Q→M 映射表） |
| 姊妹裁定 | PR #58 comment `5717715062`（后台依赖缺陷族；该族的 `§11. Designer disposition` 收录于 **PR #73**，截至 2026-09-20 尚未合并入 main） |

designer 自述理由（原文）：

> The evidence separates one already-authorized implementation defect from several genuine contract questions. Keep the narrow boundary: do not redesign provider recovery (#54) and do not treat background throttling as the primary semantic cause.

### Q1–Q6（逐条转录）

**Q1 — submission claim authority 的作用域**

> **ACCEPT per-logical-thread / per-Run authority; reject one browser-global actuation slot as the intended concurrency semantics.** The current single `SUBMISSION_AUTHORITY_KEY` is an implementation artifact that serializes unrelated logical threads and can strand one live operation in `STILL_AMBIGUOUS`. Canonical authority must be scoped by the logical execution identity it authorizes. This does not authorize two carriers to actuate the *same* Run concurrently.

**Q2 — canonical lease 自然键与交接**

> **ACCEPT existing authority model, no new Human gate for ordinary carrier replacement.** The natural authorization identity is the existing logical thread / Run plus its current actuation lease/fence. Carrier/tab identity is evidence/attachment, not the authority key. Handover is legal only through the existing lease/fence transition and runtime-eligibility checks; an ordinary reload/tab replacement does not itself require fresh Human authorization. Any scope/goal/authority-owner change still follows its existing Human/design gate.

**Q3 — 「人类介入」的判定语义**

> **ACCEPT provenance-based attribution; reject raw per-tab count delta as sufficient authority to terminate.** A user-count change is `USER_INTERVENTION` only when a new Human-authored provider turn is observed for the Run/conversation and cannot be attributed to the current authorized SubmissionOperation/recovery operation. Duplicate/stale observers and count catch-up after throttling are not intervention evidence by themselves. Unknown attribution fails closed: do not advance/actuate; surface ambiguity rather than terminally inventing Human intervention.

**Q4 — 由 `READY_TO_GO` 自动重发 go**

> **REJECT as an implicit recovery rule.** `READY_TO_GO` + no pending operation is not, by itself, authorization to manufacture another provider turn. Normal Go × N progression may issue the next GO only when the existing continuation policy/evaluator and budget authorize that next round. Recovery/re-send after a failed or ambiguous dispatch must use the separately adjudicated #54 recovery semantics/provenance; do not collapse it into watcher retry.

**Q5 — Page Lifecycle `freeze`/`resume` 与 `suspended`**

> **ACCEPT as implementation support, not a new recovery contract.** Distinguishing `visibilitychange`/background throttling from actual page freeze/navigation and re-establishing observation after resume is compatible with #54. It may restore observation/reconciliation eligibility; it must not itself prove provider acceptance, consume budget, re-send, or bypass lease/fence checks.

**Q6 — 长期 `STILL_AMBIGUOUS` 的可观测降级信号**

> **ACCEPT observable degraded state.** Silent indefinite stalling is not acceptable. A bounded observation/reconcile period that remains ambiguous must produce durable/visible degraded evidence (without guessing acceptance or auto-retrying). Exact timeout/UX copy is implementation-local unless it changes recovery authority.

### Required delta（转录）

1. Treat F3 as direct implementation lag: only the canonical lease/fence holder may apply Run-actuating watcher mutations; carry enough provenance/fence evidence for the reducer/background lane to reject stale/non-holder mutation.
2. Replace browser-global submission claim authority with authority scoped to the logical execution identity, preserving single-actuator semantics within one Run.
3. Make run adoption/re-adoption and observation resume converge after carrier replacement/background return without treating the return itself as provider/recovery evidence.
4. Replace terminal raw-count `USER_INTERVENTION` inference with attributable Human-turn evidence; ambiguous attribution pauses/degrades instead of terminating.
5. Keep watcher retry separate from #54 recovery operations; no implicit GO re-send.
6. Surface prolonged `STILL_AMBIGUOUS` as degraded/diagnostic evidence.

### Boundary / non-goals（转录）

- Do not reopen #54 Evidence Gate, RecoveryBudget, context rebase, provider Retry/Continue semantics, or Automation Boundary.
- Do not create a second canonical carrier-binding/lease ledger.
- Do not authorize concurrent actuation of one Run from multiple tabs.
- Do not treat timer throttling, visibility return, or observer catch-up as provider acceptance evidence.
- F4's observed misfire attribution remains `PENDING_VALIDATION`; this disposition fixes the authority rule, not the unproven empirical cause.

### Resume condition（转录）

> Update the proposal/disposition record to encode Q1–Q6 above, then produce bounded implementation slices against a new exact head. Runtime changes require fresh independent review on each exact implementation head before promotion. PR #57 remains docs-only/draft until its design record reflects this disposition; this comment does not authorize merge or deployment.

即：**本节就是该 resume condition 要求的那次「记录」**。在该记录落盘之前，PR #57 维持 docs-only / draft。

### 由本裁定随之解决的问题

§6 末尾留下的「F1 / F3 分类不对称属待确认项，不由本文单方收束」——Q1 既已裁定为 **per-logical-thread / per-Run 分槽**，按 §6 自己给出的判据，**F1 亦落入「#54 已蕴含」**，与 F3 同类。该不对称由此收束，Required delta 第 1、2 条正面覆盖了这两项。（本节由 Orchestrator 依裁定推得并记录，非 designer 原句。）
