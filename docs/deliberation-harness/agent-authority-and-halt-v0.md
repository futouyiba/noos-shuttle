# Agent 授权边界与急停（v0）——提案

> 提案，不是契约。本文件把 2026-09-19 讨论中人类已定的决定与随之而来的设计写下来。
> **当前裁定为 `PARTIAL_ACCEPT`**；§7.6 权限门另获 **Human `ACCEPT`**（精确来源见 §9），不扩大前述裁定。
> 本版吸收窄 delta；下一步须形成**新 exact head 并取得该 head 的 fresh independent review**，再进行 promotion/integration 检查。
> 涉及规范（noos_docs 附录 B / §4）的部分属规范级变更；没有 `futouyiba/noos_docs` 的**独立显式 Work Item**，不修改规范。
> **本提案不授权任何 implementation slice、merge、deploy、Issue closure 或运行时启用；在规范侧落地之前，canonical 级条款均无强制力。**

## 1. 背景

现状是：**每一个合并、每一次 push 都在等人类一句话。** 实践反馈是这道门大多不产生
安全增量，只产生串行化延迟——而延迟是有真实代价的（见 §2 的证据）。

同时存在一个真实但未立的缺口：**目前没有「停下」的机制。** 没有急停开关，只有
「提前拦住」这一种控制方式；一旦自动化程度提高，缺少事后制动会变成新的风险。

因此本提案做三件事：把 push 的射程澄清、把合并的授权从「人类点击」移到「integrator
裁量」、并补上一个真正会被强制读取的急停机制；第三件附带一个界面来降低使用成本。

## 2. 支撑证据（为什么值得改）

- **PR #55**：designer 窄复审 09-18 03:56 通过 → 09-19 10:13 合入，**约 30 小时**。
  拆开后发现其中一大段不是「等人点」，而是**那条 APPROVE 根本没被投递出去**（躺在
  watcher 的 `pending` 里，直到会话手工补投）。
- **PR #53**：带 11 项 required delta 的设计裁定在线上**躺了两天**无人动，同样是补投才唤醒。
- **#57/#58**：两条 docs 记录修订**从未被立任务**，直到补投后才有会话去读 resume condition。

含义：**延迟里有一部分是投递故障，不是授权门。** 所以两件事必须分开做、并分别度量，
否则会把投递 bug 记到治理头上。（投递层加固见 PR #70，尚未合并。）

## 3. 已定的人类决定（不再重开）

| # | 决定 |
| --- | --- |
| 1 | **合并只能由 integrator 执行**；任何 implementer 不得自己合并到 main |
| 2 | **CI 不作为门**；由 integrator 执行它原有的检查 |
| 3 | **凭据/PII 风险不立条文**——实操中 agent push 前会主动提示，人类点击在这一件事上有效（已记入项目 memory，不写入治理） |
| 4 | **push 的例外不写进治理**，交给 agent 判断 |
| 5 | **合并分层不机械判**，裁量权给 integrator（理由：当前模型对此类判断足够好） |
| 6 | **两层都开**（docs/tests 与 src 常规修复） |
| 7 | **永久切换**，不设试行期 |
| 8 | **显式开启**：PR 打 label 才进入自动通道（默认不动） |
| 9 | 急停开关要解决「人类编辑麻烦」，需配 NOOS Shuttle 的一键界面 |

## 4. A｜push 射程

**问题**：`AGENTS.md` 的「push 只在用户明确要求时执行」被普遍读成「每次推特性分支都要请示」，
而它原本位于「跨分支 / Worktree Intake」一节，射程是**替别人迁入改动时别顺手推远端**。

**决定（A1）——经 designer 裁定修订**：

> **canonical governance 不新增「feature-branch push」的正向豁免规则。**
>
> 仓库层**可以**澄清现有 intake 句子的**局部射程**（即：那句话管的是 intake/迁入场景）。
> **离开 intake 之后的 push 是否执行，由 agent 根据当前 authority、风险与执行后果判断——
> 不建立新的规范级 allowlist。**

> **初稿错误**：初稿写「另加一句正面规则：推送自己 worktree 的特性分支属机械例外，免请示」，
> 并把它列入 §8 的 `noos_docs` 规范级修改清单。**designer 不接受**，理由是该写法
> **与 §3 已记录的人类决定直接冲突**——那里写着「push 的例外不写进治理，交给 agent 判断」。
> 即：**本提案自己把一条人类已经否决过的规则又写了一遍。**

**决定（A2）**：其余 push 情形（force-push、受保护分支、tag、他人分支）**不写进治理**，
由 agent 判断。为使判断有据，把这些动作的**后果**写进相应 skill 的**执行上下文**，而不是写成禁令：

- force-push 已发布分支 → 作废已发生的复审依据（reviewed exact head 被孤立），
  而 B.3 整条链都建立在 head 不变之上；
- push 到 main → 绕过合并门；
- push tag → 可能触发不可逆的发布。

（designer 原文认可这一区分：「后果可以进入 skill / execution context，**作为判断材料，而不是新的治理规则**」。）

**建议一项机制（非治理条文）**：main 用分支保护直接禁掉直推。机制比纪律可靠，且不占篇幅。

## 5. B｜合并授权与 integrator 裁量

**决定**：合并由 integrator 执行；它拿到的是**裁量权**，不是清单。常规修复可自行判定并合入；
它认为属于重大取舍、重大风险或显著副作用时，上报人类。

> **designer 裁定的核心模型（原文）**：
> 「Merge actuation remains exclusive to the Integrator, but ordinary eligible work **no longer requires a
> per-merge Human click**. The Integrator may merge under **delegated policy authority** after all canonical
> gates pass; material trade-offs, material risk, or significant side effects escalate to Human.」

**这是一次 canonical 级的授权模型变更，仓库层不能自行解释出来（designer 明确）**：

> 当前 canonical workflow 的 **B.0 明确把 merge 等敏感动作的授权保留给 Human**，因此
> **必须由 `noos_docs` 的 canonical protocol 正式修改授权模型**；
> **`AGENTS.md` 只能在 canonical 已授权之后，投影仓库细则。**

并明确一条总则：

> **Repository-local policy may parameterize an upstream-authorized merge lane;
> it may not create that merge authority by itself.**
>
> （仓库层策略**可以为一个上游已授权的合并通道提供参数**；它**不能自行创造**那个合并授权。）

> 这与**相邻 PR #77 的 Primary Design disposition 一致**：仓库层不能自行制造 canonical workflow
> 尚未授权的新 merge gate / authority system。

**取代人工点击的那些检查**（integrator 必须做，属其既有 §4.2 职责的延伸）：
**`noos:auto-merge` label 只作为进入 delegated lane 的显式 eligibility signal，本身不得替代以下任一项**：

1. review 结论带 provenance，且能对上**先于结论**的委派记录（B.3）；
2. 三方 head 一致：review 指向的 head ＝ PR body 记录的 head ＝ 实际合并 head；
3. **无生效中的 HOLD**（见 §6）；
4. 交付物与 PR 声明一致（纯文档就不应包含构建产物或运行时改动）；
5. **integrator 对当前 PR 的风险裁量**（designer 列为 label 不得替代的第四项）。

**「为何判为常规」——designer 裁定为强制项（MUST）**：

> Every merge executed through delegated auto-merge authority **MUST** leave an auditable classification
> basis in `INTEGRATED`: at minimum, one concise statement of why the Integrator classified this PR as
> routine rather than escalation-required.

理由（designer 原文的要点）：**不是为了把「常规 / 重大」重新机械化，而恰恰因为该分类被有意交给 integrator 裁量。**
若没有 durable rationale，则「integrator 裁量」只剩结果、看不到当时为何认为无需升级 Human，**事后无法复盘裁量是否失准**。

**适用范围**：**只约束 delegated auto-merge lane**；**不需要**给所有人类显式合并增加同样的负担。

**决定（B4）**：**投递链修复是自动合并的前置条件**。自动合并要求 integrator 先被告知
「门过了」，而那条链今天才修一半（PR #70 未合并）。可靠性上限＝投递链上限。

**决定（B6）**：进入自动通道需 PR 打 label（建议 `noos:auto-merge`）。默认不动。

## 6. C｜急停机制

**目标**：给「自动合并」配一个事后制动，并且**必须真的会被读到**。

### 6.1 形态

**这是 HOLD 语义的核心，初稿在此自相矛盾，本版按 designer 裁定重写。**

> **初稿错误**：初稿同时写了三件事——「带 SHA → 只停该 head」「push 不解除 HOLD」「不自动过期」。
> **designer 指出三者不能同时成立**：若 `@ sha1` 真的只约束 `sha1`，那么 push 到 `sha2` 后阻断自然消失，
> **等价于 push 绕过急停**。

**修正后的 SHA 语义（designer 原文）**：

> For a PR-scoped emergency HOLD, `@ <exact-head-sha>` is the **observation/provenance anchor** at which
> the latch was asserted; it is **not an expiry boundary**. A PR HOLD **survives subsequent pushes** and
> remains active until an explicit Human-authorized `HOLD_CLEARED`.
>
> 即：`HOLD: auto-merge @ abc123` 表示「**Human 在 abc123 这个已知 head 上拉下了该 PR 的 auto-merge 急停**」；
> **不是**「仅 abc123 禁止 merge，push 一个新 SHA 自动恢复」。

标记（首行，沿用 B.3 的严格语法）：

```
HOLD: auto-merge @ <exact-head-sha>          ← 带 assertion anchor
HOLD: auto-merge                              ← 无 anchor 的 location-scope HOLD
（human: via workbench）                      ← 必须表达 Human 权威来源
```

若将来真的需要「**只**禁止某一个 head」的功能，**应另立明确语义，不要复用 emergency HOLD**。

**Provenance 第二行必须表达 Human 权威来源（designer 明确）**：

> 不能继续用模糊的 `（<角色>: <交付方式>）`，因为本提案已明确 **authority only comes from Human**。

应写成 Human 权威来源，例如：

```
（human: via workbench）          ← 人类经工作台直接发出
（human: relayed by intg）        ← 人类经授权会话代写
```

**关键不变量（designer 原文）**：

> **An Agent may transport a Human HOLD, but may not originate one.**
> Provenance must preserve the **Human authority source** rather than making the relaying Agent appear to be
> the authority. `HOLD_CLEARED` 同样只能来自 Human authority。

**标记与 label 的关系——初稿有一处安全语义错误，本版更正**：

> **初稿错误**：初稿写「标记 + label，**两者都要**」，且未说明 source of truth。
> 若被读成「两者同时存在才生效」，**任何一次部分写失败都会使急停失效**。

**修正后（designer 原文）**：

> The **Human-authorized HOLD marker is the durable control record**.
> `noos:hold` is a **visibility/index projection, not a second source of authority**.
> **Missing or stale label state must never cancel a valid HOLD.**

**fail-closed reconciliation（四种情形）**：

| 情形 | 处置 |
| --- | --- |
| 有有效 HOLD marker、无 label | **仍然 HOLD**；并修复 label |
| 有 `noos:hold` label、**找不到有效 marker** | **不得自动 merge**；先 reconcile / 交 Human |
| marker 与 label 一致 | 正常 HOLD |
| 有有效 `HOLD_CLEARED` | 才解除 latch |

label：`noos:hold`。

### 6.2 位置决定范围

| 落点 | 范围 |
| --- | --- |
| PR | 停该 PR |
| 任务 issue | 停该工作项相关 PR |
| 指定协调 issue | 全局冻结 |

**但规范与仓库层的职责必须分开（designer 明确）**：

> **Canonical protocol** defines HOLD as a **merge-blocking Human control latch**；
> **repository policy** defines how task/global locations are **resolved to concrete PRs**.

> **否则**仅在 `AGENTS.md` 中规定「HOLD 必须阻断 merge」，会**重现 PR #77 已经裁掉的那个问题**：
> **仓库层自行制造 canonical 未授权的 merge gate。**

### 6.3 解除与生命周期

- 解除：**只能由 Human authority** 留 `HOLD_CLEARED: <同范围>` 并移除 label（provenance 同 §6.1 的要求）。
- **不自动过期**。会过期的急停不是急停。
- **权威只来自人类**。会话可代为转达，但**不得发起**（§6.1 的不变量）。

### 6.4 强制检查点（最要紧的一条）

**designer 批准此点，并明确它必须进入 canonical merge semantics，而不仅是仓库细则**：

> **Before any delegated auto-merge actuation, the Integrator MUST resolve applicable Human control latches
> and MUST NOT merge while an effective HOLD exists.**

配套（designer 明确）：

> **watcher 抑制 merge handoff 可以作为优化，但不能成为正确性依赖。**
> 即使 watcher 漏投或错误投递，**integrator 自己的最终 pre-merge check 仍必须拦下**。

格式写错可以改；**没人读就完全白做**。

### 6.5 与 watcher 的关系

生效中的 HOLD 应抑制**合并交接**的投递（review 通知本身仍可送达，那是事实）。
即：HOLD 不阻断唤醒，阻断的是「请合并」这一步。

### 6.6 规范含义（**经 designer 裁定，本版重写**）

> **初稿错误**：初稿写「`HOLD` 会成为 B.3 标记词表里的**第 5 个标记**」，
> 把它描述成与现有四个**完全同类的** agent output marker。**designer 不接受该描述。**

**现有四类标记是 workflow outcome / delivery markers**：`REVIEW:` / `DESIGN:` / `IMPLEMENTED:` / `INTEGRATED:`
——它们是**agent 的判定/交付**。

**而 HOLD 的性质不同（designer 原文）**：

> **HOLD is a Human control latch, not an Agent verdict.** It may share B.3's strict marker grammar and
> audit machinery, but **its authority class must remain distinct** from REVIEW / DESIGN / IMPLEMENTED / INTEGRATED.

**故 B.3 应显式分成两类**：

| 类别 | 成员 | 性质 |
| --- | --- | --- |
| **Workflow markers** | `REVIEW` / `DESIGN` / `IMPLEMENTED` / `INTEGRATED` | agent 的判定与交付 |
| **Human control markers** | `HOLD` / `HOLD_CLEARED` | **人类控制闩锁** |

其中（designer 原文）：

> **A HOLD can only remove actuation eligibility; it can never grant it.**
> `HOLD_CLEARED` only removes that veto and **never, by itself, authorizes a merge**.

**这样仍保持「GitHub 评论不是正向授权介质」这一原则**：
**HOLD 是 Human-originated deny latch，而不是通过评论授予 merge 权限。**

（补记：本仓已确认的那类缺口——**协议缺少符号时人会自造，然后全链路不认**（`PARTIAL_ACCEPT` 即如此）
——在本项上依然成立，所以符号应当一并补进词表；但**归类必须是「人类控制标记」而非「第 5 个 workflow marker」**。）

## 7. C+｜NOOS 工作台（界面设计）

### 7.1 名字

**「NOOS 工作台」（NOOS Workbench）**。

理由：它是**人类侧的仓库工作流控制台**，与 watcher（自动唤醒层）互为对照——watcher
自动路由，工作台手动动作。急停是它的第一个动作，但不止于此。

（备选：「NOOS 集成台」——更贴当前用途，但「集成」与 Integrator 角色易混。）

### 7.2 出现条件

访问 **github.com 的 PR / issue / 仓库页**时，Shuttle **不显示现有的 ChatGPT 子面板**，
改显示工作台面板。

这是一处需要明说的结构变化：目前扩展只有「provider 页面」一类宿主，工作台引入了
**第二类宿主**。`src/shared/provider-identity.ts` 的 provider 列表与工作流宿主应分列。

### 7.3 v0 内容

- 顶部：当前对象（`PR #N` / `issue #N` / repo）与其状态
- **急停区**：
  - 未 hold：「急停自动合并」+ 范围选择（本 PR / 本工作项 / 全局）
  - 已 hold：显示生效中的 HOLD（谁、何时、范围、标记链接）+「解除急停」
- 显示该 PR 是否带 `noos:auto-merge` / `noos:hold` label
- 预留：后续工作流动作的挂载位

### 7.4 一键动作做什么

一次点击完成：**贴标记评论 + 打/移 label**。且必须**幂等**——已 hold 时不重复贴。

### 7.5 架构：不要在浏览器里持 GitHub 凭证

有两条实现路径，**强烈建议后者**：

| 路径 | 做法 | 问题 |
| --- | --- | --- |
| A | 内容脚本直接调 `api.github.com` | 需要把 GitHub token 放进浏览器扩展——**凭证风险，且与决定 3 的精神相悖** |
| B | 面板 → background → **NOOS Hub** → 本机 `gh` 执行 | 无浏览器凭证；复用既有通道 |

**建议 B。** 依据：`src/background/service-worker.ts` 已有「内容脚本 → Hub 本地 HTTP
（`127.0.0.1:17642`）」的既有通道（`carrier-focus` 即此类）；本机 `gh` 的 token 已含
`repo` scope，**今天就能发评论、加 label**，无需新凭证。

### 7.6 权限扩张（**已获人类授权**）

`github.com` 目前**不在** `public/manifest.json` 的 `host_permissions`，也不在
`content_scripts.matches`。工作台需要两者都加——**这是权限扩张，用户更新时会看到提示**，
且意味着扩展可读写所有 GitHub 页面。

**人类已于 2026-09-20 明确 ACCEPT 该权限扩张**（narrow re-adjudication 中唯一被保留为
`NEEDS_HUMAN` 的门，已闭合；裁定记录见**附录 B**）。授权的射程以裁定原文为准：

- 仅限本 Work Item 的工作台 / HOLD 交互面**实际所需的 GitHub 面**（`github.com` 加入
  `host_permissions` ＋ 对应 `content_scripts` 覆盖）；
- **不得**据此一般化为更宽的 host 覆盖——更宽需新的授权；
- 该授权**只解决权限面问题**，不激活 delegated auto-merge、HOLD 强制、canonical workflow
  变更、部署或任何实现切片；实现 PR 仍走各自 exact-head 复审与晋升门。

### 7.7 边界

- 工作台**只做刹车，不做油门**：v0 不得包含合并、推送、关单等动作。
- 它不绕过任何门：贴的标记是**人的动作**，不替代 review 或 head 检查。

## 8. D｜这些规则写在哪（**经 designer 裁定，本版重写**）

原则是**分层落位**：越靠近权威模型越进规范，越靠近操作越留仓库。
**但初稿在这一点上犯了两处错，本版按裁定更正。**

| 内容 | 落点 | 理由 |
| --- | --- | --- |
| **合并授权从「人类点击」改为「integrator 裁量」** | **`noos_docs` canonical protocol** | designer：**这不是仓库层可以自行解释出来的权限**——canonical B.0 明确把 merge 授权保留给 Human，**必须由规范正式修改授权模型**；`AGENTS.md` 只能在 canonical 已授权后**投影** |
| **`HOLD` / `HOLD_CLEARED` 作为 Human control markers 进 B.3** | **`noos_docs` canonical protocol** | 同上：符号与其 authority class 属协议 |
| **「HOLD 阻断 auto-merge」这条规则本身** | **`noos_docs` canonical protocol** | designer 明确：**否则仅在 `AGENTS.md` 规定它，就是仓库层自行制造 canonical 未授权的 merge gate**（即 PR #77 已裁掉的那类问题） |
| **「每次 delegated auto-merge 须在 `INTEGRATED` 记录判为常规的依据」** | **`noos_docs` canonical protocol** | designer：应成为 **canonical requirement**，而非建议 |
| **intake 句子的局部射程澄清** | **`AGENTS.md`**（仓库层） | designer：仓库层**可以**澄清现有 intake 句子的局部射程 |
| `HOLD` 的 **task/global 范围如何解析到具体 PR**、label 名（`noos:hold`）等仓库细则 | **`AGENTS.md`** | Canonical 定义「HOLD 是阻断 merge 的人类控制闩锁」；**仓库层定义「位置如何解析到具体 PR」** |
| push 后果（force-push 作废复审依据等）、watcher 遇 HOLD 抑制合并交接 | **`.claude/skills/`** | designer：后果可进 skill / execution context，**作为判断材料，而非治理规则**。watcher 抑制是**优化，不是正确性依赖** |
| 工作台面板、Hub 的 GitHub 写通道 | **代码** | 机制 |
| 凭据风险的「已考虑、不立规」 | **项目 memory**（按决定 3） | 防止重复讨论，不占治理篇幅 |

> **初稿错在哪**：初稿把「**push 的机械例外**」列为待进规范的条目——**该条与 §3 的人类决定冲突，已被 designer 拒绝**（见 §4）。
> 即：**本提案自己把一条人类已否决的规则又列了一遍。**

**总则（designer 原文）**：

> **Repository-local policy may parameterize an upstream-authorized merge lane;
> it may not create that merge authority by itself.**

**顺序**：规范先改（否则后续都无据），再改 `AGENTS.md`，再改 skill，最后实现面板。
**在规范落地之前，本提案涉及的 canonical 级条款均无强制力。**

## 9. 待裁定 / 待实现

**需 Epic Designer 裁定 —— 已于 2026-09-20 裁定 `NEEDS_REVISION`**（裁定记录见**附录 A**；其后同 head 的 narrow re-adjudication `PARTIAL_ACCEPT` 与人类 §7.6 授权见**附录 B**）：

1. 三条规范级变更是否成立 → **1(a) push：PARTIAL_ACCEPT 但必须修订**（删去 canonical 层豁免）；
   **1(b) 合并授权：ACCEPT，但须由规范侧显式落地**；**1(c) HOLD 入 B.3：接受概念，精确语义已修订**。
2. 「自动合并须记录判为常规的理由」是否作为强制项 → **ACCEPT，作为 MUST**（只约束 delegated lane）。
3. `HOLD` 的精确形态 → **NEEDS_NARROW_REVISION**，五项已按其裁定修订（见附录 A 的逐条处置）。

**需人类确认**：

4. ~~§7.6 的权限扩张是否可接受~~ → **已确认：ACCEPT（2026-09-20）**，见 §7.6 与附录 B。

**实现切片（裁定后由 orchestrator 拆；narrow re-adjudication 要求每个切片显式标注其所属层）**：

- 切片 1：`HOLD` / `HOLD_CLEARED` 的识别与 integrator 前置检查（skill + AGENTS.md）——*repo-local projection*
- 切片 2：watcher 遇 HOLD 抑制合并交接——*repo-local projection / 优化*
- 切片 3：Hub 的 GitHub 写通道（评论 + label）——*Shuttle/Hub implementation*
- 切片 4：工作台面板 v0（github.com 内容脚本 + 急停区）——*Shuttle implementation，含 §7.6 已授权的权限面*
- 切片 5：自动通道 label 与 integrator 的自动合并流程——**canonical authorization change，前置＝`noos_docs` 显式 Work Item**

不得用一个仓库层 merge 同时「激活」多层（narrow re-adjudication required delta #5）。

## 10. 未决与风险

1. **裁量权的可复核性**依赖 §5 那句「为何判为常规」被真的执行。若不执行，本提案等于
   把门交给不可回查的判断——这是本提案最主要的残余风险。
2. **自动合并的可靠性上限＝投递链上限**（§5 B4）。PR #70 未合并前不宜开。
3. **权限扩张**会记录在扩展权限里，且对现有用户是一次可见变更。
4. **面板的站点适配**：GitHub 页面结构（PR/issue）会被改版，选择器需按现有 ChatGPT
   适配同样的方式隔离与测试。
5. 本文未涉及：是否需要按仓库/组织区分（当前仅 `futouyiba/noos-shuttle`）。

## 附录 A：Epic Designer 裁定记录

**Exact target**：`docs/deliberation-harness/agent-authority-and-halt-v0.md` @ `20d2b418ff3a4943bccecbb39f40ea72733dcc72`
**Decision**：`NEEDS_REVISION`　**来源**：`des: direct in ChatGPT, 委派: 人`
**裁定范围**：只覆盖 §9 请求的三项设计问题；**不授权**实现、修改 canonical workflow、merge、deploy 或 closure。

### 逐条处置

| # | designer 的 required revision | 本版处置 |
| --- | --- | --- |
| 1 | **删除 canonical 层的「feature-branch push mechanical exception」**；只保留 intake 射程澄清，并与 §3 的人类决定 #4 对齐 | §4 A1 重写；§8 的规范级清单删去该条，并注明**初稿把人类已否决的规则又列了一遍** |
| 2 | **将 integrator delegated merge authority 明确写成 canonical-level authority change**，保持 repo policy 只是其 projection/parameterization | §5 重写：引 designer 原文与「**may parameterize … may not create**」总则；§8 落点表同步 |
| 3 | **将「自动合并为何判为常规」设为 `INTEGRATED` 的 MUST audit field** | §5 该条升为 **MUST**，并写明**只约束 delegated lane** |
| 4 | **把 B.3 分清 workflow marker 与 Human control marker**；纳入 `HOLD` / `HOLD_CLEARED` | §6.6 重写：两张表分列；引「**A HOLD can only remove actuation eligibility; it can never grant it**」 |
| 5 | **修正 SHA HOLD 与「push 不解除」的矛盾**：SHA 是 assertion anchor，不是自动 expiry boundary | §6.1 重写，含 designer 原文与「`@ abc123` 表示什么／不表示什么」的对照 |
| 6 | **明确 HOLD marker 与 `noos:hold` label 的 source-of-truth / mismatch fail-closed 规则** | §6.1 新增：marker 是 durable control record、label 是投影；**四种情形的 fail-closed 处置表** |
| 7 | **明确「HOLD 阻断 auto-merge」本身由 canonical protocol 授权**；`AGENTS.md` 只定义 task/global scope resolution、label 名等仓库细节 | §6.2 与 §6.4 重写；§8 落点表同步 |

### 裁定明确「不接受」的部分

- **不接受**把「推送自己 worktree 的特性分支属机械例外」写入 canonical governance；
- **不接受** §8 把「push 的机械例外」列入 `noos_docs` 规范级修改；
- **不接受**把 HOLD 描述成与现有四个**完全同类**的「第 5 个 agent output marker」。

理由（designer 原文要点）：第一条与**本文 §3 已记录的人类决定直接冲突**——
那里写着「push 的例外不写进治理，交给 agent 判断」。

### Resume condition

> 完成上述**窄修订**后，可在**新 exact head** 回来做一次 **narrow re-adjudication**；
> **不需要重新讨论**已由 Human 固定的分层、CI、凭据风险、两层开启、永久切换或 label opt-in 决定。

**本版即对该 resume condition 的回应；下一步是那个新 head 上的 narrow re-adjudication。**

## 附录 B：narrow re-adjudication ＋ 人类权限授权（记录）

对附录 A resume condition 的回应已获裁定。本附录**转录**两轮裁定原文要点；不重开任何已裁事项。

**Provenance**

| 轮次 | Decision | Exact target | 来源 | Governor event |
| --- | --- | --- | --- | --- |
| narrow re-adjudication（2026-09-19T23:49Z） | **`PARTIAL_ACCEPT`** | 本文档 @ `a2b5d650a7e42826827929bf17ac98dd07783a87`（PR #79） | PR #79 评论 | `event=pr79-narrow-readjudication head=a2b5d650… action=primary-design-disposition` |
| Human permission authorization addendum（2026-09-20T00:36Z） | **`ACCEPT`**（仅 §7.6 权限门） | 同上 | PR #79 评论 | `event=pr79-human-github-permission-accept head=a2b5d650… action=human-permission-authorization` |

**narrow re-adjudication 认定成立的修订方向**（designer 原文要点，转录）：
feature-branch push 豁免未被升格为 canonical allowlist；delegated auto-merge 被正确识别为
canonical authorization model change；delegated lane 的 `INTEGRATED` 须留「为何判为常规」的
可审计 rationale（未扩张到 Human 显式 merge）；`HOLD`/`HOLD_CLEARED` 正确收敛为 Human
control latch；PR-scoped HOLD 的 SHA 是 assertion/provenance anchor 而非 expiry boundary；
HOLD marker 是 durable control record、label 只是投影；watcher 抑制只是优化而非 correctness
dependency。**但 proposal 尚未获得实施授权**——delegated merge/HOLD 的强制语义仍需
`noos_docs` canonical protocol 的独立 Work Item 正式落地。

**Required delta（5 条，转录）与本版处置**

| # | designer 要求 | 本版处置 |
| --- | --- | --- |
| 1 | 保持 7 项修订，不重新引入 repo-local merge authority、push allowlist 或 label-as-authority | 保持（§5/§6/§8 未回退） |
| 2 | 删除 §4 重复出现的同一句「main 用分支保护直接禁掉直推」 | **本版已删**（纯文档卫生） |
| 3 | §7.6 权限扩张保持 explicit `NEEDS_HUMAN` gate，Human 授权前不得写成已决定 | 该门已被下一轮 Human addendum 闭合 → §7.6 改记**已授权**并录 provenance |
| 4 | canonical workflow 的 delegated merge/HOLD 条款只能作 proposal 输出；无 `noos_docs` 显式 Work Item 不得修改 noos_docs、不得声称已生效 | §8「规范先改」与「落地前无强制力」原句保持 |
| 5 | implementation slices 须区分 canonical / repo-local projection / Shuttle 实现，不得一个 repo-local merge 同时激活三层 | §9 切片表逐条标注所属层 |

**Human addendum（2026-09-20）确认**：人类明确 ACCEPT §7.6 的 `github.com`
`host_permissions` + `content_scripts` 扩张（仅限本 Work Item 所需的 GitHub 面）。该授权
**只**解决权限面；不激活 delegated auto-merge、HOLD 强制、canonical 变更、部署或实现切片。

**Resume condition（两轮合成，转录）**：proposal 吸收窄 delta ＋ 人类授权形成**新 exact
head**，随后取得该新 head 的 **fresh independent review**，方可进入任何 promotion /
integration 检查。**本版即该新 head 的载体。**
