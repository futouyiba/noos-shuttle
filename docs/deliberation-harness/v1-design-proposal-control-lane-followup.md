# 设计提议：Control-lane Follow-up — FAILED_SAFE 传播与 Re-arm 尝试身份

> 状态：待裁定（提交 ChatGPT/设计方进一步思考）。W11b 复核 NOTE-1 登记的
> control-lane 后续项的窄设计提议；不重开 V1 架构。

## 1. 现状事实（代码级）

**Transport ledger**（`src/core/submission-operation.ts`）：
- W9 `rearm`：FAILED_SAFE + **同 fence** + 证据 sameness → 回 PREPARED，同一
  operation 身份重派发（transport 侧 fence 分量不变，`dispatchClaimedAt` 更新）。
- W10 `retarget`：FAILED_SAFE + **翻页 fence** → fresh-attempt 清理（claim/
  receipt/evidence/stamp/error 全清、回 PREPARED，换新 fence 分量）。

**Control reducer**（`src/core/operational-state-reducer.ts`）：
- 转移表：FAILED_SAFE 是**终态**（无出边）；DISPATCHING/UNCERTAIN 可入
  FAILED_SAFE（settle 可达，`RECONCILIATION_EVIDENCE` 许可该目标）。
- claim 的幂等分支：execution-owning + 同 authority 分量 → 返回**原 op 原
  fence id**（不重铸）——即 W9 式同 fence 重派发在 control 侧**不产生新尝试**。
- W11b 运行时：claim 侧铸造 F17、settle 侧只推进 OBSERVED_ACCEPTED/COMPLETED；
  **没有任何路径把 control op 推到 FAILED_SAFE**，也没有 transport re-arm/
  retarget 后的 control 侧重建。

**后果**（W11b 复审实证）：transport 已 FAILED_SAFE（或翻页 fresh-attempt）后，
control op 永久停留 execution-owning（DISPATCHING/UNCERTAIN/OBSERVED_ACCEPTED），
阻塞 control 侧 binding rollover（`BINDING_BLOCKED_BY_EXECUTION`）——control
"权威状态"对已失败/已重派发的投递持续说谎。

## 2. 张力：W9 同 fence re-arm vs D1 的 F18

裁定 D1 §5："只有真正重新取得一次 provider actuation authority 才铸新
DispatchFence…… FAILED_SAFE → policy permits rearm → PREPARED → claim →
**F18**"。而 W9 的 transport re-arm 在同 fence 下复用分量（bookkeeping 层面），
control claim 幂等分支也返回原 F17。

**关键观察**：两者可以调和——"attempt 身份"归 **dispatch_fence_id**（control
铸造的 opaque id），不归 fence 分量。W9 的同分量 re-arm 只是 transport 记账；
一旦 control 侧先把 F17 settle 到 FAILED_SAFE（释放执行权），下一次 claim 就
是一次**新的 claim**（新 `dispatchClaimedAt` → 新确定性 deltaId → reducer 走
铸造路径而非幂等分支）→ 铸 F18。分量相同不妨碍 F17≠F18。

## 3. 待裁定的问题

- **Q1（尝试身份）**：确认"每次 FAILED_SAFE 之后的重新 claim 都铸新 fence id
  （F18），与 transport 侧 fence 分量是否变化无关"。W9 语义据此重新表述为
  "transport re-arm 复用分量、不复用尝试身份"。
- **Q2（FAILED_SAFE 传播机制）**，三选一：
  - **Option A（推荐）**：reducer 新增授权转移 `rearm_submission_dispatch`：
    FAILED_SAFE → PREPARED，守卫=RECONCILIATION 级证据（proven-not-accepted）
    + revision CAS + 原 fence id；随后正常 claim 铸 F18。一个 delivery 身份对
    应一个 control op，与 D1 字面流程逐行对应。
  - **Option B**：control op settle FAILED_SAFE（终态）后，运行时 seed 一个
    **后继 control op**（如 `{operationId}:a2`）承载新尝试；不改转移表，代价是
    op-id lineage 约定 + 审计链断为两段。
  - **Option C**：control 不建模 FAILED_SAFE（用 CANCELLED settle 释放执行权后
    走 B 的后继 op）——语义混淆，不推荐。
- **Q3（翻页 retarget 的 control 侧处理）**：transport W10 fresh-attempt（翻页）
  时，control 需先 settle FAILED_SAFE（解锁 binding rollover）→ 滚动 control
  binding/lease → `rearm_submission_dispatch`（或 B 的后继 op）→ 新 claim。
  Option A 下 re-arm 边是否允许同时换 fence 分量（类似 transport retarget），
  还是强制"先 rollover binding、再 re-arm 到新分量"？（推荐后者——分两步，
  每步各自原子可审计。）
- **Q4（证据许可）**：control FAILED_SAFE settle 的证据来源——现有
  `RECONCILIATION_EVIDENCE` 已许可 FAILED_SAFE 目标；是否需要新增
  `PROVEN_NOT_ACCEPTED` 事件 kind 使许可表更精确（BLIND/ACK 仍只许 UNCERTAIN）？
  （推荐：V1 先用 RECONCILIATION_EVIDENCE，枚举收紧留给后续。）

## 4. 建议方案（供讨论，非结论）

**Option A + Q1 确认 + Q3 两步制 + Q4 维持现状**：

```text
transport FAILED_SAFE（proven-not-accepted 证据落 journal）
  → control settle FAILED_SAFE（RECONCILIATION_EVIDENCE，F17 终结，释放执行权）
  → [若翻页] control binding/lease rollover（现在不再被阻塞）
  → control rearm_submission_dispatch（FAILED_SAFE→PREPARED，CAS+证据守卫）
  → transport re-arm/retarget（W9/W10 既有路径）
  → 下一次 probe：新 claim delta → reducer 铸 F18
  → F18 走 DISPATCHING→OBSERVED_ACCEPTED→COMPLETED，全程同 F18
```

W9 的 transport 语义无需改动（分量复用与新尝试身份正交）；唯一新代码是
reducer 的 re-arm 转移 + 运行时把 FAILED_SAFE 证据接进 control settle。

## 5. 影响

- 不阻塞已合入 main 的任何内容（当前 control-lane 分歧只影响后续 rollover
  场景的 control 侧正确性；transport/投递安全不受影响）。
- 裁定后实现为一个小切片（reducer re-arm 边 + 运行时 FAILED_SAFE settle 接线
  + 测试），预计一轮独立审核。
