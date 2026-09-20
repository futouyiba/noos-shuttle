# ChatGPT Provider Recovery / Go × N Proposal v0

> Issue: [futouyiba/noos-shuttle#54](https://github.com/futouyiba/noos-shuttle/issues/54)  
> Status: research + design proposal only; not an implementation contract  
> Source handoff: `.noos/handoffs/active/chatgpt-provider-recovery-go-n-handoff.md`  
> Decision provenance: [Issue #54 designer record](https://github.com/futouyiba/noos-shuttle/issues/54#issuecomment-5712703481)

## 1. Scope and evidence posture

本文件只提出候选语义、证据门禁和后续实现切片；不改变运行时代码，不自动刷新页面、不点击 ChatGPT Retry、不发送“继续”，也不执行 context rebase。没有真实 dogfood 或 provider-version-specific 证据的结论统一标记为 `PENDING_VALIDATION`，不把工程推断写成 ChatGPT 事实。

### 1.1 研究问题

覆盖四类异常：

1. 前端断联或长连接中断：服务端是否仍执行、reload 是否回到同一 conversation、identity 如何证明。
2. provider 硬中断或 assistant turn 中断：是否已接受、部分输出与确定性终止如何证明、“继续”何时安全。
3. 消息发送失败与 provider-native Retry：原 user turn 是否进入 conversation、Retry 的目标与副作用、与 Shuttle dispatch 的竞态。
4. context limit：稳定错误 surface、为何 refresh/继续无效、bounded context pack 与 conversation rebase。

### 1.2 证据等级

- `REAL_DOGFOOD`: 在真实 ChatGPT conversation 上观察并记录的脱敏证据；应包含时间、conversation/binding/run/operation ref、消息计数与 fingerprints、generation/stop/composer 状态、动作和结果。
- `FIXTURE`: 已冻结且可复现的测试夹具；不能冒充 provider 事实。
- `PUBLIC`: provider 公开文档或公开资料；不能替代当前版本 adapter 语义验证。
- `INFERENCE`: 从当前实现或协议推导；必须显式标注。
- `PENDING_VALIDATION`: 尚无足够证据，自动化必须 fail-closed。

禁止主动制造限流、绕过安全策略、探测凭据或进行破坏性实验。

## 2. Evidence table

| 场景 | 当前可确认的证据 | 尚不能确认的事实 | 安全结论 / 下一步证据 |
| --- | --- | --- | --- |
| 前端断联、reload | `RuntimeObservationLedger.suspend()/resume()` 使 carrier 进入 `SUSPENDED`/`RECOVERING`。[runtime-observer.ts](../../src/content/runtime-observer.ts#L99-L109) `normalizeObservation` 以 provider route + conversation ref 形成 `sourceEpoch`，quiet window 为 2 秒。[runtime-observer.ts](../../src/content/runtime-observer.ts#L24-L61) `reconcileActiveSubmission` 将 route、conversation ref、消息计数、fingerprints、generation、provider failure 与 dispatch fence 一起回送 ledger。[index.ts](../../src/content/index.ts#L3378-L3403) | ChatGPT 服务端是否继续执行、reload 后是否恢复同一 generation/结果、当前版本是否保持 conversation identity：`PENDING_VALIDATION`。DOM route 相同本身不证明服务端执行连续。 | `UNKNOWN/UNCERTAIN` 只允许 bounded wait/re-observe/reconcile。只有同一 provider conversation/binding、无 execution-owning ambiguity 且有 refresh-safe 证据时，才可候选 refresh；refresh 只恢复观察能力，不隐含重发。需后续 REAL_DOGFOOD 记录 reload 前后 identity、head 与 message fingerprints。 |
| provider 硬中断、assistant partial output | 当前 observer 仅有 `GENERATING`、quiet 后 `STABILIZING`、`BROKEN` 等 operational state；`lastAssistantExcerpt()` 可采集末尾最多 2,000 字符作为候选证据。[runtime-observer.ts](../../src/content/runtime-observer.ts#L6-L76) [index.ts](../../src/content/index.ts#L1928-L1935) | 部分输出是否已持久化、generation 是否“确定异常终止”而非 UI 暂停/完成显示异常：`PENDING_VALIDATION`。 | 已接受的 user turn 永远不能 Shuttle resend。只有 assistant partial output 可观察、generation definite interruption、same binding/head、无副作用歧义且无人介入，才可候选 `CONTINUE_PROVIDER_TURN`；否则 HUMAN_REQUIRED。 |
| 发送失败、原生 Retry | `SubmissionOperation` 持久化 `PREPARED → DISPATCHING → OBSERVED_ACCEPTED/UNCERTAIN/FAILED_SAFE → COMPLETED`；reconcile 以 conversation、route、payload fingerprint、计数/fingerprint 变化、generation 和 fence 判断 acceptance。[submission-operation.ts](../../src/core/submission-operation.ts#L1-L20) [submission-operation.ts](../../src/core/submission-operation.ts#L300-L340) | ChatGPT Retry 的确切目标 turn、是否重新生成而非重新提交、是否重跑工具/外部副作用、provider/version 语义和可关联性：`PENDING_VALIDATION`。当前 generic ChatGPT 没有 adapter-specific evidence。 | `Shuttle retry` 只在 `PROVEN_NOT_ACCEPTED` 后允许；provider-native Retry 需独立 recovery attempt 和 provider/version evidence，不能因 DOM 存在 Retry 按钮自动执行。当前 generic ChatGPT 在证据缺失前为 HUMAN_REQUIRED。 |
| Retry 与 Shuttle 竞态 | claim 只允许合法 authority/fence，且拒绝同一 execution target 的另一个 execution-owning operation；content dispatch 需 READY、当前 composer 与 observation/fence 一致。[submission-operation.ts](../../src/core/submission-operation.ts#L86-L106) [index.ts](../../src/content/index.ts#L1460-L1527) | provider 手动 Retry 与 extension ledger 是否能被完整关联：`PENDING_VALIDATION`。 | V0 中 Human 手点 provider Retry 视作 `USER_INTERVENTION`；未经显式可关联 `HumanRecoveryAction` 不得并入自动 recovery。 |
| context limit / conversation rebase | ContinuationRun 已有 `CONVERSATION_REBASE_REQUIRED` stop reason，当前实现直接将 run 置为 `FAILED_SAFE/ENDED`。[continuation-run.ts](../../src/core/continuation-run.ts#L229-L234) | provider context-limit surface 的稳定 DOM/文案、是否可通过 reload 或继续恢复：`PENDING_VALIDATION`。 | context rebase 不是普通 reload 或 interrupted generation 的别名；需进入 Continuity workflow，以新 continuation authorization 建立新 Provider Conversation。不得刷新循环或原样发送“继续”。 |

## 3. Current implementation gap analysis

### 3.1 已有安全基础

- **Exactly-once submission ledger**：operation 的 durable state、dispatch fence、authority、payload fingerprint 与 reconciliation 已存在；`OBSERVED_ACCEPTED` 是不可逆的接受证据，terminal operation 不允许普通 reconciliation 复活。[submission-operation.ts](../../src/core/submission-operation.ts#L64-L65) [submission-operation.ts](../../src/core/submission-operation.ts#L300-L340)
- **Stable-turn gate**：content 侧先取得 READY/stable observation，再 claim/actuate composer；生成控件、composer 和 provider error surface 由 adapter observation 归一化。[index.ts](../../src/content/index.ts#L1469-L1506) [runtime-observer.ts](../../src/content/runtime-observer.ts#L41-L76)
- **Carrier/fence 保护**：source epoch、execution instance、carrier ref 与 dispatch fence 用于拒绝 stale page/worker evidence；reload adoption 会先 `recover`/reconcile，不直接重发。[index.ts](../../src/content/index.ts#L3337-L3375)
- **Go × N 基本预算**：正常 acceptance 或 stable `COMPLETED` 只消费一次 continuation slot；单一 pending operation 和 provider/binding 检查阻止并发正常 GO。[continuation-run.ts](../../src/core/continuation-run.ts#L113-L121) [continuation-run.ts](../../src/core/continuation-run.ts#L155-L181)
- **用户介入与 Stop 的现有方向**：foreign user message 触发 `USER_INTERVENTION`；`HUMAN_STOP` 使 run 取消；现有测试覆盖这些状态转换。[continuation-run.ts](../../src/core/continuation-run.ts#L210-L221) [tests/continuation-run.test.ts](../../tests/continuation-run.test.ts#L150-L167)

### 3.2 与本 proposal 的差距

1. **Provider error taxonomy 不足**：`SubmissionObservation.providerFailure` 与 `RuntimeProbeSnapshot.providerErrorSurfacePresent` 是 boolean；无法区分 context limit、policy/auth/security challenge、rate limit、transient transport、assistant-generation interruption。任何细分都应先有 adapter-specific evidence，未知保持 `UNKNOWN/UNCERTAIN`。
2. **Recovery operation 尚未建模**：当前 `SubmissionOperationKind` 主要是 `GO`、`REANCHOR_GOAL` 等，未有 provider-native Retry、Shuttle retry、`CONTINUE_PROVIDER_TURN` 的独立 operation/provenance 类型。不能把三者塞进同一个 GO operation。
3. **Run 在 recovery/rebase 上过早 terminal**：`CONVERSATION_REBASE_REQUIRED`、`CARRIER_FAILURE`、`OPERATION_UNCERTAIN` 当前直接 `FAILED_SAFE/ENDED`；这不表达 same-conversation recovery 的 `PAUSED/RECOVERING`，也不表达 binding change 后必须新授权的 Continuity handoff。
4. **Go budget 与 recovery budget 尚未分离**：当前 `ContinuationRun` 只有 `maxContinuations/consumedContinuations`；没有按 interrupted round 计数的 bounded recovery attempt、时间/观察次数或 exhausted → HUMAN_REQUIRED 语义。
5. **Assistant accepted/interrupted 分支尚未实现**：当前 reconciliation 只负责将 operation 推进到 accepted/completed/uncertain；没有依据 partial output + definite interruption 选择 native Retry 或 `CONTINUE_PROVIDER_TURN`，也没有明确禁止 Shuttle resend。
6. **Terminal late evidence 缺少 contradictory-late-evidence 账本语义**：普通 terminal operation 会拒绝 transition，但 proposal 需要保留“late acceptance 与 `FAILED_SAFE/CANCELLED` 矛盾”的审计记录并进入 human/invariant handling，而非静默丢弃。
7. **Duplicate tab / canonical lease 的 recovery actuation 规则需补充**：现有 fence 可拒绝 stale execution，但尚未定义 recovery lane 的 canonical lease holder、carrier identity 变化但 binding 不变的 resume 条件。
8. **Context pack / Continuity seam 不在当前实现**：当前 rebase 仅 stop；没有 hard shell、working digest、source/destination fence、binding commit、C1 superseded 与 late output evidence-only 规则。
9. **Evidence 采集不等于 evidence gate**：assistant tail 和 provider error surface 可作为候选材料，但并不自动证明 provider semantics、accepted turn 或 safe refresh；不能由 Harness 从 `next_action` 生成计划。

## 4. Evidence Gate

以下是本 proposal 对 designer 已给出的决定性裁定的规范化落点；引用保留原文，不把推测提升为事实。

> **Unknown is not permission to recover by side effect. In `UNKNOWN / UNCERTAIN`, NOOS may wait, re-observe, and reconcile; it may not refresh, Retry, resend, send “继续”, or rebase until the action-specific evidence gate is satisfied.**

### 4.1 Action-specific gates

- **WAIT / REOBSERVE / RECONCILE**：`UNKNOWN/UNCERTAIN` 的唯一自动路径；必须 bounded by time/observation count。它不扣 Go slot，也不改变 operation 的 acceptance 结论。
- **REFRESH**：要求同一 Provider Conversation/binding、无 execution-owning ambiguity，并有 refresh-safe evidence，至少不能破坏 draft、attachment 或 ephemeral Human state。reload 后先重新观察、恢复/对账，不立即 dispatch。普通 carrier identity 改变不是 rebase 充分条件。
- **provider-native Retry**：不能因为按钮存在而执行；必须有 provider/version-specific evidence，明确 Retry 目标 turn、是 regenerate 还是 resubmit、是否重跑工具/副作用、以及动作与 ledger 的关联性。当前 generic ChatGPT 证据缺失，结论为 `HUMAN_REQUIRED`。
- **Shuttle retry**：只允许在原 operation 获得 `PROVEN_NOT_ACCEPTED` 后，以新 dispatch attempt/fence 进行；`UNCERTAIN` 绝不能当作未接受。
- **CONTINUE_PROVIDER_TURN**：要求原 user turn 已确定接受、assistant partial output 可观察、generation 已确定异常终止、same binding/head、无未决副作用、无 Human intervention。它不是原 prompt 的重发。
- **Context rebase**：只在 same-conversation recovery 不再安全/可行或 Human 明确要求时进入；context-limit surface 仍须先达到可归类证据门禁。

### 4.2 Provider accepted + Assistant interrupted

> **A provider-accepted user turn whose Assistant generation later interrupts must never be Shuttle-retried. Recover the Assistant side only: use a provider-native Retry only under verified provider semantics, otherwise use `CONTINUE_PROVIDER_TURN` when its evidence gate and remaining Go budget permit; ambiguity fails closed.**

因此，原 `SubmissionOperation` 保持 accepted，原 Go slot 已消耗。provider-native Retry 若没有 adapter-specific evidence 不得自动执行；满足 continue gate 时，`CONTINUE_PROVIDER_TURN` 才是候选的新 user turn。无剩余 Go slot，或任一证据不确定，均为 HUMAN_REQUIRED。

## 5. Operation / Budget / Provenance

> **`provider-native Retry`, `Shuttle retry`, and `CONTINUE_PROVIDER_TURN` are three different operations. Native Retry regenerates provider work for an already-accepted user turn; Shuttle retry retries an original user submission only after `PROVEN_NOT_ACCEPTED`; `CONTINUE_PROVIDER_TURN` creates a new user turn and therefore consumes one Go × N continuation slot on acceptance.**

### 5.1 Operation graph

```text
original dispatch = original SubmissionOperation
  ├─ PROVEN_NOT_ACCEPTED
  │    └─ Shuttle retry = new dispatch attempt/fence of same logical operation
  ├─ accepted + assistant interrupted
  │    ├─ provider-native Retry = independent recovery attempt, no new user turn
  │    └─ CONTINUE_PROVIDER_TURN = new SubmissionOperation / new user turn
  └─ UNKNOWN/UNCERTAIN
       └─ WAIT + REOBSERVE + RECONCILE only
```

- Original dispatch 与 Shuttle retry 共享 logical operation identity，但每次 retry 必须有新的 dispatch attempt/fence/provenance；最终 acceptance 对同一 user turn 只计一次，不额外扣 Go slot。
- provider-native Retry 不创建 user turn，不扣 Go slot，但消耗 recovery attempt，并必须记录 provider/version、目标 accepted turn、证据摘要、执行者和结果。
- `CONTINUE_PROVIDER_TURN` 是新的 `SubmissionOperation`、新的 user turn；provider acceptance 时同时消耗一个 Go slot 和一个 recovery attempt。它不得复用原 operation id 或 payload fingerprint 作为原始提交。
- Refresh、passive re-observation、reconciliation 不扣 Go slot；bounded refresh 若被允许，仍应记录 observation/recovery provenance。

### 5.2 RecoveryBudget

```text
RecoveryBudget
= bounds recovery attempts for one interrupted Go×N round

WAIT / passive re-observation
→ bounded by time / observation count, no Go slot

REFRESH / provider-native Retry / Shuttle retry
→ consume recovery attempt

CONTINUE_PROVIDER_TURN
→ consume recovery attempt
+ on provider acceptance consume one Go×N continuation slot

RecoveryBudget exhausted
→ HUMAN_REQUIRED
```

不在本 proposal 引入 scoring 或新的复杂 state machine；后续实现只需确保 budget 独立、持久化、幂等和可审计。

### 5.3 Terminal and late evidence

> **Recovery does not create free semantic turns. Recovery attempts have an independent bounded recovery budget; when a recovery action creates a new user turn, it is additionally subject to the remaining Go × N budget.**

> **Same-conversation recovery pauses a ContinuationRun; a Provider Conversation rebase ends that Run. Remaining Go × N budget never crosses a binding change as actuation authority.**

`COMPLETED` 的重复 evidence 必须幂等；terminal operation 不得因迟到 evidence 被静默复活。与 `FAILED_SAFE/CANCELLED` 矛盾的 late acceptance 应记录为 `contradictory late evidence`，进入 Human/invariant handling，不暗改 terminal state。此要求是对现有 terminal transition refusal 的审计补强，不意味着允许重新 actuation。

## 6. Go × N Recovery Semantics

> **Same-conversation recovery pauses a ContinuationRun; a Provider Conversation rebase ends that Run. Remaining Go × N budget never crosses a binding change as actuation authority.**

### 6.1 Same-conversation recovery

- interrupted/uncertain recovery 将 run 置于候选 `PAUSED/RECOVERING`，不是结束；恢复期间禁止发下一正常 `go`。
- reload/reattach 后，只有同时满足以下条件，才可恢复同一 Run：同一 Provider Conversation + binding generation；head 未被 Human 改动；原 operation 已 reconcile；重新取得合法 lease/runtime eligibility。Browser Carrier identity 可以改变。
- `Stop` 设置硬 cancellation latch：取消所有尚未 actuate 的 refresh/retry/continue/recovery；已经外发的动作只能观察和对账，不能衍生下一动作。
- 任何不能归因于当前 Run/recovery operation 的 Human user input 都是 `USER_INTERVENTION` 并结束 Run；V0 中 Human 手点 provider Retry 同样算 intervention，除非未来定义显式可关联的 `HumanRecoveryAction`。
- duplicate tab 本身不结束 Run；只有 canonical lease holder 可 actuate，其他 tab 只能提供带 fence 的 observation。

### 6.2 Binding change and resume

> **Context rebase is not authorized by ordinary Go × N authorization. It ends the current Run, preserves the same Logical Thread, establishes a new Provider Conversation through the Continuity workflow, and requires a new continuation authorization after `RESUME_ELIGIBLE`.**

因此，carrier change、普通 reload、一次 interrupted generation 都不能直接触发 rebase；binding generation 改变时原 Run 的剩余 Go budget 不成为新 conversation 的 actuation authority。

**硬门（本 proposal 的明确要求）**：新 Provider Conversation 上的任何 `Go × N` 资格，必须被判据显式门在 `RESUME_ELIGIBLE` 为真之上——即 Continuity `BOOTSTRAP` operation 已完成、hard resume verification 通过、soft verification 无 mismatch。在该门为真之前，即使 binding 已 commit、C2 已是 canonical current，也不得发起新 Run、不得发出 `go`、不得因“已恢复工作位”而跳过 Goal/授权询问。`RESUME_ELIGIBLE` 为假、resume 校验未过或校验结果缺失，都必须作为 stop boundary 处理并保持 pause 状态，不得 fail-open 继续。

这一条与 §11.2 记录的 BCR §14 无条件断言**明确分歧**：本 proposal 不接受“Continuity Checkpoint + BOOTSTRAP + Resume Verification 已恢复当前工作位”作为无需验证的前提，采用 BCR §17-11 那样把 `RESUME_ELIGIBLE` 写入前置条件的一侧，并补上 BCR §9 stop boundary 列表缺失的对应项（`RESUME_ELIGIBLE` 为假 / resume 校验未通过）。判据是 CC §11 的 bootstrap 失败路径（binding 成功但 bootstrap 失败时 C2 仍为 canonical current）与 CC §14 的 `RESUME_ELIGIBLE` 定义；本 proposal 不继承未冻结文档的无条件断言。

## 7. Context Rebase

> **A rebase context pack transports Authority; it does not become Authority. Goal/Scope refs are mandatory when such durable Authority exists and must never be fabricated for an ordinary unmanaged chat. `next_action` is not mandatory and may only be carried as explicitly observed/entailed advisory material with provenance, never generated by the Harness as a plan.**

### 7.1 Trigger and identity

- `CONVERSATION_REBASE_REQUIRED` 只表示 current Provider Conversation 必须被替换；不是普通 reload、carrier change 或一次 interrupted generation。
- C1 → C2 保持同一 Logical Thread；binding commit 后 C1 superseded，C1 的 late output 只能作为 evidence，不自动 merge 到 C2。

### 7.2 Minimal context pack

**Hard shell（权威/门禁层）**：

- Logical Thread identity；
- source conversation、binding generation、source fence；
- 所有现存 Current Authority refs；
- 若存在 managed Authority，必须携带 Goal/Scope refs 与 fingerprints；普通 unmanaged chat 不得伪造 refs；
- pending Human/Review/Evidence gates；
- 完整 provenance。

**Working digest（只读 advisory）**：

- 已确认完成的工作；
- current focus/frontier；
- 未决问题；
- 关键 decisions 与 rejected reasons。

`next_action` 非必需；若携带，只能是 explicit/entailed 且带 provenance 的 advisory，不能由 Harness 生成计划。

## 8. Automation Boundary

> **Go×N 一次 Human authorization 可以自动 `WAIT/reobserve`；可以在严格 evidence gate 下 bounded `refresh`、`Shuttle retry`、`CONTINUE_PROVIDER_TURN`；**当前不得自动 generic provider-native Retry，也不得自动 context rebase**。Rebase 走当前已裁定的 Human-assisted Continuity V0。

### 8.1 可自动化

在一次 Human authorization 仍有效、run/binding/lease/head 未失效且各自 bounded budget 未耗尽时：

- wait、passive re-observe、reconcile；
- 通过 refresh-safe gate 的有界 refresh；
- 仅在 `PROVEN_NOT_ACCEPTED` 后的 Shuttle retry；
- 仅在 accepted assistant-interrupted gate + 剩余 Go slot 下的 `CONTINUE_PROVIDER_TURN`。

每项动作都要记录 action-specific evidence、attempt、fence、authority、时间、结果；不允许用 UI 存在或前端安静替代 acceptance/evidence。

### 8.2 必须 HUMAN_REQUIRED

- generic ChatGPT provider-native Retry（当前无 verified semantics）；
- 任意 `UNKNOWN/UNCERTAIN` 下的 refresh/Retry/resend/“继续”/rebase；
- context rebase 的 actuation 或新 conversation dispatch；
- recovery budget exhausted、Go budget exhausted、binding/head/authority 不一致；
- provider error 无法稳定分类，或存在未决工具/外部副作用；
- Human 已介入、Stop latch 已设置、或 duplicate tab 非 canonical lease holder。

## 9. 分阶段实现切片与验收证据（候选）

这些是待 Designer/Integrator 批准后的实现切片，不是本 PR 的代码变更：

1. **Evidence schema**：把 provider error 从 boolean 扩展为带 provider/version、surface、confidence、observedAt、conversation/binding/head fence 的分类证据；未知枚举必须 fail-closed。验收：类型/解析测试 + 未知分类不触发动作。
2. **Recovery ledger**：为 original dispatch、Shuttle retry、provider-native Retry、`CONTINUE_PROVIDER_TURN` 建独立 operation/provenance 与 RecoveryBudget；验收：Go exactly-once、recovery attempt bounded、terminal late evidence 审计测试。
3. **Run reducer**：增加 PAUSED/RECOVERING、Stop latch、reload adoption、canonical lease 与 user intervention 语义；验收：Stop 取消未 actuate、已外发只观察、同 binding 可恢复、binding change 不携预算。
4. **Assistant recovery adapter**：在 adapter-specific evidence gate 下提供 native Retry（初期 generic ChatGPT 保持 human-only）和 continue candidate；验收：accepted assistant interruption 永不 Shuttle resend，continue acceptance 扣新 Go slot。
5. **Continuity seam**：实现 hard shell/working digest pack、C1/C2 fence、`RESUME_ELIGIBLE` 和新授权入口；验收：late C1 evidence 不自动 merge，unmanaged chat 不伪造 Goal/Scope/next_action。
6. **Dogfood evidence**：以不制造破坏性故障的真实观察、人工确认动作和脱敏 ledger 记录填充 `REAL_DOGFOOD`；在此之前不放宽 generic ChatGPT native Retry 自动化。

## 10. 待 Epic Designer / 后续裁定的问题

1. generic ChatGPT 具体 provider/version 的 Retry semantics 由哪个 adapter evidence contract 证明，目标 turn、工具/副作用重跑和关联性如何冻结？
2. refresh-safe evidence 的最小字段集合如何跨 draft、attachment、ephemeral Human state 保证不丢失？
3. RecoveryBudget 的默认 time/observation/attempt 上限由哪个 Authority 指定；是否按 provider adapter 配置但保持统一 fail-closed 语义？
4. `PAUSED/RECOVERING` 的持久化 schema、Stop latch 与 service-worker/reload adoption 的权威 owner 是否仍为 background coordinator？
5. `HumanRecoveryAction` 是否纳入 V0；若不纳入，所有手动 provider Retry 是否继续归类 `USER_INTERVENTION`？
6. contradictory late evidence 的 durable audit record 最小格式和人工/invariant handling 路径是什么？
7. Continuity V0 的 `RESUME_ELIGIBLE` 如何与本仓库的新 continuation authorization 对接，而不携带跨 binding 的 Go budget？
8. 现有 issue handoff 路径位于 `active/` 且此前未 tracked。是否由后续生命周期工具在完成后搬迁，还是保留原文以维持 issue 引用可寻址性？本 PR 只原样纳入 handoff，不改写、不移动。

## 11. Authority / references

### 11.1 Authority（SHA 锚定，可作约束）

- Canonical workflow v0.3.1（`noos_docs` main，2026-09-17）：
  [docs/agent-workflow.md](https://raw.githubusercontent.com/futouyiba/noos_docs/4ec76f6007d6e9974cb233c7ca0cc2a47815be27/docs/agent-workflow.md)（`noos_docs@4ec76f6007d6e9974cb233c7ca0cc2a47815be27`），特别是 §1.1–1.5（独立 review 与 exact head）、§2.1–2.5（proposal/designer/provenance）、§3.3–3.4（provenance/worktree）、§4.1–4.4（integrator/寻址）、附录 B.3（标记语法）。
- Issue #54 原始 dispatch：[comment](https://github.com/futouyiba/noos-shuttle/issues/54#issuecomment-5711403452)。
- Designer `DESIGN: NEEDS_REVISION` 原文与 provenance：[comment](https://github.com/futouyiba/noos-shuttle/issues/54#issuecomment-5712703481)。该 verdict 原文不改写；canonical B.3 的 `DESIGN:` 接受集记录为 `APPROVE|REQUEST_CHANGES|REJECTED`，不含 `NEEDS_REVISION`，此词汇差异属于规范后续修订项。

### 11.2 受争议引用材料（provenance 未核实，非 Authority）

Designer 在 #54 裁定中把下列两份 Candidate 列为"可作约束引用（不可替代 #54 proposal）"。它们**不是** Authority，不构成本 proposal 的批准或依据；引用它们必须连带记录其争议状态：

- `noos_docs` PR #17 @ `a538f0f90215abce7b205dc1668b8f1ef07822cd`
  - `docs/deliberation-harness/candidates/2026-09-17-bcr-default-go-stop-boundary-narrow-revision.md`（BCR）
  - `docs/deliberation-harness/candidates/2026-09-17-conversation-continuity-v0-primary-adjudicated.md`（CC）

该 exact head 的独立 review 结论为
[`REVIEW: REQUEST_CHANGES @ a538f0f90215abce7b205dc1668b8f1ef07822cd`](https://github.com/futouyiba/noos_docs/pull/17#issuecomment-5716812552)，含 2 个 MAJOR 阻断项：

- **MAJOR-1（裁定保真 / canonical §2.3）**：CC 文档 §1 的 `Primary adjudication / PD-1 / ACCEPT OPTION A / READY_FOR_BOUNDED_VERTICAL_DOGFOOD` 块**没有任何交付来源**（无 issue、无 PR、无 URL、无 commit、无日期、无交付人）；`PRIMARY_ADJUDICATED`、`OWNER-DIRECTED`、`READY_FOR_BOUNDED_VERTICAL_DOGFOOD` 在 GitHub 检索零命中。该 review 指出：designer 的动作是把这两份文件**引用为约束**，不是批准；且被审 head（`07:34:33Z`）早于 #54 的 `DESIGN: NEEDS_REVISION`（`10:16:49Z`）约 2h42m，故该裁定块不可能转录自它。因此本 proposal 只把它们当作**受争议的引用材料**，不继承其 `PRIMARY_ADJUDICATED` 措辞的效力。
- **MAJOR-2（接缝 fail-open）**：BCR §14 断言"新 `Go ×N` 时 Continuity Checkpoint + BOOTSTRAP + Resume Verification **已恢复当前工作位**，故不再问 Goal"，与 CC §11（bootstrap 失败时 C2 仍为 canonical current）、CC §14 的 `RESUME_ELIGIBLE`（bootstrap 完成 ∧ hard resume verification 通过 ∧ soft verification 无 mismatch）冲突，且 BCR §9 的 stop boundary 列表缺对应项；BCR §17-11 自身又要求 `RESUME_ELIGIBLE`，构成文档内自相矛盾。本 proposal 在 §6.2 按"`RESUME_ELIGIBLE` 是硬门"一侧处理（见下），不继承 BCR §14 的无条件断言。

因此，本 proposal 只把它们当作**受争议的讨论对象与约束引用**，不当作已生效的契约文本；凡引用其具体论断之处（如 §6.2 采用 CC §11 的 bootstrap 失败路径与 CC §14 的 `RESUME_ELIGIBLE` 定义作为判据），均在该处显式标注分歧与判据来源，不继承其未验证的头部结论。

## 12. Addressability note

Designer 读取的 exact revision 是 `futouyiba/noos-shuttle main@570331278f54d5c54d00771c03d5f1302aa6bb72`；该 revision 的 `.noos/handoffs/active/` 只有 `.gitkeep`，因此此前 Issue 引用的 handoff 为 untracked，proposal 也不存在，形成 `TARGET_PROPOSAL_PATH: NOT_ADDRESSABLE`。本 proposal revision 将同时包含：

- `docs/deliberation-harness/chatgpt-provider-recovery-go-n-proposal-v0.md`（本文件）；
- `.noos/handoffs/active/chatgpt-provider-recovery-go-n-handoff.md`（原文，不改写）。

提交后必须在 Issue #54 与 draft PR 分别记录上述两个 exact path 与同一 exact commit SHA，供窄复审绑定。