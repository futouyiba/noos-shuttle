---
name: noos-fix
description: Address unresolved REVIEW or DESIGN findings on a PR per the agent-workflow spec. Use when the user says a fix trigger keyword (e.g. "fix PR 42", "修复 PR 42", "address PR 42") or invokes /noos-fix with a PR number.
---

# noos-fix

等价纯文本暗号：`fix PR#N`。权威规则：noos_docs
`docs/agent-workflow.md` v0.3.3+；冲突时以 canonical 为准。

## 步骤

1. 读取未解决的 REVIEW／DESIGN findings，回到实现分支处理。
2. finding 有误时携证据请求重审；生效中的阻塞 finding 不得绕过。
3. 验证并 push 后重新触发 `review PR#N`。
