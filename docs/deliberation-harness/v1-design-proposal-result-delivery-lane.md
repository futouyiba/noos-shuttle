# 设计提议：`DELIVER_CHILD_RESULT` 应该走哪条账本？

> 状态：待裁定（提交 ChatGPT/设计方进一步思考）。由 `/loop` 实现 D-slice2 时发现的**不闭合点**，非实现缺陷。

## 1. 冲突

两处已确认文档对同一条回传路径给出**互相张力**的口径：

1. `src/core/submission-operation.ts`（已审核提交引入）把 `DELIVER_CHILD_RESULT` 列入
   `SubmissionOperationKind = "GO" | "REANCHOR_GOAL" | "BOOTSTRAP" | "REVIEW_DISPATCH" | "SEDIMENT" | "DELIVER_CHILD_RESULT"`。
   → 暗示结果回传是一种 **SubmissionOperation**：复用提交账本（PREPARED/DISPATCHING/UNCERTAIN、`DispatchFence`、`SubmissionDispatchReceipt{outcome:"dispatched"|"uncertain"}`、`claim`/`reconcile`/`rearm`）。

2. `docs/deliberation-harness/v1-final-e2e-readiness-confirmation.md` §5 把
   "`DELIVER_CHILD_RESULT` create-or-get、ResultDeliveryKey lookup、INSERTED/COMPLETED receipts、parent wait clearing"
   列为**独立**的 NOT_IMPLEMENTED 项，用词（ResultDeliveryKey / INSERTED / COMPLETED）与提交账本的
   （payloadFingerprint / DISPATCHING / dispatchReceipt）**不同**。

提交账本没有 "ResultDeliveryKey"、"INSERTED"、parent wait 这些概念；投递账本没有 DispatchFence、
pre-submit baseline、UNCERTAIN reconciliation。二者不是同一套词汇。

## 2. 当前实现（D-slice2，`8e8ce7c`）

已按**独立投递账本**实现：`src/core/result-delivery.ts`
- `ResultDeliveryKey = parentThreadId>childThreadId>resultRef`（§11 按 Logical Thread 路由）
- `INSERTED → COMPLETED` 两阶段，create-or-get 幂等
- 完成时清除 parent 的 `WAIT_REVIEW`/`WAIT_WORKER`（仅当该 wait 仍指向本 child）
- **只记录调用方给出的投递目标**，不自行解析/变更 canonical active binding

理由：§11 明确"按 Logical Thread 路由、rollover 后仍正确"，而提交账本的 `DispatchFence`（bindingEpoch/leaseGeneration/targetCarrierRef）是**绑定到具体 carrier 世代**的；把回传塞进提交账本会与 §11"按线程路由"直接冲突。

## 3. 待裁定的问题

- **Q1**：`DELIVER_CHILD_RESULT` 究竟是（A）提交账本的一条 lane，还是（B）独立投递账本？若为 A，如何在 §11"按线程路由"下解释 `DispatchFence` 的 bindingEpoch 语义（它本是 carrier 世代围栏）？
- **Q2**：若为 A，`INSERTED`/`COMPLETED` 与 `PREPARED`/`DISPATCHING`/`COMPLETED` 如何对应？两套 receipt 语义（`outcome:"dispatched"|"uncertain"` vs `completionReceipt`）是否并存、还是其一为另一的投影？
- **Q3**：若为 B，"ResultDeliveryKey" 是否就是投递身份，与提交账本的 `operationId` 是否需要一个显式映射（否则两者会各自记账、无法对账）？
- **Q4**：§13 说"无安全当前 parent carrier 时结果 durable 等待"——投递账本用"停在 INSERTED"表达；若并入提交账本，应停在哪个状态，`UNCERTAIN` 是否会被误当作"可能已投递"？
- **Q5**：parent rollover 发生在 INSERTED 与 COMPLETED 之间时，是否需要一次 route re-resolution（重解析 L1 当前 active conversation）？这属于投递账本、还是 binding/reducer 的职责？

## 4. 建议（供讨论，非结论）

倾向 **B（独立投递账本）+ 显式映射**：投递账本持 `ResultDeliveryKey` 与可选 `submissionOperationId` 引用，提交账本继续只负责"把一段 payload 送进某个 carrier 世代"的传输安全。这样 §11 的线程路由与提交账本的 carrier 世代围栏各归其位。若设计方选 A，需要补一份"线程路由 ↔ carrier 世代围栏"的语义桥接说明。

## 5. 影响

- 裁定前，`result-delivery.ts` 保持现状可用，但**不与提交账本对账**；若最终选 A，需要一次重构迁移。
- 该点不阻塞 D-slice3（spawn 执行接线）与 reducer 集成，但会阻塞"端到端回传对账"的验收声明。
