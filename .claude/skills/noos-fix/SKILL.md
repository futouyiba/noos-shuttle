---
name: noos-fix
description: Address unresolved REVIEW or DESIGN findings on a PR per the agent-workflow spec. Use when the user says a fix trigger keyword (e.g. "fix PR 42", "修复 PR 42", "address PR 42") or invokes /noos-fix with a PR number.
---

# noos-fix

等价纯文本暗号：`fix PR#N`（接受 `address`、`修复`）。权威展开：
noos_docs `docs/agent-workflow.md` 附录 B（v0.3.0+）；冲突时以附录 B
为准。接收角色：该 PR 的实现任务。

## 步骤

1. 解析 PR 指针（宽松归一）；`gh pr view <N> --comments` 拉全部
   `REVIEW:` / `DESIGN:` findings，剔除已由后续评论明确解决者。
2. 回到该 PR 的实现分支；逐条修复，或认为 finding 有误时携证据在
   PR 回应并请求重审（§1.3；finding 未撤销前不得合并）。
3. 按 AGENTS.md「验证」节跑绿后 push；增量复审由 `review` 的线程
   head 比对自动判定，无需手动声明。
