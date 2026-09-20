# B.3 输出标记接受集与实际用法脱节 —— 提案（v0）

> **状态：提案，不是契约。** 本文只主张 canonical 侧（`noos_docs` 规范附录 B）**接受集的语义**。
> 本文**不改 watcher 的行为、不写运行时代码、不改任何产品文件、不改 `noos_docs`**。
> 待裁定问题见 **§7**（编号，附倾向，本文不自裁）。
>
> 仓库 `futouyiba/noos-shuttle`｜分支 `docs/b3-verdict-acceptance-set`｜base = `main` @ `6731a60e7d468e040c86e7e28a5f87161b193e1e`

## 锚定表（本文全部引用以此为准）

| 引用对象 | revision |
| --- | --- |
| 规范 `noos_docs:docs/agent-workflow.md` | blob `919360055b7f6a33449de440ac1c9ca4acff85c5`；所在 `main` = `4ec76f6007d6e9974cb233c7ca0cc2a47815be27`（2026-09-16）；该文件末次变更 commit `a3d33514cc3c502067b4e10faa239557c87697b2`；文首自述版本 **v0.3.1（2026-09-17）** |
| 本仓 `noos-shuttle` `main` | `6731a60e7d468e040c86e7e28a5f87161b193e1e`（2026-09-20 19:34:24 +0800） |
| watcher 实现 | `.claude/skills/noos-watch/SKILL.md` @ 上表 main（路由表与「未分类」判据见该文件第 96–122 行） |
| watcher 活状态取证 | 主 checkout `.tmp/watcher-state.json`，读取于 2026-09-20 21:19 +0800，`watermark = 2026-09-20T11:27:48Z` |

## 引用效力声明

本文**不引用任何未生效文档作为依据**。凡引用非规范文档处，只作现状描写或历史取证，并逐条标注效力：

| 文档 | 效力 | 本文用法 |
| --- | --- | --- |
| `noos_docs:docs/agent-workflow.md` v0.3.1 | **生效中**（规范 §7：v0.2 / v0.3.0 / v0.3.1 均由人类操作者授权、经独立 reviewer 审核后生效） | **唯一依据** |
| `docs/deliberation-harness/github-comment-transport-v0.md` | 自述「工作文档，不是契约，也不提升任何既有裁定的权威」→ **无权威效力** | 仅作现状描写与既有收敛方向的对照（§5） |
| `docs/deliberation-harness/doc-governance-proposal-v0.md`（PR #77） | `Authority-Level: Candidate`；自述「本提案仍为 Candidate；裁定与文档收录均不自动授权晋升、实施或合并」→ **未生效** | **不作任何依据**；仅在 §6 声明本文不仰赖它 |
| `docs/carrier-summon-v2-proposal.md`、`docs/deliberation-harness/agent-authority-and-halt-v0.md`、`docs/deliberation-harness/chatgpt-provider-recovery-go-n-proposal-v0.md` | proposal / 记录，非契约 | 仅作「同一缺陷被历次记录但从未收敛」的历史取证（§2.3） |

**明记**：PR #77 的裁定与合并**均不构成本文或任何仓库层切片的授权依据**。本仓已出现过「拿 Candidate 文档当『仓库层可自行决定』的授权」的误用，本文不重蹈。

---

## 0. 一句话

规范 B.3 把 `REVIEW:` / `DESIGN:` 的 **verdict 取值写成闭合枚举**，而实际书写方是**人类驱动的** designer 与 reviewer——他们会自然地造新词。
于是每造一个新词，唤醒层就把它降级为「未分类权威信号」进 pending 等人分类。
**根因不是词没收全，是维度错了：该封闭的是标记类型（`REVIEW:` / `DESIGN:` / …），不是 verdict 取值。**

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

要求 verdict 取值必须落进三个词之一，与 §2.3 的「原文引用、禁止改义」在**同一份规范内部**互相牵制：一个 `PARTIAL_ACCEPT`（部分接受，且附 required delta）压进 `APPROVE` 或 `REQUEST_CHANGES` 都是改义。这条张力是 §2 的论证起点。

### 1.2 实际在用的取值（本仓，均可寻址）

| 取值 | 书写方 | 规范状态 | 证据（评论 ID / URL） |
| --- | --- | --- | --- |
| `APPROVE WITH FINDINGS` | reviewer | 不在 `REVIEW:` 接受集 | [#57 `5749121751`](https://github.com/futouyiba/noos-shuttle/pull/57#issuecomment-5749121751)、[#57 `5749221289`](https://github.com/futouyiba/noos-shuttle/pull/57#issuecomment-5749221289)、[#73 `5749222277`](https://github.com/futouyiba/noos-shuttle/pull/73#issuecomment-5749222277)、[#79 `5749111606`](https://github.com/futouyiba/noos-shuttle/pull/79#issuecomment-5749111606)、[#81 `5749485827`](https://github.com/futouyiba/noos-shuttle/pull/81#issuecomment-5749485827) |
| `NEEDS_REVISION` | Epic Designer | 不在 `DESIGN:` 接受集 | [#54 `5712703481`](https://github.com/futouyiba/noos-shuttle/issues/54#issuecomment-5712703481)（2026-09-17，**本缺陷最早已知一例**） |
| `PARTIAL_ACCEPT` | Epic Designer | 不在 `DESIGN:` 接受集 | [#53 `5711118315`](https://github.com/futouyiba/noos-shuttle/pull/53#issuecomment-5711118315)（2026-09-17）、[PR #77 `5741887237`](https://github.com/futouyiba/noos-shuttle/pull/77#issuecomment-5741887237)、[#79 `5746215148`](https://github.com/futouyiba/noos-shuttle/pull/79#issuecomment-5746215148)、[#87 `5749808986`](https://github.com/futouyiba/noos-shuttle/pull/87#issuecomment-5749808986) |
| connector 的 `**Decision:** ACCEPT` 行 | Epic Designer | 无对应 `DESIGN:` 取值；**且首行根本不是标记** | [#85 `5749597396`](https://github.com/futouyiba/noos-shuttle/issues/85#issuecomment-5749597396) |

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
| F：自由文本 integrator 验收复查记录，首行非标记 | 2 | 否（形态问题，同 §6） |
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
§2.3 要求决定性表述**原文引用、禁止转述改义**；而「取值必须属于 `APPROVE|REQUEST_CHANGES|REJECTED`」要求的是**在解析层做有损压缩**。两者只能有一个在解析层胜出。现在胜出的是枚举——后果是 `PARTIAL_ACCEPT` 要么被压成 `APPROVE`（改义），要么不进标记（本提案的 9 条 pending）。**本提案的立场是让 §2.3 在解析层也成立**：verdict 原样保留，映射只用于路由。

**2.3 逐文档 defer 已经发生过四次，一次也没收敛。**
同一缺陷已被四份文档分别记录，且每次都停在「留给后续修订项」：

| 记录处 | 时间 | 记录方式 |
| --- | --- | --- |
| `docs/deliberation-harness/chatgpt-provider-recovery-go-n-proposal-v0.md:240` | 2026-09-17 | 「此词汇差异属于规范后续修订项」 |
| `docs/carrier-summon-v2-proposal.md:217` | 2026-09-17 | 「标记合规性与合并门禁判定留给 integrator 按 §4.2/B.3 处置；本文不代其裁定」 |
| `docs/deliberation-harness/agent-authority-and-halt-v0.md:265` | 2026-09-19 | 「协议缺少符号时人会自造，然后全链路不认（`PARTIAL_ACCEPT` 即如此）」 |
| `docs/deliberation-harness/github-comment-transport-v0.md:40,199` | 2026-09-19 | 「协议补 `PARTIAL_ACCEPT` 符号——designer 实际在用，规范无对应枚举值」 |

四份记录的共同形态是：**仓库层把问题记录下来，然后声明「这属规范级，须另行裁定」**，而规范侧的修订从未被下达。逐文档 defer 的累积效应就是 §1.3 的 9 条 pending。**本提案要打断的就是这个循环**——把「另行裁定」正式提交为一次裁定请求。

**2.4 `IMPLEMENTED:` 的两条 pending 证明问题不在词表。**
`IMPLEMENTED:` 的取值是指针，规范**从未给它枚举**（§1.1 表）。一条完全合规、provenance 齐全的 `IMPLEMENTED: PR#82`（§1.3 第 3 条）之所以被漏认，是因为唤醒层**用「取值是否在枚举内」判类型**——一个没有枚举的类型永远无法通过这个判据。这不是「词没收全」，是**判据本身选错了维度**。任何追加都无法修复它。

**2.5 「未知取值」与「不是标记」必须分开——而规范现在没有第三类。**
B.3 对标记只有二元判定：`<MARKER>: <value>` 且带 provenance 行为**有效标记**（参与推导），否则**无效标记**（「无 provenance 行的标记为无效标记，不参与推导」）；B.0 原则 5 更是写明「机器写标记（严格语法）」。
因此「**类型合法、取值未映射**」这个类别在规范里**无处安放**，只能落进「无效」侧，与「这压根不是标记」（如 §1.3 的 B 类委派记录 `rev: review PR#73 @ …`、F 类自由文本）**同处置**。唤醒层的保守判据把两者都记为待人工分类，是对规范缺口的**合理补偿**，不是实现缺陷。
**规范缺的是第三类**：类型可判、取值未映射 → 合法标记，语义未映射，按类型及原文本呈现。

## 3. 主张

1. **标记类型由首个 token 判定。** 认得出 `REVIEW:` / `DESIGN:` / `IMPLEMENTED:` / `INTEGRATED:` 即可（及未来明确的类型），**不需要把取值也枚举化**。类型集合可以封闭（它是一小组、机器必须认得的维度）；取值不封闭。
2. **verdict 作为自由文本原样保留。** 与 §2.3「禁止改写裁定原文」的精神一致；本提案只是把该原则贯彻到解析层——引用裁定原文的链条从「评论正文」延伸到「标记取值」，中间不再有有损压缩。
3. **对已知取值给语义映射，而不是给合法性判定。** 映射的用途是**路由分档**（approve 侧 / changes 侧 / designer 的 accept 侧），不是判定标记有效与否。映射表可增补，增补是解析便利，不是协议修订（形态同 B.2 的动词接受集——「接受集只是解析便利，不是第二套协议」）。
4. **未知取值不判无效。** 归类到类型，按原文本呈现；是否路由、路由到哪一侧，由 §7 的问题定。
5. **「未知取值」与「不是标记」分开处置。** 前者是合法标记、语义未映射；后者才进「未分类」。见 §2.5。

## 4. 语法细节：自由文本取值与 `@ <sha>` 的分界

若采纳 §3 的主张，B.3 的行语法需要一条明确的分界规则——闭合枚举下不存在这个歧义（取值不含空格），自由文本下存在：

- 现行：`<MARKER>: <value>`，需要锚定时行末后缀 ` @ <sha>`。
- 自由文本取值（如 `APPROVE WITH FINDINGS`）含空格，故 `@` 的归属必须定死。**建议**：行末**最后一个**形如 ` @ <7–40 位十六进制>` 的片段为锚定后缀，其前为取值；找不到该片段时整行余部为取值、无锚定。
- `DESIGN:` 的 `REJECTED` 有副作用（「同时关闭 proposal issue」）——该副作用挂在**取值语义**上，因此若采纳「未知取值不判无效」，需同时明确：**副作用只对已映射的取值生效，未映射取值不产生任何副作用**。

本文只提出规则，不裁定；见 §7-4。

## 5. 与既有收敛方向的张力（须一并裁定，不是本提案的主张）

`docs/deliberation-harness/github-comment-transport-v0.md` §3.2（**该文档自述无权威效力**）给出的收敛方向是**相反的**：

> **未做（需设计门）**：把六暗号纳入版本化信封，使标记词表成为**封闭契约**。触及 `noos_docs` 附录 B，属规范级，须另行裁定。

两条路线不是必须二选一，但**分界必须由 designer 划定**，否则会在两个层面上互相拆台：

| 层 | 建议归属 | 理由 |
| --- | --- | --- |
| **类型**（`REVIEW:` / `DESIGN:` / …） | **可封闭** | 数量小、机器必须认得、新增是协议事件 |
| **取值**（verdict） | **不封闭** | 书写方是人类驱动的裁定/审核结论，粒度由裁决本身决定 |

若 designer 选择**取值也封闭**（即维持现状并逐词追加），则 §1.3 的 9 条 pending 中只有已知的 4 个取值能被消解，**根因保留**：下一位 designer 造的下一个词仍会进 pending。这是本提案主张方向的主要理由。

## 6. 边界（本提案不做什么）

**边界 1（硬）：本提案不改 watcher 的行为。**
watcher 侧的解析与记账修复是**另一条独立的仓库层切片**，不靠本提案授权，也不由本提案规定其形态。本文引用 `.claude/skills/noos-watch/SKILL.md` 与 `.tmp/watcher-state.json` **只作现状取证**，不构成对唤醒层实现的裁定或要求。
（特别地：§1.3 的 B / B2 / C / F / G / H 各类积压**不在本提案射程内**——它们源于判据过宽或投递通道，属那条切片。）

**边界 2（硬）：不得引用尚未生效的文档作为依据。**
见文首「引用效力声明」。本提案**不引用** PR #77（文档治理）的任何规则、也不引用 `github-comment-transport-v0.md` 作为依据——后者在 §5 仅作对照，且已标注其无权威效力。

**边界 3：本文只写文档。** 不写运行时代码、不改产品文件、不改 `noos_docs`。

## 7. 需要 Epic Designer 裁定的问题

以下问题本文**不自裁**。每条附倾向与理由。

**Q1. `REVIEW:` / `DESIGN:` 的取值是否改为自由文本（类型封闭、取值开放），即采纳 §3 的主张？**
倾向：**采纳**。理由见 §2.1–2.4；`IMPLEMENTED:` 的两条 pending（§1.3 第 3、4 条）证明取值维度的判据结构性失效。若否决，请一并说明「逐词追加」如何避免第 5 次 defer。

**Q2. 若采纳 Q1：未映射取值的**路由默认档**是什么？**
候选：
- (a) 现状语义——视为需人工分类（安全，但完全保留积压）；
- (b) **类型已知、语义未映射** → 记录并通知 orchestrator 与实现会话，但**不生成任何 merge 交接**、不触发 `fix`；
- (c) 按关键词启发式猜 approve/changes 侧。
倾向：**(b)**，并明确排除 (c)（解析器猜语义与 §2.3 同源冲突）。合并交接依赖 approve 语义，未映射取值不得推定为 approve；同样也不得推定为 changes——否则未映射就等价于驳回。

**Q3. `DESIGN:` 的 `REJECTED` 副作用（关闭 proposal issue）是否只对**已映射**取值生效？**
倾向：**是**，且需在规范中明写。理由：副作用是规范赋予特定取值的**语义后果**；若未映射取值也触发副作用，则等于让自由文本获得与枚举相等的破坏力。见 §4 末。

**Q4. `@ <sha>` 锚定后缀在自由文本取值下的分界规则（§4 建议「行末最后一个 ` @ <7–40 位十六进制>`」）是否成立？**
倾向：**成立**。理由：B.3 的「门禁不依赖推导」段落要求标记行末 `@ <sha>` ＝ PR body 引用的 exact head ＝ 合并时 head 三者一致，锚定必须仍能机械提取。若 designer 另有规则，请给出。

**Q5. connector 交付形态（`## Primary Design Disposition` + `**Decision:** <V>`）是否纳入规范？**
现状事实：§1.3 第 8、9 条与 §1.2 第 4 行显示 designer 经 connector 的交付**首行是标题、不是标记**，取值在 `**Decision:**` 行、目标 SHA 在 `**Exact target:**` 行——**不是 B.3 语法**，无论取值是否映射都不匹配。
本文认为这**超出本提案范围**（本文讨论取值维度，不是标记存在性维度），但同属「接受集与实际用法脱节」的同一族，故提请一并裁定；若 designer 认为不属本次范围，**建议单列**，不要在本次顺带。
倾向：**不把 connector 模板纳入 B.3 语法**；改由 designer 侧调整 connector 输出，使其首行即 `DESIGN: <verdict>` + 次行 provenance。理由：规范 §6 三层结构要求「平台层与仓库层不得自行演化为第二真源」，把 connector 模板吸收为规范语法会**裂解标记语法**；调整交付端成本更低且不触规范。

**Q6. 是否授权在 `noos_docs` 落地本次裁定？（即本文 §3 的主张由谁写进 B.3）**
倾向：**由 designer 侧落地**。理由：B.3 属 canonical protocol，本仓不得自行演化为第二真源（规范 §6）。

## 8. 若不裁定

- §1.3 的 9 条 pending 不会自行消解：其 `action` 是「人工分类权威信号」，只能由人在 attended 轮次里逐条指定去向。
- 同类新标记会继续产生同类 pending。**`PARTIAL_ACCEPT` 在 2026-09-17 就被记录为待决规范修订，至 2026-09-20 已积累四份文档记录、零次规范修订**；本次不裁定，第 5 份记录与第 10 条 pending 是可预期的结果。
- 合并门禁本身**不受影响**：B.3 明文「门禁不依赖推导」，合并证据始终是 PR body 的 review 证据链接 + exact head + 合并时 head 三者一致，由 integrator 按 §4.2 逐项核对。本提案的缺失影响的是**唤醒与路由**，不是**授权**。

---

**本文提交仓库**：`futouyiba/noos-shuttle`，分支 `docs/b3-verdict-acceptance-set`。
**本文不改任何产品文件、不写运行时代码、不改 `noos_docs`；等待设计裁定。**
