# B.3 输出标记接受集与实际用法脱节 —— 提案（v0，rev.1）

> **状态：提案，不是契约。** 本文只主张 canonical 侧（`noos_docs` 规范附录 B）**接受集的语义**。
> 本文**不改 watcher 的行为、不写运行时代码、不改任何产品文件、不改 `noos_docs`**。
>
> **rev.1（2026-09-21）**：已按 Epic Designer 的 `PARTIAL_ACCEPT` 裁定改写——§3 重写为**四层分离**模型、
> 新增**显式窄映射表**与 `UNMAPPED` 类（fail closed）、§4 收敛为已裁规则、§7 记录逐条处置、§8 给出生效链。
> 本次裁定原文见**附录 A**（决定性表述逐字引用，第 2.3 节）。
>
> 仓库 `futouyiba/noos-shuttle`｜分支 `docs/b3-verdict-acceptance-set`｜rev.0 base = `main` @ `6731a60e7d468e040c86e7e28a5f87161b193e1e`
> 被审 exact head（rev.0）：`7f85808cfdf20dda045192a33c2ce926be741f42`

## 锚定表（本文全部引用以此为准）

| 引用对象 | revision |
| --- | --- |
| 规范 `noos_docs:docs/agent-workflow.md` | blob `919360055b7f6a33449de440ac1c9ca4acff85c5`；所在 `main` = `4ec76f6007d6e9974cb233c7ca0cc2a47815be27`（2026-09-16）；该文件末次变更 commit `a3d33514cc3c502067b4e10faa239557c87697b2`；文首自述版本 **v0.3.1（2026-09-17）** |
| 本仓 `noos-shuttle` `main` | `6731a60e7d468e040c86e7e28a5f87161b193e1e`（2026-09-20 19:34:24 +0800） |
| watcher 实现 | `.claude/skills/noos-watch/SKILL.md` @ 上表 main（路由表与「未分类」判据见该文件第 96–122 行） |
| watcher 活状态取证 | 主 checkout `.tmp/watcher-state.json`，读取于 2026-09-20 21:19 +0800，`watermark = 2026-09-20T11:27:48Z`（**单次快照**，非全量历史） |
| 本提案裁定 | PR #94 评论 [`5750241368`](https://github.com/futouyiba/noos-shuttle/pull/94#issuecomment-5750241368)，2026-09-20T13:55:52Z，被审 exact head `7f85808cfdf20dda045192a33c2ce926be741f42`；`noos-governor` event `pr94-b3-verdict-acceptance-set`；原文见**附录 A** |

## 引用效力声明

本文**不引用任何未生效文档作为依据**。凡引用非规范文档处，只作现状描写或历史取证，并逐条标注效力：

| 文档 | 效力 | 本文用法 |
| --- | --- | --- |
| `noos_docs:docs/agent-workflow.md` v0.3.1 | **生效中**（规范 §7：v0.2 / v0.3.0 / v0.3.1 均由人类操作者授权、经独立 reviewer 审核后生效）；**本次裁定未激活任何新规范内容，v0.3.1 仍是生效规范**（附录 A 裁定第 7 条） | **唯一依据** |
| `docs/deliberation-harness/github-comment-transport-v0.md` | 自述「工作文档，不是契约，也不提升任何既有裁定的权威」→ **无权威效力** | 仅作现状描写与既有收敛方向的对照（§5） |
| `docs/deliberation-harness/doc-governance-proposal-v0.md`（PR #77） | `Authority-Level: Candidate`；自述「本提案仍为 Candidate；裁定与文档收录均不自动授权晋升、实施或合并」→ **未生效** | **不作任何依据**；仅在 §6 声明本文不仰赖它 |
| `docs/carrier-summon-v2-proposal.md`、`docs/deliberation-harness/agent-authority-and-halt-v0.md`、`docs/deliberation-harness/chatgpt-provider-recovery-go-n-proposal-v0.md` | proposal / 记录，非契约 | 仅作「同一缺陷被历次记录但从未收敛」的历史取证（§2.3） |
| PR #93（watcher 终态 DISMISSED，draft） | **未合并、未激活** | 本文不引用其判据；仅作为「不得把本裁决当成 canonical 已激活」的对象之一（§6） |

**明记**：PR #77 的裁定与合并**均不构成本文或任何仓库层切片的授权依据**。本仓已出现过「拿 Candidate 文档当『仓库层可自行决定』的授权」的误用，本文不重蹈。

---

## 0. 一句话

规范 B.3 把 `REVIEW:` / `DESIGN:` 的 **verdict 取值写成闭合枚举**，而实际书写方是**人类驱动的** designer 与 reviewer——他们会自然地造新词。
于是每造一个新词，唤醒层就把它降级为「未分类权威信号」进 pending 等人分类。
**根因不是词没收全，是维度错了**：该封闭的是**标记类型**与**副作用资格**，不是 verdict 取值；而把「裁决原文」「路由分类」「actuation 资格」压进同一个枚举，才是持续制造解析债的机制（§3）。

## 1. 现状

### 1.1 规范怎么写的（B.3，blob `9193600…`）

B.3 的语法是 `<MARKER>: <value>`，需要锚定时行末后缀 ` @ <sha>`。四个标记的取值形态**并不一致**：

| 标记 | 规范给出的取值 | 形态 |
| --- | --- | --- |
| `REVIEW:` | `APPROVE\|REQUEST_CHANGES` | **闭合枚举** |
| `DESIGN:` | `APPROVE\|REQUEST_CHANGES\|REJECTED` | **闭合枚举** |
| `IMPLEMENTED:` | `PR#M` | 指针（**无枚举**） |
| `INTEGRATED:` | `<验证摘要 + 构建时间戳>` | **自由文本**（**无枚举**） |

即：**规范自己已经把一半标记的取值写成自由文本 / 指针**。闭合枚举只压在两个 verdict 标记上。

同时，规范 §2.3 对**记录层**的要求是：

> 裁定记录必须注明交付来源（谁、在何处交付）；**决定性表述原文引用**（裁定、否决、条件等改变可行域的句子），禁止转述改义或代拟 designer 结论。

要求 verdict 取值必须落进三个词之一，与 §2.3 的「原文引用、禁止改义」在**同一份规范内部**互相牵制：一个 `PARTIAL_ACCEPT`（部分接受，且附 required delta）压进 `APPROVE` 或 `REQUEST_CHANGES` 都是改义。

### 1.2 实际在用的取值（本仓，均可寻址）

| 取值 | 书写方 | 规范状态 | 证据（评论 ID / URL） |
| --- | --- | --- | --- |
| `APPROVE WITH FINDINGS` | reviewer | 不在 `REVIEW:` 接受集 | [#57 `5749121751`](https://github.com/futouyiba/noos-shuttle/pull/57#issuecomment-5749121751)、[#57 `5749221289`](https://github.com/futouyiba/noos-shuttle/pull/57#issuecomment-5749221289)、[#73 `5749222277`](https://github.com/futouyiba/noos-shuttle/pull/73#issuecomment-5749222277)、[#79 `5749111606`](https://github.com/futouyiba/noos-shuttle/pull/79#issuecomment-5749111606)、[#81 `5749485827`](https://github.com/futouyiba/noos-shuttle/pull/81#issuecomment-5749485827) |
| `NEEDS_REVISION` | Epic Designer | 不在 `DESIGN:` 接受集 | [#54 `5712703481`](https://github.com/futouyiba/noos-shuttle/issues/54#issuecomment-5712703481)（2026-09-17，**本缺陷最早已知一例**） |
| `PARTIAL_ACCEPT` | Epic Designer | 不在 `DESIGN:` 接受集 | [#53 `5711118315`](https://github.com/futouyiba/noos-shuttle/pull/53#issuecomment-5711118315)（2026-09-17）、[PR #77 `5741887237`](https://github.com/futouyiba/noos-shuttle/pull/77#issuecomment-5741887237)、[#79 `5746215148`](https://github.com/futouyiba/noos-shuttle/pull/79#issuecomment-5746215148)、[#87 `5749808986`](https://github.com/futouyiba/noos-shuttle/pull/87#issuecomment-5749808986) |
| connector 的 `**Decision:** ACCEPT` 行 | Epic Designer | 无对应 `DESIGN:` 取值；**且首行根本不是标记** | [#85 `5749597396`](https://github.com/futouyiba/noos-shuttle/issues/85#issuecomment-5749597396) |

> **本条裁定自身即又一实例**：PR #94 的裁定首行是 `DESIGN: PARTIAL_ACCEPT @ 7f85808c…`（附录 A）——**对该缺陷作出的裁定，其取值本身仍落在枚举外**。这是本提案所述缺口的自指证据，也说明该取值已进入 canonical 的常规用法（§3.3 因此把它纳入映射）。

> 关于 `IMPLEMENTED:` 的一个结构性事实（§2 会用到）：它的取值是**指针** `PR#M`，规范从未给它枚举。本仓的实际书写完全合规——[#69 `5749163336`](https://github.com/futouyiba/noos-shuttle/issues/69#issuecomment-5749163336) 首行 `IMPLEMENTED: PR#82`、次行 `（impl: 直评）`，provenance 齐全——**却仍被唤醒层判为「取值不在枚举内」**（§1.3 第 3、4 条）。

### 1.3 代价：同一缺陷在活状态里已积压 9 条

watcher 活状态（§锚定表）当前 `pending` 共 **41** 条、`claims` 计 `ROUTED 167 / CLAIMED 21 / UNROUTED 1`。按判据归类：

| 类别 | 条数 | 是否本提案对象 |
| --- | --- | --- |
| **A：类型合法、取值不在枚举内** | **9** | **是** |
| B：B.3 定义的正规委派记录 / 委派请求（**根本不是标记**）被「未分类」判据捞起 | 11 | 否（见 §6 边界） |
| B2：仅因含 `（…: …, 委派: …）` provenance 行被捞起 | 1 | 否 |
| C：投递通道不可用（unattended 无跨会话通道） | 10 | 否 |
| D + Z：标记所在 head 已被取代 / 无匹配实现会话 | 2 | 否 |
| F：自由文本 integrator 验收复查记录，首行非标记 | 2 | 否（形态问题，同 §5） |
| G / H：channel-blocked 汇总 1 + 待投递 5 | 6 | 否 |

A 类 9 条明细（全部为 `pending`；`type` 均为 `unclassified-authority`，`action` 均落在「人工分类权威信号 / 权威设计裁定；**不自动转写 verdict**」，后两条另附裁定内容摘要）：

| # | 评论 | 标记首行 | 判据原文 |
| --- | --- | --- | --- |
| 1 | [#79 `5749111606`](https://github.com/futouyiba/noos-shuttle/pull/79#issuecomment-5749111606) | `REVIEW: APPROVE WITH FINDINGS @ 1a7e95c…` | 取值不在规范枚举内 |
| 2 | [#57 `5749121751`](https://github.com/futouyiba/noos-shuttle/pull/57#issuecomment-5749121751) | `REVIEW: APPROVE WITH FINDINGS @ 4164ec1…` | 同上 |
| 3 | [#69 `5749163336`](https://github.com/futouyiba/noos-shuttle/issues/69#issuecomment-5749163336) | `IMPLEMENTED: PR#82`（`（impl: 直评）`） | **取值不在规范枚举内（IMPLEMENTED:）** |
| 4 | [#60 `5749208522`](https://github.com/futouyiba/noos-shuttle/issues/60#issuecomment-5749208522) | `IMPLEMENTED: PR#83`（`（impl: 直评）`） | 同上 |
| 5 | [#57 `5749221289`](https://github.com/futouyiba/noos-shuttle/pull/57#issuecomment-5749221289) | `REVIEW: APPROVE WITH FINDINGS @ 173e844…` | 取值不在规范枚举内 |
| 6 | [#73 `5749222277`](https://github.com/futouyiba/noos-shuttle/pull/73#issuecomment-5749222277) | `REVIEW: APPROVE WITH FINDINGS @ 19fd2cb…` | 同上 |
| 7 | [#81 `5749485827`](https://github.com/futouyiba/noos-shuttle/pull/81#issuecomment-5749485827) | `REVIEW: APPROVE WITH FINDINGS @ a31d8c9…` | 同上 |
| 8 | [#85 `5749597396`](https://github.com/futouyiba/noos-shuttle/issues/85#issuecomment-5749597396) | `## Primary Design Disposition` / `**Decision: ACCEPT**` | 决策取值 `ACCEPT` 不在 `DESIGN` 枚举内 |
| 9 | [#87 `5749808986`](https://github.com/futouyiba/noos-shuttle/pull/87#issuecomment-5749808986) | `## Primary Design Disposition` / `**Decision: PARTIAL_ACCEPT**` | 同上 |

这 9 条是**同一根因的单次快照**，不是全部历史量：水位与 claims 只覆盖本轮窗口，更早的同形态评论已转出 pending。

## 2. 为什么「继续往枚举里追加」不解决

本节是本提案要承担论证的部分。

**2.1 书写方是人，取值粒度由裁决本身决定，不由词表决定。**
`DESIGN:` 的书写方是 epic designer（人类或指定设计 agent）。裁定的语义粒度——「接受」「部分接受且附 required delta」「需修订」「接受但保留条件」——是裁决内容的性质，不是可以预先枚举完的有限集。规范没有任何机制能让人「不再造新词」；它只能决定**造新词之后发生什么**。

**2.2 「加词」与规范 §2.3 在同一份规范内互相牵制。**
§2.3 要求决定性表述**原文引用、禁止转述改义**；而「取值必须属于 `APPROVE|REQUEST_CHANGES|REJECTED`」要求的是**在解析层做有损压缩**。两者只能有一个在解析层胜出。现在胜出的是枚举——后果是 `PARTIAL_ACCEPT` 要么被压成 `APPROVE`（改义），要么不进标记（本提案的 9 条 pending）。**本提案的立场是让 §2.3 在解析层也成立**：原文开放保真，映射只用于路由与副作用资格（§3）。

**2.3 逐文档 defer 已经发生过四次，一次也没收敛。**
同一缺陷已被四份文档分别记录，且每次都停在「留给后续修订项」：

| 记录处 | 时间 | 记录方式 |
| --- | --- | --- |
| `docs/deliberation-harness/chatgpt-provider-recovery-go-n-proposal-v0.md:240` | 2026-09-17 | 「此词汇差异属于规范后续修订项」 |
| `docs/carrier-summon-v2-proposal.md:217` | 2026-09-17 | 「标记合规性与合并门禁判定留给 integrator 按 §4.2/B.3 处置；本文不代其裁定」 |
| `docs/deliberation-harness/agent-authority-and-halt-v0.md:265` | 2026-09-19 | 「协议缺少符号时人会自造，然后全链路不认（`PARTIAL_ACCEPT` 即如此）」 |
| `docs/deliberation-harness/github-comment-transport-v0.md:40,199` | 2026-09-19 | 「协议补 `PARTIAL_ACCEPT` 符号——designer 实际在用，规范无对应枚举值」 |

四份记录的共同形态是：**仓库层把问题记录下来，然后声明「这属规范级，须另行裁定」**，而规范侧的修订从未被下达。逐文档 defer 的累积效应就是 §1.3 的 9 条 pending。**本提案提交的这次裁定就是为打断这个循环**（处置见 §7）。

**2.4 `IMPLEMENTED:` 的两条 pending 证明问题不在词表。**
`IMPLEMENTED:` 的取值是指针，规范**从未给它枚举**（§1.1 表）。一条完全合规、provenance 齐全的 `IMPLEMENTED: PR#82`（§1.3 第 3 条）之所以被漏认，是因为唤醒层**用「取值是否在枚举内」判类型**——一个没有枚举的类型永远无法通过这个判据。这不是「词没收全」，是**判据本身选错了维度**。任何追加都无法修复它。（裁定第 8 条明确：不得借此改变 `IMPLEMENTED:` / `INTEGRATED:` 的既有 payload 语义——本文仅把这两条作为**判据选错维度**的证据，不对其语义作任何主张。）

**2.5 规范只有二元判定，缺的是第三类。**
B.3 对标记只有二元判定：`<MARKER>: <value>` 且带 provenance 行为**有效标记**（参与推导），否则**无效标记**（「无 provenance 行的标记为无效标记，不参与推导」）；B.0 原则 5 更是写明「机器写标记（严格语法）」。
因此「**类型合法、取值未映射**」这个类别在规范里**无处安放**，只能落进「无效」侧，与「这压根不是标记」（如 §1.3 的 B 类委派记录 `rev: review PR#73 @ …`、F 类自由文本）**同处置**。唤醒层的保守判据把两者都记为待人工分类，是对规范缺口的**合理补偿**，不是实现缺陷。
裁定给出的解法不是「补第三类」这么简单，而是**把被压在一个枚举里的四件事拆成四层**（§3）。

## 3. 主张（rev.1：依裁定重写为四层分离）

### 3.1 四层必须分开

裁定理由段指出：把「裁决原文」与「路由分类」混成一个维度会持续制造解析债，且**「取值完全开放」不能等价为「任何自由文本都可获得现有 verdict 的 actuation side effects」**。因此本提案主张以下四层各归其位：

| 层 | 内容 | 开放性 | 判据来源 |
| --- | --- | --- | --- |
| 1. **marker validity** | 首行是否构成合法 B.3 标记：类型 ∈ canonical 封闭集合（`REVIEW:` / `DESIGN:` / `IMPLEMENTED:` / `INTEGRATED:` …）+ 次行 provenance | **封闭** | canonical |
| 2. **raw verdict preservation** | 取值逐字保留，不做有损压缩；解析器不得改写、不得截断 | **开放** | 评论正文（我方） |
| 3. **semantic routing class** | 已知取值 → `APPROVE_SIDE` / `CHANGES_SIDE` / `REJECTION_SIDE` / `ACCEPT_SIDE` / `CONDITIONAL_SIDE`；其余 → **`UNMAPPED`** | **显式且窄**，写进 canonical | canonical（§3.3 表） |
| 4. **actuation eligibility** | 自动副作用（merge handoff / `fix` / close / 其它敏感 actuation）**只能**来自第 3 层明确映射的类 | **fail closed** | canonical |

第 1 层封闭 + 第 2 层开放，是「类型闭、取值开」的准确表述（rev.0 的 §3 主张在这一点上表述过宽，已按裁定第 1 条收窄：**不要把「开放 value」写成自动授权新语义**）。

### 3.2 `UNMAPPED` 类：合法，但无敏感资格

未映射的取值**是合法标记**（第 1 层通过、第 2 层保真），其 semantic class 为 `UNMAPPED`：

- **允许**：通知 / 唤醒 orchestrator 与相关工作会话；原样展示。
- **禁止**：由关键词、前缀或相似度猜测成 approve / changes / rejected；生成 merge handoff、`fix`、close 或任何其它敏感 actuation。

即 fail closed 方向**固定向下**：未映射 ≠ approve，**也 ≠ changes / 驳回**——否则「未映射」就会等价于一次驳回，把一个解析缺口变成实质否决。
裁定原文的不变式**不变**：`LLM proposes; Policy authorizes; Reducer/durable action applies`。第 3 层是「Policy」的解析面，第 4 层是「durable action」的准入面。

### 3.3 显式窄映射表（canonical 承载，不由 watcher 私有启发式决定）

裁定第 5 条要求：至少把**当前 durable 用法**纳入映射，映射表**写进 canonical**。本提案建议的初始表：

| raw verdict（逐字） | class | 侧 | 附条件 |
| --- | --- | --- | --- |
| `REVIEW: APPROVE` | `APPROVE_SIDE` | approve | — |
| `REVIEW: APPROVE WITH FINDINGS` | `APPROVE_SIDE` | approve | **仅当** findings 明确均 non-blocking，且 exact head / current state 仍满足 promotion gate（裁定 Boundary 段） |
| `REVIEW: REQUEST_CHANGES` | `CHANGES_SIDE` | changes | — |
| `DESIGN: APPROVE` | `ACCEPT_SIDE` | accept | — |
| `DESIGN: ACCEPT` | `ACCEPT_SIDE` | accept | connector 现行用词（§1.2），已纳入 |
| `DESIGN: PARTIAL_ACCEPT` | `CONDITIONAL_SIDE` | —（阻断） | 保留「有 required delta / 尚需修订」的阻断性质；**不得**映成无条件 promotion-ready |
| `DESIGN: NEEDS_REVISION` | `CONDITIONAL_SIDE` | —（阻断） | 同上 |
| `DESIGN: REJECTED` | `REJECTION_SIDE` | rejection | 关单副作用**只**由本类触发（§4） |
| 其它 | **`UNMAPPED`** | — | 合法标记；通知/唤醒 + 原样展示；无敏感 actuation |

`CONDITIONAL_SIDE` 是这张表里最容易被做错的一格：`PARTIAL_ACCEPT` 在字面上含「accept」，但它带 required delta，**不是** promotion-ready。裁定明确要求它的阻断性质被保留。

### 3.4 映射表可增补，增补是解析便利

表的增补形态同 B.2 的动词接受集——「接受集只是解析便利，不是第二套协议」。增补**不改变**第 1 层的类型集合，也不产生新的副作用；每一次增补都是把某个已经在用的取值从 `UNMAPPED` 移入一个**已有**的 class。

## 4. 语法细节（原 §7-Q4，已裁定 ACCEPT）

- **锚定分界**：行末**最后一个**形如 ` @ <7–40 位十六进制>` 的片段为 exact-head anchor；其**前**的全部内容为 raw value，必须**完整保留**。
- **不得猜 SHA**：没有合法行末 anchor 时，**不得**从正文中提取或推断 SHA。
- **副作用**（原 §7-Q3，已裁定 ACCEPT）：`DESIGN: REJECTED` 的 proposal 关单副作用**只允许** canonical 明确映射到 rejection class 的值触发；未知值无副作用。**相同原则适用于所有自动副作用**（即第 4 层的准入只能来自第 3 层的显式映射，不能来自文本匹配的偶然命中）。

## 5. connector 交付形态与 canonical 落地（原 §7-Q5/Q6，已裁定）

**Q5 —— DEFER，另立 projection issue。** connector 现行的 `## Primary Design Disposition` + `Decision:` 形态确实造成 transport gap，但**不借本次 canonical value 语义修改顺带把第二种 marker grammar 纳入 B.3**。
裁定给出的目标方向是：**designer / governor 的 durable 写入首行遵循 `DESIGN: <raw verdict> [@ sha]`，正文继续承载结构化 disposition**；connector / tooling projection **另切片修**。
（本文 rev.0 曾提出「改由 designer 侧调整 connector 首行」，方向与裁定一致；差别是裁定明确**另立切片**，不由本提案顺带处理。§6 因此把 connector 投影列为**明确不在射程内**。）

**Q6 —— 本裁决不授权修改 `noos_docs`。** 当前 Project/Repo workflow 明确要求 `noos_docs` 修改必须有其**自身显式 Work Item**。应先创建 / 取得该 canonical Work Item，再把本裁决投影到 `docs/agent-workflow.md`；在其**独立 review + activation 前，v0.3.1 仍是生效规范**。

## 6. 边界（rev.1 依裁定扩充）

**边界 1（硬）：本提案不改 watcher 的行为。**
唤醒层侧的解析 / 记账修复是**另一条独立的仓库层切片**，不靠本提案授权，也不由本提案规定其形态。引用 `noos-watch/SKILL.md` 与 `.tmp/watcher-state.json` **只作现状取证**。
§1.3 的 B / B2 / C / F / G / H 各类积压**不在本提案射程内**（源于判据过宽或投递通道，属那条切片）。
**裁定第 8 条的约束更强**：watcher 的 parser / state 修复（包括 PR #93 一类仓库实现）**不得把本裁决当成 canonical 已激活**；可以独立修复**现行规范下已经明确的 implementation-local 误分类**，但**不能提前实现新的开放 verdict contract**。

**边界 2（硬）：不得引用尚未生效的文档作为依据。**
见文首「引用效力声明」。本提案**不引用** PR #77（文档治理）、PR #93 的任何规则，也不引用 `github-comment-transport-v0.md` 作为依据——后者在 §5 仅作对照，且已标注其无权威效力。

**边界 3（裁定 Boundary 段）：**
- 不修改 `noos_docs`，不在本裁决中创建 canonical authority。
- 不把 unknown raw verdict 当成 permission。
- 不改变 exact-head review rule。
- **不重构 watcher transport、claims state machine 或 PR #93 的终态设计。**
- 不借此改变 `IMPLEMENTED:` / `INTEGRATED:` 的既有 payload 语义。
- **connector / tooling projection 另切片**（§5-Q5）。

**边界 4：本文只写文档。** 不写运行时代码、不改产品文件、不改 `noos_docs`。本 PR **保持 proposal-only**（裁定第 8 条）。

## 7. 裁定处置记录（Q1–Q6）

裁定：**`PARTIAL_ACCEPT`**，被审 exact head `7f85808c…`，来源见附录 A。本节记录**本文的处置**，决定性表述原文见附录 A（第 2.3 节）。

| # | 裁定 | 本文处置 |
| --- | --- | --- |
| **Q1** 取值是否改自由文本 | **ACCEPT，收窄表述**：raw verdict value 开放并逐字保留；marker type 仍为 canonical 封闭集合；不要把「开放 value」写成自动授权新语义 | 已改写为 §3.1 四层模型；第 1 层封闭 / 第 2 层开放分开陈述；rev.0 中「未知取值不判无效」的宽表述已由 §3.2 的 `UNMAPPED` + fail closed 取代 |
| **Q2** 未映射取值的默认档 | **PARTIAL_ACCEPT (b)**：合法 marker，class = `UNMAPPED`；允许通知/唤醒 + 原样展示；**不得**由关键词/前缀/相似度猜测；不得生成 merge handoff / `fix` / close 或其它敏感 actuation | 已落 §3.2（含「也不得判为 changes / 驳回」的双向 fail closed 说明） |
| **Q3** `REJECTED` 副作用范围 | **ACCEPT**：关单副作用只允许 canonical 明确映射到 rejection class 的值触发；未知值无副作用；**相同原则适用于所有自动副作用** | 已落 §4 末条，并上升为 §3.1 第 4 层 |
| **Q4** `@ <sha>` 分界规则 | **ACCEPT**：行末最后一个 ` @ <7–40 hex>`；此前内容完整保留为 raw value；无合法行末 anchor 时不得从正文猜 SHA | 已落 §4（本文 rev.0 的建议规则被原样采纳） |
| **Q5 前段** 已知映射须显式且窄 | 已列入 required delta：至少纳入 `APPROVE` / `APPROVE WITH FINDINGS` / `REQUEST_CHANGES` / `APPROVE` / `ACCEPT` / `PARTIAL_ACCEPT` / `NEEDS_REVISION`；`PARTIAL_ACCEPT` 与 `NEEDS_REVISION` 须保留阻断性质，不得映成无条件 promotion-ready；**映射表写进 canonical，不由 watcher 私有启发式决定** | 已落 §3.3 初始表（含 `CONDITIONAL_SIDE` 与 `APPROVE WITH FINDINGS` 的附条件）；承载位置主张 = canonical（§5-Q6 前置） |
| **Q5** connector 形态是否纳入规范 | **DEFER as separate projection issue**：目标方向是 durable 写入首行 `DESIGN: <raw verdict> [@ sha]`，正文承载结构化 disposition；connector/tooling projection 另切片 | 已落 §5 与 §6 边界 3；本文不再主张本次处理 connector 语法 |
| **Q6** 是否授权落地 `noos_docs` | **不授权**：`noos_docs` 修改须有自身显式 Work Item；须先取得该 Work Item，再投影；其独立 review + activation 前 v0.3.1 仍是生效规范 | 已落 §5 与 §8 生效链；本文不主张任何 canonical 生效 |
| **第 8 条** 保持 proposal-only | 本 PR 保持 proposal-only；watcher 修复不得把本裁决当成 canonical 已激活；可独立修复现行规范下已明确的 implementation-local 误分类，但不得提前实现新的开放 verdict contract | 已落 §6 边界 1 与边界 4 |

**尚未结清的项（不属本次裁定范围，本文不代裁）**：
- connector / tooling projection 切片的**归属与形态**（裁定要求另立，未指定承载者）；
- canonical Work Item 的**创建与编号**（裁定要求先取得，未指定由谁发起）；
- `CONDITIONAL_SIDE` 的**具体行为面**（阻断什么、放行什么、以及 reviewer 侧如何据此安排增量复审）——本提案给出 class 名与「保留阻断性质」的约束，但未逐项定义行为；若 designer 认为需要逐项定义，请明示。

## 8. 生效链与 resume condition

本提案**当前不具备强制力**。使 §3 的语义成为 canonical 生效规则，须依次完成：

1. **本文在新 exact head 吸收分层语义与 Q1–Q6 处置** —— 本 rev.1 即为此步骤；**rev.1 的 exact head 需重新确定**（rev.0 head `7f85808c…` 的裁定已消费，不可复用）。
2. **取得 fresh independent review** —— 由独立 reviewer 在新 exact head 上执行；**本文作者不自我复审**，也不指定复审者（属 orchestrator / 人的编排）。
3. **取得明确授权的 `noos_docs` Work Item**，把本裁决投影到 `docs/agent-workflow.md`，并在 **canonical 仓完成其自身的 review / activation**。
4. 在第 3 步完成前，**v0.3.1 仍是生效规范**；§3.3 的映射表与 §3.1 的四层划分**不具备强制力**，任何一侧（watcher 或其它实现）不得据本文提前实施新的开放 verdict contract（裁定第 8 条）。

**合并门禁不受本缺口影响**：B.3 明文「门禁不依赖推导」，合并证据始终是 PR body 的 review 证据链接 + exact head + 合并时 head 三者一致，由 integrator 按 §4.2 逐项核对。本提案影响的是**唤醒与路由**，不是**授权**。

---

## 附录 A：裁定记录（原文引用，第 2.3 节）

| 字段 | 值 |
| --- | --- |
| 裁定方 | Epic Designer（经 NOOS Repository Governor / Primary Design Watcher 交付） |
| 首行标记 | `DESIGN: PARTIAL_ACCEPT @ 7f85808cfdf20dda045192a33c2ce926be741f42` |
| provenance 行 | `（des: NOOS Repository Governor / Primary Design Watcher）` |
| Decision | **`PARTIAL_ACCEPT`** |
| Exact target | `docs/deliberation-harness/b3-verdict-acceptance-set-proposal-v0.md` @ `7f85808cfdf20dda045192a33c2ce926be741f42`（PR #94） |
| 来源 | PR [#94](https://github.com/futouyiba/noos-shuttle/pull/94) 评论 [`5750241368`](https://github.com/futouyiba/noos-shuttle/pull/94#issuecomment-5750241368)，2026-09-20T13:55:52Z |
| Governor event | `event=pr94-b3-verdict-acceptance-set head=7f85808cfdf20dda045192a33c2ce926be741f42 action=primary-design-disposition` |

**决定性表述（逐字引用）**

> 提案识别的 contract gap 成立：当前 canonical B.3 同时把 `REVIEW:` / `DESIGN:` 的 verdict 写成闭合枚举，却允许 `IMPLEMENTED:` 指针与 `INTEGRATED:` 自由文本；实际 durable 记录已经出现 `APPROVE WITH FINDINGS`、`NEEDS_REVISION`、`PARTIAL_ACCEPT` 等无法无损压回现有枚举的结论。继续逐词扩枚举会把“裁决原文”与“路由分类”混成一个维度，并持续制造解析债。

> 但“取值完全开放”不能等价为“任何自由文本都可获得现有 verdict 的 actuation side effects”。需要把 **marker validity / raw verdict preservation / semantic routing class / actuation eligibility** 四层分开：原文可以开放保真；自动 `merge` / `fix` / close 等副作用只能来自 canonical 明确映射的语义类，未知值必须 fail closed。

> 不把 unknown raw verdict 当成 permission；`LLM proposes; Policy authorizes; Reducer/durable action applies` 不变。

> 不改变 exact-head review rule；`APPROVE WITH FINDINGS` 只有在 findings 明确均 non-blocking 且 exact head/current state 仍满足 promotion gate 时，才可作为 approve-side review evidence。

> 本裁决不授权修改 `futouyiba/noos_docs`。当前 Project/Repo workflow 明确要求 noos_docs 修改必须有其自身显式 Work Item。

> 本 PR 继续保持 proposal-only；watcher 的 parser/state 修复（包括 PR #93 一类仓库实现）不得把本裁决当成 canonical 已激活。可以独立修复现行规范下已经明确的 implementation-local 误分类，但不能提前实现新的开放 verdict contract。

**Resume condition（逐字引用）**

> 1. proposal 在新 exact head 吸收上述分层语义与 Q1–Q6 处置；
> 2. 取得 fresh independent review；
> 3. 若要使该语义成为 canonical 生效规则，另有明确授权的 `noos_docs` Work Item，并在 canonical repo 完成其自身 review / activation 流程。

---

**本文提交仓库**：`futouyiba/noos-shuttle`，分支 `docs/b3-verdict-acceptance-set`。
**本文不改任何产品文件、不写运行时代码、不改 `noos_docs`；等待独立复审。**
