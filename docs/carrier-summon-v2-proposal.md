# Carrier Summon V2 设计提案

> 状态：Research + Design proposal。epic designer 已裁定 **PARTIAL_ACCEPT**（2026-09-17，[PR #53 disposition](https://github.com/futouyiba/noos-shuttle/pull/53#issuecomment-5711118315)）；本文已按裁定的 11 项 required delta 改写，裁定原文存档见 §9。
>
> 研究 Issue：[noos-shuttle#52](https://github.com/futouyiba/noos-shuttle/issues/52)
>
> 本文只定义概念、边界和优先级；**不授权 V2 实现**，不改变已合并的 V1（Issue #44 → PR #47，merge `6a29178`）。

## 1. 摘要与已裁定结论

**Summon 已被裁定为 orchestration 层的操作族**（designer ruling 1），不是 Focus 的新名字，也不是自动执行入口。三者的关系按裁定固定为：

1. **Summon-Observe（P0，本切片的全部范围）**：跨 surface 找到、导航到并观察一个逻辑对象；不取得 lease、不改变 canonical binding、不发送 provider 输入。
2. **Focus / Navigate（下位效应）**：保持为显式的下位命令/效应，不因 Summon 的存在而改名或合并语义。
3. **Attach（单独授权的子协议，本切片不实现）**：可从 Summon 意图抵达，但不是普通 Summon 的自动终态；其执行侧归属按 ruling 4 落在既有 lease/rebind 机制，**明确禁止**写入 `CurrentConversationBinding`。

已裁定的交付顺序（ruling 6）：P0 = `SurfaceObjectRef`/provider adapter + 本地 carrier registry + Summon-Observe；反向可见性、意图上下文、队列收敛为 P0 证据之后的 follow-up；**多设备/profile 路由与一切 Attach 执行 defer 到后续切片**，且那时需要显式的 authority 测试。飞书、LLM Wiki 属通用 identity 边界建立之后的 adapter 工作，不得伪装成 conversation ref（ruling 6）。

## 2. 已冻结的 V1 基线（不可在本文重新裁定）

- 对话身份是 provider conversation identity；浏览器 tab 是 disposable carrier（`browser-tab:{id}`）。
- 观察者 tab 不持 lease；聚焦不是 actuation；「已定小决策（issue #44）」明确 focus 无需 lease。
- V1 的实际接受范围比派发任务书的保守描述更宽，需区分三层（见下方「范围澄清」）：**代码接受范围**是所有 `SUPPORTED_PROVIDER_HOSTS`（13 个 host，扩展与 Hub 各维护一份相同清单）上的 6 种 conversation 路由形态，含 `/c/`、`/chat/`、`/app/*/chat/`、`/u/N/c/`、`/g/<project>/c/<id>`、`/g/<project>/u/N/c/<id>`；**实际 dogfood 与验收范围**只覆盖 chatgpt.com；**尚无 provider-specific identity contract**，路由识别是启发式实现。
- Hub `GET /v1/focus/requests` + `POST /v1/focus/ack`：队列 TTL 600 秒、容量 32、内存态；扩展端纯函数匹配，多命中取最近活跃，未命中开观察 tab。传输为 5 秒轻轮询 + 30 秒 alarms 兜底。无跨设备、无多 profile。
- V1 的待办数据来自活跃 Vault handoff 投影；并未建立 canonical 待办存储。

**范围澄清（研究记录，designer 已确认为实现事实、非新设计决定）**：派发任务书把 V1 概括为「仅 chatgpt.com、仅 conversation ref」。对照已合并实现，该概括是**旧子集**：`src/shared/provider-identity.ts:1-15,33-40` 与 `apps/noos-hub/src-tauri/src/main.rs:376-390,494-520` 显示两端都已按 13 host 白名单和 6 种路由形态接受请求。本提案以代码事实为准，并在研究 Issue 上记录该措辞差异；这不构成对 V1 行为的改动。

证据：Issue #44 全文与验收评论；PR #47 merge 记录；[PR #47 review](https://github.com/futouyiba/noos-shuttle/pull/47#issuecomment-5705673584)。

## 3. 概念模型与语义边界

### 3.1 对象与现有关系的准确分层

实现层现有三组**彼此独立**的关系（不得混称）：

| 现有事实 | 定义位置 | 是否含 carrier | 归谁 |
| --- | --- | --- | --- |
| `CurrentConversationBinding`（logicalThreadId → providerConversationRef，带 generation/mutationAt） | `src/core/operational-state-reducer.ts:37-42` | **否** | Reducer canonical 事实 |
| `ActuationLease`（含 carrierRef、bindingGeneration、leaseGeneration、claimedBy） | 同文件 `:44-52` | 是 | Reducer，独立于 binding 的转移 |
| `WorkItemBinding`（可选 conversationId / carrierRef） | `src/core/work-item-inbox.ts:67-70` | 可选 | WorkItem 侧记录 |

即：**canonical binding 绑定的是逻辑线程与 provider 对话，不绑定浏览器 tab**；carrier 出现在 lease 与 work-item 记录上。V1 focus 全程没有触碰其中任何一个。

本提案引入并在裁定后固定的概念（ruling 2/3/4）：

| 概念 | 已裁定含义 | 权威归属 |
| --- | --- | --- |
| **SurfaceObjectRef** | V2 identity 抽象；canonical 身份保持 provider-owned 最小集：`surface/provider + object_kind + opaque object_id`。route 是 locator/context，除非该 provider 证明唯一性依赖它；`account_scope` 是选择/授权范围，**不得**由标题或 route 猜测，仅在某 provider 唯一性确实依赖账号范围时才提升为 identity | identity 层；不写 State Store |
| **CarrierAssociation** | **仅**观察性 registry 证据：非权威、可过期、不推进 binding generation、不授予 dispatch eligibility | carrier registry，非 canonical |
| **Attach** | 单独授权的子协议/效应，可从 Summon 意图抵达，但不是普通 Summon 的自动终态；**禁止**写入 `CurrentConversationBinding` | 见 §3.2 与 ruling 4 |

### 3.2 四个动词的严格含义

- **Summon（召回/召唤）**：orchestration 层的操作族（ruling 1），针对 logical identity 创建并推进一个协调请求：解析目标、选择候选 carrier、必要时打开或唤醒 carrier、报告结果。Summon 不蕴含 focus、navigate、attach 或 actuation 中任何一个后果；请求必须声明 mode（`observe` 或经授权的 `attach` 子协议），不能由 UI 文案推断。
- **Focus（聚焦）**：对**已存在**的 carrier 改变窗口/tab 的可见性或活动状态，是显式的下位效应而非 Summon 的同义词（ruling 1）。它只改变用户视角，不改变 URL 目标、不建立身份事实、不取得 lease。**注意**：V1 名为「查看对话」的产品命令是**复合动作**——命中时执行纯 Focus，未命中时执行 Open/Navigate（`src/core/carrier-focus.ts:106-123`、`src/background/focus-runtime.ts:54-63`）。因此 V1 命令整体映射为 `Summon-Observe` 复合操作（ruling 1），而不是纯 Focus 的特例；迁移时不得把未命中路径按纯 Focus 语义裁掉。
- **Navigate（导航）**：让 carrier 加载一个经过 allowlist 校验的目标 URL/route，同为下位效应而非 Summon 同义词。它可能改变 carrier 当前显示对象，但不自动宣称目标已稳定加载、已绑定或已可执行。跨 origin、登录墙、路由失败和未 commit 均应产生可观察状态，而非乐观成功。
- **Attach（附着）**：单独授权的子协议/效应（ruling 1、4）。**已裁定：拒绝将 carrier 写入 `CurrentConversationBinding`**——在现有模型下，对既有的 logical-thread/provider-conversation 绑定而言，Attach 是 **carrier 侧的关联/重绑定操作**：若需要执行归属，权威转移落在既有 lease/rebind 机制中，携带准确的 binding generation 并走常规 fencing；纯观察性关联则保持为 registry 证据。新 child logical thread 仍先走既有 spawn/adoption → canonical binding 路径，再获取 lease。**不得引入第二套 canonical carrier-binding ledger**（ruling 4）。本切片不实现 Attach 执行（ruling 6）。

### 3.3 Summon 在 Binding-Lease 与观察者模型中的正式位置

Summon 位于“请求/协调层”，其输出是状态机结果和观察证据；它不是 Binding Reducer 的替代品，也不是 Lease Manager。本切片（Observe）的状态最少包括：`REQUESTED → RESOLVING → CARRIER_SELECTED | CARRIER_OPENING → NAVIGATING? → OBSERVING → SUCCEEDED | EXPIRED | FAILED | NEEDS_USER`。`ATTACHED` 属被 defer 的 attach 子协议，本切片不产生该状态；将来它只能出现在独立授权与校验完成之后，且不落在 `CurrentConversationBinding` 上（ruling 4）。

- **Observe mode**：允许查询、Focus、Navigate、打开 disposable observer carrier、读取页面是否报告目标身份；不写 canonical binding，不持 lease，不触发 provider actuation。
- **Attach mode（子协议，本切片不实现）**：可从 Summon 意图抵达，但**不是**普通 Summon 的自动终态（ruling 1）。按 ruling 4，它不得写入 `CurrentConversationBinding`；需要执行归属时走既有 lease/rebind 机制并携带准确 binding generation 与常规 fencing，纯观察性关联留在 registry。任何 Attach 失败都不得回退成“看起来已绑定”。
- 观察者可以看到一个 run 的 carrier，但不能仅凭可见性成为 run carrier。观察者报告是 evidence，不是 authority。

### 3.4 与 BCR run carrier 的关系

BCR run 的 carrier 是执行上下文的一部分；普通 Summon 不应“召唤并接管”一个正在运行的 run carrier。

| 情形 | 语义 | 允许动作 |
| --- | --- | --- |
| 用户从 Hub 查看 run 对话 | 观察 | Summon-Observe → Focus/Navigate；无 lease、无 binding mutation、无 actuation |
| run 已终止，用户要重新查看历史 carrier | 观察 | 只读召回；carrier 可 disposable，不能据此恢复 run authority |
| run 处于可恢复/重绑定状态，用户明确请求继续 | 观察（本切片） | 只能观察；进入 rebind/attach 属后续切片，届时须校验 provider identity、binding generation、操作状态和授权，未完成前不得 dispatch |
| run 正在 GENERATING/有 in-flight operation | 高风险 | 只观察；**已裁定**：普通 Summon 可观察在飞 run，但不能迁移或接管其 carrier；在飞 carrier 迁移是 BCR 专有 rebind 协议，**在本 V2 切片之外**，需单独设计/审核（ruling 5） |
| 新 carrier 想承载一个新的 child run | 新 binding | 走既有 spawn/adoption → canonical binding 路径，然后才获取 lease；不能把 Summon 当作 spawn 的捷径，也不引入第二套 carrier-binding ledger（ruling 4） |

“Summon 自己的 carrier”只能表示 run owner 发起对其 carrier 的 observe 请求；它不代表 lease owner 获得了浏览器窗口控制权。执行操作仍需现有 BCR 的 lease、authority、dispatch fence 和 reconciliation 约束。

## 4. 身份、生命周期、权限与失败模型

### 4.1 身份层级（按 ruling 2 固定）

不再把所有目标编码成裸 `conversation_id`。canonical 身份保持 **provider-owned 最小集**：

```text
canonical identity = surface/provider + object_kind + opaque object_id
route            = locator/context（除非该 provider 证明唯一性依赖它）
account_scope    = 选择/授权范围，不得由标题或 route 猜测
```

- `object_kind` 例如 conversation、project-conversation、document、wiki-page；`object_id` 是 provider 拥有的 opaque 标识。
- **route 不默认进入 identity**：例如 ChatGPT `/g/<project>/c/<id>` 中的 project 是定位上下文，除非有证据表明同一 object_id 在不同 project 下会指向不同对象。
- **account_scope 不默认进入 identity 也不得猜测**：它只在某 provider 的唯一性确实依赖账号范围时才提升为 identity 的一部分（ruling 2）。
- 不可把 route/device/profile 这类偶然 runtime 事实默认塞进对象身份。相同 id 在不同 provider/account scope 不可自动合并；标题或 URL 形状的相似不构成身份匹配。

### 4.2 Carrier 记录

Carrier registry 只记录可发现的 runtime facts：`carrierRef`、device/profile scope、surface capabilities、observed object ref、lastSeen、visibility、navigation state、lease/owner projection。tab id 是 disposable；关闭、重启、profile 切换和登录失效都可使 carrier stale。

按 ruling 3，registry 是**非权威**的观察性证据：它不推进 binding generation、不授予 dispatch eligibility，也不得把“最后一次观察”升级为 canonical binding。registry 中的 lease/owner 字段只是投影，真源始终是 Reducer。

### 4.3 生命周期

- 请求 TTL 防止旧点击在未来驱动浏览器；单个 Summon 应有短于或不长于 V1 600 秒的 deadline，并在状态终止后不可重放。
- 请求 key 由 `intent + logical identity + target scope` 组成；相同 observe 请求合并，不能把一个 attach 请求与 observe 请求去重为同一操作。
- 每次跨设备/跨 profile 委派必须产生明确的 `targetScope`；无 scope 时只允许本地可见 carrier，不能随机挑账号。**注意**：跨设备/profile 路由本身按 ruling 6 defer，本切片不实现。
- 页面未 commit、登录态未知、目标被重定向、URL 未通过 allowlist、provider 报告身份与请求不符：均是 `NEEDS_USER` 或可重试的 `FAILED`，不是成功。
- 收敛不变量（ruling 9）：同一 live Summon-Observe identity 同时最多一个 **owned opening attempt**；恢复可重新发现/采纳已开启的匹配 carrier。不要求浏览器全局的 observer tab 唯一性；用户可见的重复 tab 属缺陷，不构成 authority 证据。

### 4.4 权限与安全不变量

1. Hub queue 只能由本地授权通道写入；扩展和每个 carrier adapter 都要做 origin/surface allowlist 二次校验。
2. Summon-Observe 不能发送文本、点击 provider 控件或启动 run；Navigate 只允许显式目标和受支持 surface。
3. Attach 是高权限状态变更（ruling 4）：不得写 canonical conversation binding；需要执行归属时经既有 lease/rebind 机制并携带准确 binding generation 与常规 fencing；必须绑定到明确 actor、授权理由和可回溯 operation id；失败关闭，不得静默降级。
4. 任何 UI 的“继续 run”文案都不能把 observe 请求升级为 attach；意图必须是结构化字段并在边界处重新验证。
5. 不能通过 URL、标题、DOM 中的提示语让外部 origin 或第三方页面驱动浏览器；不信任 carrier 页面中的指令文本。
6. 多设备池中以 capability + account scope 过滤，再以可解释的确定性排序选择；无安全匹配时宁可 `NEEDS_USER`，不跨账号猜测。

## 5. V2 能力候选：已裁定的交付顺序

以下顺序由 ruling 6 固定；「语义风险」列保留研究的风险评估，仅作实现时的注意项，不再是待裁定项。

| 裁定档位 | 能力 | 语义风险 | 裁定边界 |
| --- | --- | --- | --- |
| **P0（已接受为本切片）** | `SurfaceObjectRef` / provider adapter + 本地 carrier registry + Summon-Observe | 中 / 低-中 | 三者为一体接受（ruling 6）；identity 最小集与 registry 非权威性见 ruling 2、3 |
| **P0 conformance** | PR #47 残留 #1 的提取分叉收敛 | 中 | 收编进 P0 adapter conformance（ruling 7）：优先单一 canonical parser/contract 或共享 fixtures；实现选择本地，但两端须在受支持路由集上机械等价 |
| **Follow-up（P0 证据之后）** | 反向可见性（carrier → Hub）、意图上下文、队列收敛 | 中-高 / 高 / 中 | ruling 6：在 P0 证据之后再推进；队列收敛的不变量按 ruling 9 收窄 |
| **Deferred（本切片明确不授权）** | 多设备 / 多 profile carrier 路由；**一切 Attach 执行** | 高 / 极高 | ruling 6：defer 到后续切片，届时需显式 authority 测试；本文不为其背书 |
| **Adapter 工作（在通用 identity 边界之后）** | 飞书 surface、LLM Wiki surface | 高 | ruling 6：属 adapter 工作，不得伪装成 conversation ref；各自的对象种类与权限模型仍需单独设计 |
| **参考（非本切片）** | BCR 在飞 carrier 迁移 | 极高 | ruling 5：BCR 专有 rebind 协议，本 V2 切片之外，需单独设计/审核 |

### 5.1 为什么跨 provider 不是简单扩大 allowlist

V1 的 URL 提取已覆盖 13 host 与 6 种路由形态，但它是**扁平的启发式实现**：只产出裸 conversation id，不区分 provider、route 与 account scope。V2 需要 adapter 输出三种不同结果：`identity`（稳定对象身份）、`route`（项目/工作区上下文）、`carrier-observation`（页面实际报告的对象）。例如 `/g/<p>/c/<id>` 中 `<id>` 是 conversation identity、`<p>` 是 route scope——今天它靠正则巧合通过，没有契约保证；`/g/<gid>/p/<pid>/c/<id>` 这类多段路由当前**不匹配**（`src/shared/provider-identity.ts:38` 的 `[^/]+` 只吃一段），仓内也没有它存在于真实 ChatGPT 的证据。飞书文档可能有 token、space、node 三层身份；LLM Wiki 可能是本地 project + relative page。没有 adapter contract 前，跨 provider 只会把 URL 分叉和安全误匹配扩大。

### 5.2 意图是权限闸门，不是 UI 文案

- `inspect`：用户要“看这条待办”，允许召回、Focus、Navigate、观察。这是 P0 的唯一意图。
- `resume_run`：用户要“继续这个 run”，涉及 authority、lease、dispatch 及可能的 rebind；**本切片不授权**（ruling 6 的 defer 档）：Summon 最多创建待授权请求，不能执行，且不得隐式升级为 Attach。
- `attach_for_read` 之类的只读附着：其状态归属按 ruling 4 处理（不写 conversation binding；需要执行归属则走 lease/rebind），**执行实现 defer**，本切片不包含。

## 6. V1 → V2 迁移边界

### 保留不变

- `browser-tab:{id}` 仍是 disposable carrier ref；不能把 tab id 变成逻辑身份。
- Observe 不持 lease，Focus 不变成 actuation；V1 的白名单、token 鉴权、TTL/容量保护继续有效。
- V1「查看对话」作为**复合命令**保留：命中走 Focus，未命中走 Open/Navigate observer tab；两条分支都必须回报可区分的结果（如 `FOCUSED` / `OPENED_OBSERVER`），不能只报告笼统成功。

### 允许抽象化

- 将 `conversation ref` 包装为 `SurfaceObjectRef`，以兼容 provider conversation、project route 和非对话对象；保留 V1 payload 适配层和旧字段过渡期。
- 将 Focus queue 迁移为 Summon queue，但 V1 endpoint 可继续作为 observe-only facade，避免同时迁移 UI、扩展和 Hub。
- 将两端 URL 解析收敛到共享的 contract/test vectors；Rust/TS adapter 可各自实现，但必须通过同一组 accepted/rejected vectors（ruling 7）。
- ack/结果语义按 ruling 11 命名已达成的阶段（如 `observed` / `focused` / `navigation_committed`），不保留仅为命名锚点存在的 V1 compatibility kind。

### 明确不随 V2 Observe 迁移（含裁定为 defer 的项）

- 不把普通 Summon 变成 run spawn、dispatch、lease claim 或 authority transfer。
- 不自动将观察者 tab 提升为 canonical binding；不以“当前前台”推断用户授权。
- 不默认跨设备、跨 profile 或跨账号跳转；不从标题或 provider 页面文本猜 identity。
- 不把队列 ack 等同于 provider 已读、操作完成或 run 已继续。
- **不授权多设备/profile 路由与任何 Attach 执行**（ruling 6 defer；后续切片需显式 authority 测试）。
- **不设计 BCR 在飞 carrier 迁移**（ruling 5；BCR 专有 rebind 协议，切出本切片）。

## 7. PR #47 五条非阻塞残留的逐项处置（已裁定）

依据 [PR #47 review comment](https://github.com/futouyiba/noos-shuttle/pull/47#issuecomment-5705673584)，该评论的结论是 `REVIEW: APPROVE @ 6ecec825a55390264b6d5a85ec65455ebc68a2d2`，五条均为非阻塞。以下处置已由 designer 裁定（ruling 7–11），不回改 V1。

| # | review 原文摘要/定位 | 裁定结果 | 归属切片 |
| --- | --- | --- | --- |
| 1 | “两端 conversation ref 提取存在四个病态-URL 分叉点”：`+`、路径空段、默认端口、多重 percent 编码；正常 provider URL 一致，最坏为观察 tab/报错 | ACCEPT 进 P0 provider-adapter conformance：优先单一 canonical parser/contract 或共享 fixtures；实现选择本地，但两端须在受支持路由集上机械等价 | P0 |
| 2 | “前端 invoke 类型断言与 Tauri 运行时不符，Rust 端成功 message 不会显示”：文案降级、功能无损 | 归为 implementation-local P1 hygiene；**除非**返回 message 变成耐久/用户依赖的协议字段，否则不触发新设计裁定 | P1（实现自决） |
| 3 | “观察 tab 未 commit 窗口的理论重复开 tab”：ack 失败、请求正常、commit 慢于轮询时可能重复；下一轮收敛 | ACCEPT 为 P1 收敛要求，但**不变量收窄**：同一 live Summon-Observe identity 同时最多一个 *owned opening attempt*；恢复可重新发现/采纳已开的匹配 carrier；**不要求**浏览器全局唯一 observer tab；用户可见的重复 tab 是缺陷，不是 authority 证据 | P1 |
| 4 | “同一 poll 批次内 tabs 快照过时”：会重复调用幂等 activateTab，无害 | implementation-local：在不改变确定性选择/公平语义的前提下，允许刷新/重选，无需设计升级 | 实现自决 |
| 5 | “`CARRIER_FOCUS_ACK_KIND` 常量未接线”：轮询模型无消息 lane，仅为命名锚点 | **不**因 V1 有命名锚点而保留 compatibility kind；V2 ack/结果语义必须命名已达成的阶段（`observed` / `focused` / `navigation_committed` 等），不得暗示 Attach 或 authority；确切 wire enum 在状态/结果契约固定后属实现自决 | P1（契约固定后自决） |

## 8. 裁定索引、剩余开放项与实现自决

### 8.1 已裁定（designer ruling 1–11）

| # | 主题 | 裁定结论 | 详见 |
| --- | --- | --- | --- |
| 1 | Summon 命名与层次 | ACCEPT Summon 为 orchestration-level 操作族；Focus/Navigate 保持显式下位效应（非同义词）；Attach 为单独授权子协议、非自动终态；V1「查看对话」映射为 Summon-Observe 复合操作 | §3.2 |
| 2 | SurfaceObjectRef | ACCEPT 为 V2 identity 抽象，canonical 身份保持 provider-owned 最小集；route 为 locator/context；`account_scope` 不得猜测、仅在唯一性依赖它时提升 | §4.1 |
| 3 | CarrierAssociation | ACCEPT，但**仅**为观察性 registry 证据：非权威、可过期、不推进 binding generation、不授予 dispatch eligibility | §3.1 |
| 4 | Attach 归属 | **REJECT** 把 carrier 写入 `CurrentConversationBinding`；Attach 是 carrier 侧关联/重绑定，执行归属走既有 lease/rebind + 常规 fencing；新 child 仍走 spawn/adoption → canonical binding → lease；不得引入第二套 canonical carrier-binding ledger | §3.2、§3.4 |
| 5 | BCR / 在飞边界 | ACCEPT fail-closed：普通 Summon 可观察在飞 run，不得迁移/接管其 carrier；在飞迁移属 BCR 专有 rebind 协议，切出本切片 | §3.4 |
| 6 | 能力排序 | ACCEPT P0 = `SurfaceObjectRef`/provider adapter + 本地 carrier registry + Summon-Observe；follow-up = 反向可见性/意图上下文/队列收敛；**DEFER** 多设备-profile 路由与一切 Attach 执行；飞书/LLM Wiki 属 adapter 工作 | §5 |
| 7–11 | PR #47 五条残留 | 见 §7 表（conformance / implementation-local / 收敛不变量收窄 / 实现自决 / 不保留 compatibility kind） | §7 |

### 8.2 尚未裁定、仍开放的事项（不得当作已授权）

- **多设备/profile 路由**：trust、账号 scope、用户选择、carrier 抢占规则均未设计（ruling 6 defer）。
- **Attach 执行细节**：ruling 4/5 只固定了归属与禁止项（不写 conversation binding、不得接管在飞 carrier、不得第二套 ledger），授权流程与 BCR rebind 细节未设计。
- **飞书 / LLM Wiki**：ruling 6 只定性为 adapter 工作，object kinds 与权限模型未定。
- **队列语义细节**：优先级、合并、取消、重试未裁；ruling 9 只固定了收窄后的收敛不变量。
- **ack 结果枚举**：ruling 11 固定了命名原则（命名已达成的阶段），具体 wire enum 待状态/结果契约固定后由实现决定。
- **normalization canonical owner**：ruling 7 允许实现选择本地实现或共享 fixtures；是否另立 authority 文档承载 vectors 未裁定。

### 8.3 实现阶段可自行决定（不改变契约时）

- adapter 内部解析器的语言/模块结构，只要通过共同 vectors、allowlist 和 fail-closed 测试，且两端在受支持路由集上机械等价（ruling 7）。
- 队列数据结构、锁和内存清理方式，只要不改变既有的 TTL、容量、幂等和失败语义。
- UI 的按钮布局、加载/失败文案的具体措辞（不把 observe 显示为 attach/resume）。
- metrics/log 字段名与 trace 关联方式，只要不把日志当 canonical truth。
- pending opening 的实现细节，在 ruling 9 的收窄不变量内（同一 identity 同时最多一个 owned opening attempt）。
- PR #47 残留 #2、#4 的修复方式（ruling 8、10）。

## 9. Designer 裁定原文存档

**交付来源（provenance）**：epic designer 裁定经 GitHub 评论交付，落于 [PR #53 comment 5711118315](https://github.com/futouyiba/noos-shuttle/pull/53#issuecomment-5711118315)（2026-09-17T08:08:14Z，`futouyiba`，即本仓工作流的 ChatGPT-侧人类/connector 边界），exact target `bd3c7af4c86373b1f5bfcf666101d7949b5b0b71`，对应 design 请求评论 `5710970964`、研究权威 Issue #52。

**格式说明（研究记录）**：该评论以标题形式给出（`## Primary Design Disposition` + `**Decision:** PARTIAL_ACCEPT`），**未**采用附录 B.3 的严格标记语法（首行 `DESIGN: <verdict>` + provenance 次行）。本文按「原文存档」处理其内容，标记合规性与合并门禁判定留给 integrator 按 §4.2/B.3 处置；本文不代其裁定。

以下为裁定原文逐字引用（决定性表述不转述、不改写）：

> **Exact target:** PR #53 @ `bd3c7af4c86373b1f5bfcf666101d7949b5b0b71`; proposal `docs/carrier-summon-v2-proposal.md`; design request comment `5710970964`; research authority Issue #52.
>
> **Decision:** PARTIAL_ACCEPT
>
> **Rationale:** The proposal correctly separates the already-merged V1 facts from proposed V2 semantics. In particular, the correction that `CurrentConversationBinding` does not contain a carrier is an implementation fact, not a new design decision; carrier ownership currently lives in lease/work-item layers. The V1 “查看对话” command is also correctly treated as a composite Focus-or-Open/Navigate behavior, so the whole command may be generalized without redefining pure Focus. The narrow V2 direction is accepted, but Attach must not be collapsed into either canonical conversation binding or ordinary Summon completion: that would silently change existing binding/lease authority semantics.
>
> **Required delta / designer rulings:**
>
> 1. **Summon naming:** ACCEPT `Summon` as the orchestration-level operation family. `Focus` and `Navigate` remain explicit lower-level effects/commands, not synonyms. `Attach` is a separately authorized sub-protocol/effect reachable from a Summon intent, not an automatic terminal step of ordinary Summon. V1 “查看对话” maps to `Summon-Observe` as a composite operation.
> 2. **SurfaceObjectRef:** ACCEPT as a V2 identity abstraction, but keep the minimal canonical identity provider-owned: `surface/provider + object_kind + opaque object_id`. Project/workspace route is locator/context unless the provider proves it is required for uniqueness. `account_scope` is a selection/authority scope and MUST NOT be guessed from title/route; promote it into identity only for a provider where uniqueness actually depends on account scope. Do not make route/device/profile incidental runtime facts part of object identity by default.
> 3. **CarrierAssociation:** ACCEPT as observational registry evidence only. It is non-authoritative, may become stale, does not increment binding generation, and cannot grant dispatch eligibility.
> 4. **Attach placement:** REJECT “write carrier into `CurrentConversationBinding`” under the current model. For an existing logical-thread/provider-conversation binding, Attach is a carrier-side association/rebind operation. If execution ownership is required, the authoritative transition belongs in the existing lease/rebind machinery with the exact binding generation and normal fencing; observation-only association remains registry evidence. A new child logical thread still uses the existing spawn/adoption → canonical binding path first, then lease acquisition. Do not introduce a second canonical carrier-binding ledger.
> 5. **BCR/in-flight boundary:** ACCEPT the proposal’s fail-closed rule. Ordinary Summon may observe an in-flight run but cannot migrate/take over its carrier. Any in-flight carrier migration is a BCR-specific rebind protocol and remains out of this V2 slice until separately designed/reviewed.
> 6. **Capability ordering:** ACCEPT `SurfaceObjectRef/provider adapter + local carrier registry + Summon-Observe` as P0. Accept reverse visibility / intent context / queue convergence work as follow-up after P0 evidence. DEFER multi-device/profile routing and all Attach execution to a later slice with explicit authority tests. Feishu/LLM-Wiki support is adapter work after the generic identity boundary exists; do not fake them as conversation refs.
> 7. **PR #47 residual #1 (path/ref extraction divergence):** ACCEPT into P0 provider-adapter conformance. Prefer one canonical parser/contract or shared fixtures; implementation choice is local provided both sides are mechanically equivalent for the supported route set.
> 8. **Residual #2 (Tauri invoke return typing):** ACCEPT as implementation-local P1 hygiene. No new design ruling unless the returned message becomes a durable/user-relied protocol field.
> 9. **Residual #3 (pending observer duplicate opening):** ACCEPT as a P1 convergence requirement, but keep the invariant narrow: for one live Summon-Observe identity there must be at most one *owned opening attempt* at a time; recovery may rediscover/adopt an already-open matching carrier. Do not require global browser-wide uniqueness of observer tabs. User-visible duplicate tabs are a defect, not authority evidence.
> 10. **Residual #4 (stale batch tab snapshot):** implementation-local. Refresh/reselection is allowed without design escalation while deterministic selection/fairness semantics are unchanged.
> 11. **Residual #5 (`CARRIER_FOCUS_ACK_KIND`):** do not preserve a compatibility kind merely because V1 has a naming anchor. V2 ack/result semantics must name the achieved stage (`observed`/`focused`/`navigation_committed` etc.) rather than imply Attach or authority. Exact wire enum is implementation-local once the state/result contract is fixed.
>
> **Boundary / non-goals:** This disposition does not authorize V2 implementation, does not modify V1, does not create cross-device execution authority, does not design BCR carrier migration, and does not promote browser/runtime observations into canonical binding truth. It also does not require changes to `noos_docs` in this Work Item.
>
> **Resume condition:** Update the proposal at a new head so the above rulings are stated as designer decisions rather than open alternatives; remove any remaining implication that Attach may mutate `CurrentConversationBinding`; keep deferred multi-device/profile and BCR migration explicitly non-authorized; then obtain a fresh isolated review on that exact head. After that review, this docs-only proposal may be considered for promotion/merge under the normal exact-head gate. Issue #52 remains open until the reviewed design-proposal deliverable is merged; no implementation child should be auto-started by this disposition.

**Resume condition 的满足状态**：本文已在**新 head**上把上述 ruling 表述为已裁定结论（§1、§3、§5、§7、§8.1），移除任何「Attach 可能写 `CurrentConversationBinding`」的暗示（§3.1、§3.2、§3.4、§4.4），并把多设备/profile 与 BCR 迁移显式标为非授权（§5、§6、§8.2）；随后需在本 PR 的新 head 上取得独立复审。

## 10. 领域术语表（中英文）

| English | 中文 | 本提案中的限定含义 |
| --- | --- | --- |
| Carrier | 载体 | 承载 surface object 的 runtime 表面；浏览器 tab 可 disposable，不能替代逻辑身份 |
| Carrier pool / registry | 载体池 / 载体登记表 | 设备、profile、surface 能力和最近观察等 runtime facts 的集合，不是 canonical binding |
| Surface | 表面 / 平台表面 | 可承载对象的 provider 或本地应用边界，如 ChatGPT、飞书、LLM Wiki |
| Surface object | 表面对象 | surface 内可定位的对象；可为 conversation、project-conversation、document、wiki-page |
| Logical identity | 逻辑身份 | 稳定、可寻址的对象身份；不等于 URL、tab id、标题或窗口 |
| Provider conversation identity | Provider 对话身份 | provider 拥有的 opaque conversation id；必须带 provider/scope 语境，不能全局裸用 |
| Route context | 路由上下文 | project/workspace 等定位上下文；例如 `/g/<p>/c/<id>` 中的 project 不吞并 conversation id |
| Summon | 召回 / 召唤 | orchestration 层的操作族（ruling 1）；请求必须声明 observe 或 attach 子协议，不蕴含 focus/navigate/attach/actuation 任何后果 |
| Focus | 聚焦 | 显式下位效应（非 Summon 同义词）：改变现有 carrier 的可见/活动状态；不导航、不绑定、不拿 lease |
| Navigate | 导航 | 显式下位效应（非 Summon 同义词）：让 carrier 加载已校验的 URL/route；不宣称加载完成、身份稳定或已绑定 |
| Observe / observer | 观察 / 观察者 | 读取 carrier 与对象状态的证据；不取得 lease，不拥有 actuation authority |
| Attach | 附着 | 单独授权的子协议（ruling 1、4）：carrier 侧关联/重绑定；**禁止**写 `CurrentConversationBinding`；需要执行归属时走既有 lease/rebind；不因导航或可见性自动发生 |
| Binding | 绑定 | Reducer 持有的 logical thread–provider conversation canonical 关系；**不含 carrier**（carrier 在 lease 上） |
| Binding generation | 绑定代次 | `CurrentConversationBinding.generation`；只能单调推进，是 run/dispatch 的 fence 之一 |
| Carrier association | 载体关联 | **仅**观察性 registry 证据（ruling 3）：非权威、可过期、不推进 binding generation、不授予 dispatch eligibility |
| Owned opening attempt | 归属开启尝试 | ruling 9 的收敛不变量单位：同一 live Summon-Observe identity 同时最多一个；恢复可采纳已开的匹配 carrier，但不要求浏览器全局唯一 |
| Lease | 租约 | 对 carrier 的执行控制权（`ActuationLease` 持有 `carrierRef` 与 `bindingGeneration`）；独立于 binding，不由 Observe 自动产生 |
| Actuation | 执行驱动 | 向 provider 页面输入、提交或驱动 run 的动作；Summon-Observe 明确禁止 |
| Authority / SubmissionAuthority | 执行授权 | 允许某次提交的gate 上下文（generation、explicit go、carrier READY 等）；与 binding、lease 分列 |
| Dispatch fence | 派发围栏 | 派发前校验 generation/owner 一致性的门禁；不匹配即拒绝，不降级 |
| BCR (Bounded Continuation Run) | 有界连续运行 | 受预算、in-flight、binding generation、lease/authority 和 reconciliation 约束的 run |
| Rebinding (`REBIND`) | 重绑定 | BCR 轮间把 run 重钉到同一对话的新 binding generation；不是普通 Summon 的隐式后果 |
| Intent | 意图 | 结构化请求目的，如 `inspect` 或 `resume_run`；不是可忽略的按钮文案 |
| targetScope | 目标范围 | 请求允许落在哪个 device/profile/account；缺省只允许本地可见 carrier |
| Adapter | 适配器 | 每个 surface 的 identity/route/observation 解析实现；须通过共同测试向量 |
| Presence / last-seen | 在线/最近可见 | carrier 的 runtime 观察事实；不等于 provider 已读、run 完成或用户授权 |
| Ack | 确认 / 消费确认 | transport 对请求处理状态的记录；不等于已读、导航完成、绑定成功或 run 继续 |
| `OPENED_OBSERVER` | 已开观察 tab | 未命中时的结果状态；须与 `FOCUSED` 等可区分，不得笼统报成功 |
| Needs user | 需要用户介入 | 身份、账号、授权或导航结果不足以安全自动收敛时的显式终态 |
| Provenance | 溯源 | 谁在何处、对哪个 exact head/authority 作出的结论；标记与裁定必须可回溯 |

## 11. 研究证据与 provenance

### Dispatch / authorization

- 来源：Integrator 会话经跨会话消息派发 Carrier Summon V2 研究；用户在本 Research + Design proposal 会话明确授权研究立项。
- 持久记录：[Issue #52 开工声明](https://github.com/futouyiba/noos-shuttle/issues/52)；分支 `research/carrier-summon-v2`，基于当前工作区 HEAD `570331278f54d5c54d00771c03d5f1302aa6bb72`。
- 本文不构成 merge、deploy 或关闭 issue 授权。

### Authority / contract

- [noos_docs `docs/agent-workflow.md`](https://raw.githubusercontent.com/futouyiba/noos_docs/4ec76f6007d6e9974cb233c7ca0cc2a47815be27/docs/agent-workflow.md)，默认分支 `main`，读取 SHA `4ec76f6007d6e9974cb233c7ca0cc2a47815be27`，v0.3.1。
- 仓库 [AGENTS.md](../AGENTS.md)：任务隔离、review exact head、designer 原文裁定和 integrator 纪律。
- [manual-handoff-baseline.md](deliberation-harness/manual-handoff-baseline.md)：当前实际 dogfood 流程、角色/授权/观察与 lease 证据（研究方法基线，不是本提案新增契约）。

### Design disposition

- epic designer 裁定 **PARTIAL_ACCEPT**（2026-09-17T08:08:14Z）：[PR #53 comment 5711118315](https://github.com/futouyiba/noos-shuttle/pull/53#issuecomment-5711118315)，exact target `bd3c7af4c86373b1f5bfcf666101d7949b5b0b71`；原文存档见 §9，格式合规性由 integrator 判定。
- 本次改稿（fix 轮）针对该裁定的 11 项 required delta；被审 head 见 PR body。

### Review history

- 首轮独立只读 review（fable，隔离上下文）：REQUEST_CHANGES，4×P1 + 2×P2，见 [PR #53 comment 5710967872](https://github.com/futouyiba/noos-shuttle/pull/53#issuecomment-5710967872) 内的记录。
- 增量复审：APPROVE @ `bd3c7af`，委派记录 `5710966225` 先于 verdict；证据同上评论。
- provenance 补注（两轮为独立执行上下文、未借用第三方未复核结论）：`5710978833`。

### V1 implementation evidence（immutable refs）

- Issue #44：开工 `#issuecomment-5705296177`；实现 `IMPLEMENTED: PR#47` `#issuecomment-5705676912`；验收复查（含 merge `6a29178`、双侧部署与 fail-closed 验证）`#issuecomment-5705811711`。
- PR #47：被审 exact head `6ecec825a55390264b6d5a85ec65455ebc68a2d2`；委派记录 `#issuecomment-5705598192`；review 结论 `#issuecomment-5705673584`；merge record（merge `6a29178`，post-merge 484/484 + smoke 28/28 + cargo 49/49）`#issuecomment-5705808490`。
- 指定 review 评论内容已逐条引用，见 §7；五条均为非阻塞，`REVIEW: APPROVE` 为当时结论。
- 代码证据：[provider-identity.ts](../src/shared/provider-identity.ts)、[carrier-focus.ts](../src/core/carrier-focus.ts)、[focus-runtime.ts](../src/background/focus-runtime.ts)、[operational-state-reducer.ts](../src/core/operational-state-reducer.ts)、[work-item-inbox.ts](../src/core/work-item-inbox.ts)、[spawn-runtime.ts](../src/background/spawn-runtime.ts)、[work.ts](../apps/noos-hub/src/pages/work.ts)、[main.rs](../apps/noos-hub/src-tauri/src/main.rs)。
- 不可复现项：`#44` 的「数据链路核实说明」与部署细节依赖当时本地环境；本提案只引用其线程文本，不重新验证部署。

## 12. 明确非目标

按裁定 Boundary / non-goals：本文**不授权 V2 实现**、不修改 V1、不建立跨设备执行权威、不设计 BCR carrier 迁移、不把 browser/runtime 观察提升为 canonical binding truth，也不要求在本 Work Item 内改动 `noos_docs`。

此外：本文不修 PR #47 残留（其处置见 §7 的裁定映射）、不替 designer 作最终裁定、不自行判定标记格式合规性，也不 merge/deploy/关闭任何 issue。
