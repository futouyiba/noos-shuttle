---
name: noos-implement
description: 'Start an implementation task from a task issue per the agent-workflow spec (read the issue, work on an isolated branch, implement, verify, get independent review, open a draft PR citing review evidence). Use when the user says an implement trigger keyword (e.g. "implement #41", "接单 #41") or invokes /noos-implement.'
---

# noos-implement

等价纯文本暗号：`implement #N`。权威规则：noos_docs
`docs/agent-workflow.md` v0.3.3+；冲突时以 canonical 为准。

## 步骤

1. 读取 task issue、有效裁定和仓库规则；在隔离分支／worktree 实现。
2. 需要语义或契约裁定时先走 `design <ref>`。
3. 完成最小充分验证并创建 PR。PR body 用普通链接关联 task issue，
   不使用自动关单关键词。
4. 触发独立 `review PR#M`。`REQUEST_CHANGES` 修复后重新送审。
5. APPROVE 后在 PR body 写 review 链接和 exact head，转 Ready，并用
   `merge PR#M` 指针唤醒 integrator。消息不复制证据，也不构成授权。
