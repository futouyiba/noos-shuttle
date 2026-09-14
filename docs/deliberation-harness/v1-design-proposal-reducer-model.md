# 设计提议：HarnessReducer 属于 State Store 还是 Provider Execution Journal？

> 状态：待裁定（提交 ChatGPT/设计方进一步思考）。由 `/loop` 实现 D-slice3/勘察 reducer 时发现的**不闭合点**，非实现缺陷。

## 1. 冲突：两套 "Reducer" 模型并不对齐

### 1.1 权威契约（noos_docs@`9b55137a`，`docs/harness/state-delta-reducer-contract.md`）

- §2.4：Reducer 处理 **Authorized Delta** 后返回并持久化 `apply_result`，含
  `delta_id`、`delta_fingerprint`、`outcome ∈ {applied, rejected_stale, rejected_precondition, rejected_invariant, no_op}`、`from_version`、`to_version`、`operation_results`、`audit_record_id`。
- §14：在 **tentative/staged state** 上按**有序 operation 列表**执行，全通过才 prepare durable transaction。
- §15.1：成功 apply 必须在**同一个 durable local transaction** 中原子落盘三样：
  `new state version` + `ApplyResult` + `Transition/Audit Record(delta_id)`。
- §15.2/15.3：**`delta_id` 是 apply 幂等键**（同 id 同指纹 → 返回原 ApplyResult；同 id 异指纹 → `rejected_invariant`）。
- §15.4：`no_op` 也要有 durable receipt。
- §5：operation taxonomy 是**知识状态**语义（hypothesis / constraint / decision / phase / source attachment 等），并显式禁止 `replace_state`、`raw_json_patch` 等通用绕过。

### 1.2 已实现（`src/core/harness-reducer.ts`）

- 领域是 **binding / actuation lease / submission dispatch claim**（provider 执行语义），不是 §5 的知识状态 taxonomy。
- 转移集（`PREPARED→DISPATCHING→OBSERVED_ACCEPTED→COMPLETED` 等）与 §5 operation 列表**无交集**。
- 无 `delta_id`、无 `ApplyResult`、无 `audit_record_id`、无版本号。
- D-slice3 的 `DurableHarnessReducer.applyResult(mutator)` 只实现了 §15.1 的**崩溃一致性形状**（staged → persist → commit），但**没有** §15.2/15.3 的 `delta_id` 身份模型，也**没有**落盘 ApplyResult 与审计记录。
- 且 reducer **没有**任何公开方法把操作从 `DISPATCHING` 推进到 `OBSERVED_ACCEPTED`/`COMPLETED`/`FAILED_SAFE`——只能 `claim`。claim 之后 `hasExecutionOwner` 会永久阻塞 binding/lease 转移。

## 2. 关键线索

契约 §15 开头明确写着：

> "这是 **State Store 自己的 transaction contract，不属于 Provider Execution Journal**。"

即契约**承认**存在一个独立的 **Provider Execution Journal**，其事务契约不适用 `delta_id`/ApplyResult 那套。

## 3. 待裁定的问题

- **Q1**：`HarnessReducer`（binding/lease/dispatch-claim）到底属于哪一层？
  - (A) 它就是 **Provider Execution Journal** → 则 readiness §5 的 "crash-consistent ApplyResults" 用词**误导**，其契约应另有文档（Provider Execution Journal contract），当前实现的 `applyResult(mutator)` 方向正确但需补该文档的幂等/审计语义；
  - (B) 它是 **State Store** → 则它必须改造成 Authorized Delta / ApplyResult 模型，当前实现与契约不符，`harness-reducer.ts` 需重构。
- **Q2**：若 (A)，Provider Execution Journal 是否也需要 `delta_id` 式**幂等键**（例如 `dispatch operation_id + fence fingerprint`）？现实现以 `operationId` + expectation fence 近似，但未持久化"原 ApplyResult 重放"语义。
- **Q3**：若 (A)，Provider Execution Journal 的操作**完成/失败**由谁驱动、经由什么 API？现实现缺此 API，导致 claim 后无法离开 `DISPATCHING`。这是"缺实现"还是"契约未定义"？
- **Q4**：State Store（§5 知识状态 taxonomy）在 `noos-shuttle` 中由谁实现？本仓库现有 `harness-reducer.ts` 显然不是；是否需要新建一个遵循 delta 契约的 State Store 模块？
- **Q5**：readiness §5 的 "crash-consistent ApplyResults" 究竟指哪一层？若指 State Store，则 D-slice3 命名与范围需修正，避免"用 Provider Execution Journal 冒充 State Store 的 ApplyResult"。

## 4. 建议（供讨论，非结论）

倾向 **Q1=(A)**：`HarnessReducer` 是 Provider Execution Journal，其操作是 carrier 级别的执行控制，与知识状态 taxonomy 正交。据此：
1. 把 `harness-reducer.ts` 的定位在代码与文档中显式声明为 Provider Execution Journal；
2. 补一个 Provider Execution Journal 的**完成/失败 API**（如 `settleSubmissionDispatch(operationId, outcome, evidence)`，转移 `DISPATCHING→{OBSERVED_ACCEPTED, FAILED_SAFE, UNCERTAIN}`、`OBSERVED_ACCEPTED→COMPLETED`），并带幂等键与审计记录；
3. State Store（delta 契约）作为**独立模块**另行实现，不要与前者混用 "Reducer/ApplyResult" 命名。

若设计方判 (B)，则需要一份"harness-reducer 迁往 delta 契约"的迁移说明。

## 5. 影响

- 该点不阻塞已完成切片（C/D1–D4 均为各自契约内的忠实实现）。
- 但**阻塞**"reducer 事件源生产接线"与"完整 V1 端到端"的验收声明：在裁定前，claim 之后的完成路径无 API，端到端无法闭合。
