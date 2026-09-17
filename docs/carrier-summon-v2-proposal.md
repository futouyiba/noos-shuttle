# Carrier Summon V2 设计提案（Draft）

> 状态：Research + Design proposal，等待 epic designer 裁定；不包含实现承诺。
>
> 研究 Issue：[noos-shuttle#52](https://github.com/futouyiba/noos-shuttle/issues/52)
>
> 本文只提案概念、边界和优先级，不改变已合并的 V1（Issue #44 → PR #47，merge `6a29178`）。

## 1. 摘要与建议结论

建议把 **Summon** 定义为“将一个已知的逻辑对象请求投影到一个可用 carrier 的协调操作”，而不是 Focus 的新名字，也不是自动执行入口。V2 应分两层：

1. **Summon-Observe（P0）**：跨 provider 找到、导航到并观察一个逻辑对象；等价于 V1 Focus 的泛化，默认不取得 lease、不改变 binding、不发送 provider 输入。
2. **Summon-Attach（P1，必须单独授权）**：在明确的 binding/lease 规则和用户意图下，把 carrier 纳入某个操作的可执行上下文；这不是导航的自然后果，必须有独立状态、审计和失败语义。

推荐交付顺序：先做统一的 provider identity + carrier registry 与观察型队列，再做反向可见性和意图上下文，最后才评估跨设备/profile 选择和 Attach。飞书、LLM Wiki 等非“provider conversation”表面可纳入 Summon，但应以 **surface object** 适配器建模，不能强行伪装成 V1 的 conversation ref。

## 2. 已冻结的 V1 基线（不可在本文重新裁定）

- 对话身份是 provider conversation identity；浏览器 tab 是 disposable carrier（`browser-tab:{id}`）。
- 观察者 tab 不持 lease；聚焦不是 actuation；「已定小决策（issue #44）」明确 focus 无需 lease。
- V1 的实际接受范围比派发任务书的保守描述更宽，需区分三层（见下方「范围澄清」）：**代码接受范围**是所有 `SUPPORTED_PROVIDER_HOSTS`（13 个 host，扩展与 Hub 各维护一份相同清单）上的 6 种 conversation 路由形态，含 `/c/`、`/chat/`、`/app/*/chat/`、`/u/N/c/`、`/g/<project>/c/<id>`、`/g/<project>/u/N/c/<id>`；**实际 dogfood 与验收范围**只覆盖 chatgpt.com；**尚无 provider-specific identity contract**，路由识别是启发式实现。
- Hub `GET /v1/focus/requests` + `POST /v1/focus/ack`：队列 TTL 600 秒、容量 32、内存态；扩展端纯函数匹配，多命中取最近活跃，未命中开观察 tab。传输为 5 秒轻轮询 + 30 秒 alarms 兜底。无跨设备、无多 profile。
- V1 的待办数据来自活跃 Vault handoff 投影；并未建立 canonical 待办存储。

**范围澄清（研究新增，非裁定）**：派发任务书把 V1 概括为「仅 chatgpt.com、仅 conversation ref」。对照已合并实现，该概括是**旧子集**：`src/shared/provider-identity.ts:1-15,33-40` 与 `apps/noos-hub/src-tauri/src/main.rs:376-390,494-520` 显示两端都已按 13 host 白名单和 6 种路由形态接受请求。本提案以代码事实为准，并在研究 Issue 上记录该措辞差异；这不构成对 V1 行为的改动。

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

本提案拟新增的概念（**待 designer 裁定，不是既有事实**）：

| 拟新增 | 定义 | 变更影响 |
| --- | --- | --- |
| **SurfaceObjectRef** | 跨 surface 的逻辑身份描述（见 §4.1） | 仅 identity 层，不写 State Store |
| **CarrierAssociation** | carrier 当前承载某 surface object 的**观察性**关联（registry 内） | 不写 canonical binding、不影响 generation |
| **Attach** | 把已验证 carrier 与 logical identity 或 run 建立的**状态性**关联 | 是否写 canonical binding、写哪一层，见 §8 待裁定 |

### 3.2 四个动词的严格含义

- **Summon（召回/召唤）**：创建并推进一个针对 logical identity 的协调请求：解析目标、选择候选 carrier、必要时打开或唤醒 carrier、报告结果。Summon 是 orchestration surface，不蕴含 focus、navigate、attach 或 actuation 中任何一个后果；请求必须声明 mode（`observe` 或经授权的 `attach`），不能由 UI 文案推断。
- **Focus（聚焦）**：对**已存在**的 carrier 改变窗口/tab 的可见性或活动状态。它只改变用户视角，不改变 URL 目标、不建立身份事实、不取得 lease。**注意**：V1 名为「查看对话」的产品命令是**复合动作**——命中时执行纯 Focus，未命中时执行 Open/Navigate（`src/core/carrier-focus.ts:106-123`、`src/background/focus-runtime.ts:54-63`）。因此 V1 命令整体映射为 V2 的 Summon-Observe，而不是纯 Focus 的特例；迁移时不得把未命中路径按纯 Focus 语义裁掉。
- **Navigate（导航）**：让 carrier 加载一个经过 allowlist 校验的目标 URL/route。它可能改变 carrier 当前显示对象，但不自动宣称目标已稳定加载、已绑定或已可执行。跨 origin、登录墙、路由失败和未 commit 均应产生可观察状态，而非乐观成功。
- **Attach（附着）**：将一个已验证的 carrier 与 logical identity 或某项 run 建立状态性关联，使其成为后续操作可引用的 carrier。Attach 是状态改变，不是 Focus/Navigate 的副作用；Attach 也不自动授予 actuation lease。**由于现有 canonical binding 不含 carrier（§3.1），Attach 究竟写哪一层——新开 carrier 关联、更新 `ActuationLease.carrierRef`、还是维持观察性 CarrierAssociation——必须由 designer 裁定**。若 attach 目标是正在运行的 BCR run，必须经过该 run 的专门 rebind/lease 规则，不能由普通 Summon 隐式完成。

### 3.3 Summon 在 Binding-Lease 与观察者模型中的正式位置

Summon 位于“请求/协调层”，其输出是状态机结果和观察证据；它不是 Binding Reducer 的替代品，也不是 Lease Manager。建议状态最少包括：`REQUESTED → RESOLVING → CARRIER_SELECTED | CARRIER_OPENING → NAVIGATING? → OBSERVING → SUCCEEDED | EXPIRED | FAILED | NEEDS_USER`。`ATTACHED` 只能出现在 mode=attach 且独立授权与校验完成之后。

- **Observe mode**：允许查询、Focus、Navigate、打开 disposable observer carrier、读取页面是否报告目标身份；不写 canonical binding，不持 lease，不触发 provider actuation。
- **Attach mode**：允许在明确的 owner、目标 generation、carrier capability 和用户授权条件下**提出** Attach 请求；提交什么状态（canonical binding / lease / 仅 CarrierAssociation）按 §8 裁定执行，且只有 Reducer 能改 canonical 状态，之后 lease 仍须独立 claim。任何 Attach 失败都不得回退成“看起来已绑定”。
- 观察者可以看到一个 run 的 carrier，但不能仅凭可见性成为 run carrier。观察者报告是 evidence，不是 authority。

### 3.4 与 BCR run carrier 的关系

BCR run 的 carrier 是执行上下文的一部分；普通 Summon 不应“召唤并接管”一个正在运行的 run carrier。

| 情形 | 语义 | 允许动作 |
| --- | --- | --- |
| 用户从 Hub 查看 run 对话 | 观察 | Summon-Observe → Focus/Navigate；无 lease、无 binding mutation、无 actuation |
| run 已终止，用户要重新查看历史 carrier | 观察 | 只读召回；carrier 可 disposable，不能据此恢复 run authority |
| run 处于可恢复/重绑定状态，用户明确请求继续 | Attach 候选 | 进入独立 rebind/attach 流程；校验 provider identity、binding generation、操作状态和授权；未完成前不得 dispatch |
| run 正在 GENERATING/有 in-flight operation | 高风险 | 默认只观察；禁止普通 Summon Attach；如确需迁移，必须由 BCR 专门协议和 designer 裁定 |
| 新 carrier 想承载一个新的 child run | 新 binding | 走 spawn/adoption 两阶段：先 provisional carrier，待稳定 provider identity 后才 bind；不能把 Summon 当作 spawn 的捷径 |

“Summon 自己的 carrier”只能表示 run owner 发起对其 carrier 的 observe 请求；它不代表 lease owner 获得了浏览器窗口控制权。执行操作仍需现有 BCR 的 lease、authority、dispatch fence 和 reconciliation 约束。

## 4. 身份、生命周期、权限与失败模型

### 4.1 身份层级

建议不再把所有目标编码成 `conversation_id`。采用可扩展的 `SurfaceObjectRef`：

```text
surface = chatgpt | claude | feishu | llm-wiki | ...
object_kind = conversation | project-conversation | document | wiki-page | ...
object_id = provider-owned opaque identifier
route = optional provider/project/workspace route, normalized but not guessed
account_scope = optional profile/device/account binding, never inferred from title
```

`object_id` 是 opaque；route（例如 ChatGPT `/g/<project>/c/<id>`）是定位上下文，不应覆盖 conversation identity。相同 id 在不同 provider/account scope 不可自动合并。标题、URL path 的任意相似不构成身份匹配。

### 4.2 Carrier 记录

Carrier registry 只记录可发现的 runtime facts：`carrierRef`、device/profile scope、surface capabilities、observed object ref、lastSeen、visibility、navigation state、lease/owner projection。tab id 是 disposable；关闭、重启、profile 切换和登录失效都可使 carrier stale。registry 不应把“最后一次观察”升级为 canonical binding。

### 4.3 生命周期

- 请求 TTL 防止旧点击在未来驱动浏览器；单个 Summon 应有短于或不长于 V1 600 秒的 deadline，并在状态终止后不可重放。
- 请求 key 由 `intent + logical identity + target scope` 组成；相同 observe 请求合并，不能把一个 attach 请求与 observe 请求去重为同一操作。
- 每次跨设备/跨 profile 委派必须产生明确的 `targetScope`；无 scope 时只允许本地可见 carrier，不能随机挑账号。
- 页面未 commit、登录态未知、目标被重定向、URL 未通过 allowlist、provider 报告身份与请求不符：均是 `NEEDS_USER` 或可重试的 `FAILED`，不是成功。

### 4.4 权限与安全不变量

1. Hub queue 只能由本地授权通道写入；扩展和每个 carrier adapter 都要做 origin/surface allowlist 二次校验。
2. Summon-Observe 不能发送文本、点击 provider 控件或启动 run；Navigate 只允许显式目标和受支持 surface。
3. Attach 是高权限写操作：必须绑定到明确 actor、target binding generation、授权理由和可回溯 operation id；失败关闭，不得静默降级。
4. 任何 UI 的“继续 run”文案都不能把 observe 请求升级为 attach；意图必须是结构化字段并在边界处重新验证。
5. 不能通过 URL、标题、DOM 中的提示语让外部 origin 或第三方页面驱动浏览器；不信任 carrier 页面中的指令文本。
6. 多设备池中以 capability + account scope 过滤，再以可解释的确定性排序选择；无安全匹配时宁可 `NEEDS_USER`，不跨账号猜测。

## 5. V2 能力候选：价值排序与语义风险

评分：价值为用户收益与 V1 覆盖增量；风险为对 identity/binding/lease/actuation 语义的扰动（低/中/高）。排序是建议，不是 designer 裁定。

| 优先级 | 能力 | 价值 | 语义风险 | 建议范围与闸门 |
| --- | --- | --- | --- | --- |
| P0 | 统一 SurfaceObjectRef + provider adapter | 很高 | 中 | 先定义 identity contract；ChatGPT project route 作为 route context；不扩张到 attach |
| P0 | Summon-Observe 队列（V1 Focus 的兼容投影） | 很高 | 低-中 | `mode=observe` 显式化；保留 V1 API/行为兼容层；ack 携状态而非只表示“处理过” |
| P1 | 意图上下文：`inspect`（看这条待办） vs `resume_run`（请求继续 run） | 很高 | 高 | 只允许 inspect 走 Observe；resume_run 先返回需要授权/设计裁定，禁止隐式 Attach |
| P1 | 反向可见性：carrier → Hub | 高 | 中-高 | 先做 presence/last-seen 与用户显式“已读”事件；“已读”不是 provider 事实，不得自动改变 run 状态 |
| P1 | 队列优先级、合并、去重 | 中-高 | 中 | key 必须含 mode、identity、scope；attach/observe 绝不互并；公平性和过期策略需定案 |
| P2 | ChatGPT project route `/g/<p>/c/<id>` | 中-高 | 中 | 不是「首次支持」——V1 正则已能匹配并提取裸 id（`provider-identity.ts:38`）；V2 的价值在于把 route scope 显式化为独立字段并覆盖多段路由；project scope 与 conversation identity 分栏存储 |
| P2 | 飞书 surface（任务/文档/知识库） | 中-高 | 高 | 先选择对象种类和权限模型；不要称为 provider conversation；URL 导航与文档编辑必须分离 |
| P2 | LLM Wiki surface | 中-高 | 高 | 先定义本地 project/page identity、窗口 carrier 和读写权限；不把 wiki 查询/编辑视为 provider actuation |
| P3 | 多设备 / 多 profile carrier pool | 高（成熟后） | 高 | 需要设备在线、用户授权、account scope 和抢占/租约设计；默认只列候选、不自动跨设备 |
| P3 | Attach / run rebind | 潜在很高 | 极高 | 独立 proposal 和 BCR 设计；本提案只定语义边界，不建议随 V2 Observe 一并实现 |

### 5.1 为什么跨 provider 不是简单扩大 allowlist

V1 的 URL 提取已覆盖 13 host 与 6 种路由形态，但它是**扁平的启发式实现**：只产出裸 conversation id，不区分 provider、route 与 account scope。V2 需要 adapter 输出三种不同结果：`identity`（稳定对象身份）、`route`（项目/工作区上下文）、`carrier-observation`（页面实际报告的对象）。例如 `/g/<p>/c/<id>` 中 `<id>` 是 conversation identity、`<p>` 是 route scope——今天它靠正则巧合通过，没有契约保证；`/g/<gid>/p/<pid>/c/<id>` 这类多段路由当前**不匹配**（`src/shared/provider-identity.ts:38` 的 `[^/]+` 只吃一段），仓内也没有它存在于真实 ChatGPT 的证据。飞书文档可能有 token、space、node 三层身份；LLM Wiki 可能是本地 project + relative page。没有 adapter contract 前，跨 provider 只会把 URL 分叉和安全误匹配扩大。

### 5.2 意图是权限闸门，不是 UI 文案

- `inspect`：用户要“看这条待办”，允许召回、Focus、Navigate、观察。
- `resume_run`：用户要“继续这个 run”，涉及 authority、lease、dispatch 及可能的 rebind；Summon 只能创建待授权请求，不能执行。
- `attach_for_read`（可选）：把 carrier 作为读取上下文，但仍不赋予 actuation；是否写 binding 需 designer 定义。

## 6. V1 → V2 迁移边界

### 保留不变

- `browser-tab:{id}` 仍是 disposable carrier ref；不能把 tab id 变成逻辑身份。
- Observe 不持 lease，Focus 不变成 actuation；V1 的白名单、token 鉴权、TTL/容量保护继续有效。
- V1「查看对话」作为**复合命令**保留：命中走 Focus，未命中走 Open/Navigate observer tab；两条分支都必须回报可区分的结果（如 `FOCUSED` / `OPENED_OBSERVER`），不能只报告笼统成功。

### 允许抽象化

- 将 `conversation ref` 包装为 `SurfaceObjectRef`，以兼容 provider conversation、project route 和非对话对象；保留 V1 payload 适配层和旧字段过渡期。
- 将 Focus queue 迁移为 Summon queue，但 V1 endpoint 可继续作为 observe-only facade，避免同时迁移 UI、扩展和 Hub。
- 将两端 URL 解析收敛到共享的 contract/test vectors；Rust/TS adapter 可各自实现，但必须通过同一组 accepted/rejected vectors。

### 明确不随 V2 Observe 迁移

- 不把普通 Summon 变成 run spawn、dispatch、lease claim 或 authority transfer。
- 不自动将观察者 tab 提升为 canonical binding；不以“当前前台”推断用户授权。
- 不默认跨设备、跨 profile 或跨账号跳转；不从标题或 provider 页面文本猜 identity。
- 不把队列 ack 等同于 provider 已读、操作完成或 run 已继续。

## 7. PR #47 五条非阻塞残留的逐项处置

依据 [PR #47 review comment](https://github.com/futouyiba/noos-shuttle/pull/47#issuecomment-5705673584)，该评论的结论是 `REVIEW: APPROVE @ 6ecec825a55390264b6d5a85ec65455ebc68a2d2`，五条均为非阻塞；以下是 V2 研究处置，不回改 V1。

| # | review 原文摘要/定位 | V2 是否收编 | 优先级 | 是否需 designer 新裁定 |
| --- | --- | --- | --- | --- |
| 1 | “两端 conversation ref 提取存在四个病态-URL 分叉点”：`+`、路径空段、默认端口、多重 percent 编码；正常 provider URL 一致，最坏为观察 tab/报错 | 是，作为 adapter contract 的测试向量与单源化任务 | P0 | 是：canonical normalization（尤其多重 decode、`+` 语义）及接受/拒绝边界 |
| 2 | “前端 invoke 类型断言与 Tauri 运行时不符，Rust 端成功 message 不会显示”：文案降级、功能无损 | 是，作为 wire schema/typed command hygiene | P1 | 否，若只修类型与测试；若把 message 变成用户可依赖的协议字段则需裁定 |
| 3 | “观察 tab 未 commit 窗口的理论重复开 tab”：ack 失败、请求正常、commit 慢于轮询时可能重复；下一轮收敛 | 是，作为 Summon opening 的收敛性**目标**（当前代码无此不变量，review 明确其为理论缺陷） | P1 | 是：允许最多几个 pending opening、去重窗口与用户可见反馈 |
| 4 | “同一 poll 批次内 tabs 快照过时”：会重复调用幂等 activateTab，无害 | 是，作为批处理观察快照的陈旧性测试 | P1/P2 | 否，若只改善快照刷新；若改变队列公平性/排序需裁定 |
| 5 | “`CARRIER_FOCUS_ACK_KIND` 常量未接线”：轮询模型无消息 lane，仅为命名锚点 | 部分收编：改成明确的 transport/schema kind，或删除不具语义的常量 | P2 | 是：V2 是否保留 compatibility kind、以及 ack 的语义（消费/观察完成/导航完成） |

## 8. 待裁定问题清单

### 必须由 epic designer 裁定

1. Summon 是否正式成为覆盖 Focus/Navigate/Attach 的上位操作名；还是保留 Focus/Navigate 为并列命令、Summon 仅作用户意图。
2. `SurfaceObjectRef` 的 canonical identity schema：project/workspace/account scope 是否属于 identity、route 还是 capability context。
3. `resume_run` 是否允许存在；若允许，什么条件下可从 Observe 进入 Attach/rebind，谁能授权。
4. Attach 写哪一层：不改 canonical（仅 CarrierAssociation）、转移 `ActuationLease.carrierRef`、还是新 operation kind 携带新绑定语义？以及是否允许只读 attach、attach 后 lease 的独立性（现有 `CurrentConversationBinding` 不含 carrier，故此项必须先定）。
5. 反向可见性中“已读”是 UI 事件、Hub work-state mutation，还是 provider receipt；默认建议前两者分离。
6. 跨设备/profile 的 trust、账号 scope、用户选择和 carrier 抢占规则。
7. Summon queue 的优先级、合并、取消、重试和 ack 状态机；尤其 observe 与 attach 是否永不合并。
8. 飞书和 LLM Wiki 的 surface object kinds、权限边界及是否同属 Carrier Summon 范畴。
9. V1 endpoint 的兼容期限，以及 normalization vectors 的 canonical owner（noos-shuttle 或 authority docs）。

### 实现阶段可自行决定（不改变契约时）

- adapter 内部解析器的语言/模块结构，只要通过共同 vectors、allowlist 和 fail-closed 测试。
- 队列数据结构、锁和内存清理方式，只要不改变已裁定的 TTL、容量、幂等和失败语义。
- UI 的按钮布局、加载/失败文案的具体措辞（不把 observe 显示为 attach/resume）。
- metrics/log 字段名与 trace 关联方式，只要不把日志当 canonical truth。
- pending opening 的实现细节，在 designer 确定上限和可见状态后。

## 9. 领域术语表（中英文）

| English | 中文 | 本提案中的限定含义 |
| --- | --- | --- |
| Carrier | 载体 | 承载 surface object 的 runtime 表面；浏览器 tab 可 disposable，不能替代逻辑身份 |
| Carrier pool / registry | 载体池 / 载体登记表 | 设备、profile、surface 能力和最近观察等 runtime facts 的集合，不是 canonical binding |
| Surface | 表面 / 平台表面 | 可承载对象的 provider 或本地应用边界，如 ChatGPT、飞书、LLM Wiki |
| Surface object | 表面对象 | surface 内可定位的对象；可为 conversation、project-conversation、document、wiki-page |
| Logical identity | 逻辑身份 | 稳定、可寻址的对象身份；不等于 URL、tab id、标题或窗口 |
| Provider conversation identity | Provider 对话身份 | provider 拥有的 opaque conversation id；必须带 provider/scope 语境，不能全局裸用 |
| Route context | 路由上下文 | project/workspace 等定位上下文；例如 `/g/<p>/c/<id>` 中的 project 不吞并 conversation id |
| Summon | 召回 / 召唤 | 协调请求的上位动作；必须声明 observe 或 attach mode，不自动包含执行权 |
| Focus | 聚焦 | 改变现有 carrier 的可见/活动状态；不导航、不绑定、不拿 lease |
| Navigate | 导航 | 让 carrier 加载已校验的 URL/route；不宣称加载完成、身份稳定或已绑定 |
| Observe / observer | 观察 / 观察者 | 读取 carrier 与对象状态的证据；不取得 lease，不拥有 actuation authority |
| Attach | 附着 | 明确授权后把验证过的 carrier 关联到 binding；不因导航或可见性自动发生 |
| Binding | 绑定 | Reducer 持有的 logical thread–provider conversation canonical 关系；**不含 carrier**（carrier 在 lease 上） |
| Binding generation | 绑定代次 | `CurrentConversationBinding.generation`；只能单调推进，是 run/dispatch 的 fence 之一 |
| Carrier association | 载体关联（拟新增） | carrier 当前承载某 surface object 的观察性记录；是否升级为状态性关联待裁定 |
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

## 10. 研究证据与 provenance

### Dispatch / authorization

- 来源：Integrator 会话经跨会话消息派发 Carrier Summon V2 研究；用户在本 Research + Design proposal 会话明确授权研究立项。
- 持久记录：[Issue #52 开工声明](https://github.com/futouyiba/noos-shuttle/issues/52)；分支 `research/carrier-summon-v2`，基于当前工作区 HEAD `570331278f54d5c54d00771c03d5f1302aa6bb72`。
- 本文不构成 merge、deploy 或关闭 issue 授权。

### Authority / contract

- [noos_docs `docs/agent-workflow.md`](https://raw.githubusercontent.com/futouyiba/noos_docs/4ec76f6007d6e9974cb233c7ca0cc2a47815be27/docs/agent-workflow.md)，默认分支 `main`，读取 SHA `4ec76f6007d6e9974cb233c7ca0cc2a47815be27`，v0.3.1。
- 仓库 [AGENTS.md](../AGENTS.md)：任务隔离、review exact head、designer 原文裁定和 integrator 纪律。
- [manual-handoff-baseline.md](deliberation-harness/manual-handoff-baseline.md)：当前实际 dogfood 流程、角色/授权/观察与 lease 证据（研究方法基线，不是本提案新增契约）。

### V1 implementation evidence（immutable refs）

- Issue #44：开工 `#issuecomment-5705296177`；实现 `IMPLEMENTED: PR#47` `#issuecomment-5705676912`；验收复查（含 merge `6a29178`、双侧部署与 fail-closed 验证）`#issuecomment-5705811711`。
- PR #47：被审 exact head `6ecec825a55390264b6d5a85ec65455ebc68a2d2`；委派记录 `#issuecomment-5705598192`；review 结论 `#issuecomment-5705673584`；merge record（merge `6a29178`，post-merge 484/484 + smoke 28/28 + cargo 49/49）`#issuecomment-5705808490`。
- 指定 review 评论内容已逐条引用，见 §7；五条均为非阻塞，`REVIEW: APPROVE` 为当时结论。
- 代码证据：[provider-identity.ts](../src/shared/provider-identity.ts)、[carrier-focus.ts](../src/core/carrier-focus.ts)、[focus-runtime.ts](../src/background/focus-runtime.ts)、[operational-state-reducer.ts](../src/core/operational-state-reducer.ts)、[work-item-inbox.ts](../src/core/work-item-inbox.ts)、[spawn-runtime.ts](../src/background/spawn-runtime.ts)、[work.ts](../apps/noos-hub/src/pages/work.ts)、[main.rs](../apps/noos-hub/src-tauri/src/main.rs)。
- 不可复现项：`#44` 的「数据链路核实说明」与部署细节依赖当时本地环境；本提案只引用其线程文本，不重新验证部署。

## 11. 明确非目标

本文不实现 V2，不修 PR #47 残留，不修改 V1 API，不建立跨设备控制通道，不把 ChatGPT/飞书/LLM Wiki 的未裁定语义写成既定事实，不替 designer 作最终裁定，也不 merge/deploy/关闭任何 issue。
