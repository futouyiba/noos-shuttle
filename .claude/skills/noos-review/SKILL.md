---
name: noos-review
description: Independently review a pull request per the agent-workflow spec (resolve full vs incremental from the thread, run verification yourself, post a REVIEW marker comment). Use when the user says a review trigger keyword (e.g. "review PR 42", "复审 PR 42") or invokes /noos-review with a PR number.
---

# noos-review

等价纯文本暗号：`review PR#N`。权威规则：noos_docs
`docs/agent-workflow.md` v0.3.3+；冲突时以 canonical 为准。

## 步骤

1. 读取 PR、task issue、相关规范、现有 verdict 和当前 exact head。
2. 使用独立、只读执行上下文，以证伪为目标。审核深度按运行风险与
   authority／contract 风险判断，亲自核验关键证据。
3. 发现语义或契约争议时走 `design <ref>`；实现证据仍由 reviewer 判断。
4. 在 PR 评论首行写 `REVIEW: APPROVE|REQUEST_CHANGES @ <head-sha>`，
   第二行写 provenance；findings 提供足以复现的证据。
5. head 改变后复审。reviewer 不修改被审内容。
