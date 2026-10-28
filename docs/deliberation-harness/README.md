# Deliberation Harness 文档索引

本目录混合保存当前设计候选、提案、实现报告、验收记录和历史证据。文件名不能单独证明权威关系。

## 先读

- [`cross-agent-handoff-escalation-contract-v3.md`](cross-agent-handoff-escalation-contract-v3.md)：Cross-Agent Handoff / Escalation 的当前实现向设计候选。它仍受 `noos_docs` 的 canonical 契约约束，冲突时以上游权威为准。
- [`v1-final-e2e-readiness-confirmation.md`](v1-final-e2e-readiness-confirmation.md)：V1 端到端就绪确认与冻结权威快照记录。
- [`v1-primary-design-current.md`](v1-primary-design-current.md)：V1 当前阶段记录；具体机制仍以契约和最终 E2E 确认为准。

## 当前相关记录

这些文件描述当前实现、验收或仍在使用的设计边界，但不自动成为规范：

- [`implementation-slice-0-observation-report.md`](implementation-slice-0-observation-report.md)
- [`implementation-slice-1-submission-ledger-report.md`](implementation-slice-1-submission-ledger-report.md)
- [`implementation-slice-2-github-mailbox-report.md`](implementation-slice-2-github-mailbox-report.md)
- [`v1-acceptance-audit.md`](v1-acceptance-audit.md)
- [`v1-integration-verification-status.md`](v1-integration-verification-status.md)
- [`bcr-minimum-usable-loop-report.md`](bcr-minimum-usable-loop-report.md)
- [`bounded-continuation-evidence-readiness-report.md`](bounded-continuation-evidence-readiness-report.md)

## 提案与待裁定材料

以下文件是提案、设计问题或候选方案。除非文件自身写明已生效，否则不能当作实现契约：

- [`adjudication-roundtrip-mvp.md`](adjudication-roundtrip-mvp.md)
- [`agent-authority-and-halt-v0.md`](agent-authority-and-halt-v0.md)
- [`b3-verdict-acceptance-set-proposal-v0.md`](b3-verdict-acceptance-set-proposal-v0.md)
- [`bcr-background-dependence-defect-proposal-v0.md`](bcr-background-dependence-defect-proposal-v0.md)
- [`bcr-multitab-observation-defect-proposal-v0.md`](bcr-multitab-observation-defect-proposal-v0.md)
- [`chatgpt-provider-recovery-go-n-proposal-v0.md`](chatgpt-provider-recovery-go-n-proposal-v0.md)
- [`doc-governance-proposal-v0.md`](doc-governance-proposal-v0.md)
- [`github-comment-transport-v0.md`](github-comment-transport-v0.md)
- [`shuttle-shortcut-actions-proposal-v0.md`](shuttle-shortcut-actions-proposal-v0.md)
- [`v1-design-proposal-control-lane-followup.md`](v1-design-proposal-control-lane-followup.md)
- [`v1-design-proposal-fork-adapter-gap.md`](v1-design-proposal-fork-adapter-gap.md)
- [`v1-design-proposal-reducer-model.md`](v1-design-proposal-reducer-model.md)
- [`v1-design-proposal-result-delivery-lane.md`](v1-design-proposal-result-delivery-lane.md)
- [`w5-delivery-wiring-design.md`](w5-delivery-wiring-design.md)
- [`w11-settle-hop-design.md`](w11-settle-hop-design.md)

## 历史与证据

这些文件主要用于追溯已完成的实验、实现切片、评审和版本演进。它们保留事实和证据，但不表示当前待办或当前契约：

- `cross-agent-handoff-escalation-contract-v0.md`
- `cross-agent-handoff-escalation-contract-v1.md`
- `cross-agent-handoff-escalation-contract-v2.md`
- `cross-agent-handoff-escalation-reducer-operations-v0.md`
- `cross-agent-handoff-m1-m3-amendment-v0.md`
- `cross-agent-handoff-n1-n5-amendment-v0.md`
- `cross-agent-handoff-r1-r6-disposition-v2.md`
- `cross-agent-handoff-review-disposition-v1.md`
- `cross-agent-handoff-manual-dogfood-baseline-v0.md`
- `goal-reanchor-production-wiring-report.md`
- `goal-reanchor-rollover-recovery-report.md`
- `issue-3-provider-verification-report.md`
- `manual-handoff-baseline.md`
- `v1-adjudication-control-lane.md`
- `v1-adjudication-record.md`
- `v1-adjudication-w11-fork.md`
- `v1-end-to-end-walkthrough-v0.md`
- `v1-end-to-end-walkthrough-v1.md`
- `v1-primary-design-companion-decision-memory-v0.md`
- `bcr-auto-x5-evaluator-report.md`
- `bcr-hub-evaluator-config-sync-report.md`
- `evidence/` 下的 JSON 文件

目录中未在上面逐项列出的材料（例如其他 BCR 报告和设计记录）也按历史材料阅读，先查看文件顶部的状态横幅。

历史文件之间可能存在互相修订或替代关系。先看文件顶部的状态横幅和本索引，再按 provenance 链回溯；不要只按文件名推断当前权威。

## 状态规则

- `Current`、`Consolidated Current` 等字样只在文件明确声明并有权威来源时成立。
- `Proposal`、`Working Design Note`、`Report`、`Evidence` 表示材料类型，不等于已生效契约。
- `SUPERSEDED` 文件只作 provenance，按横幅指向替代文件。
- 本索引是入口，不复制设计语义，也不替代 `AGENTS.md`、`noos_docs` canonical 或文件自身的精确证据。
