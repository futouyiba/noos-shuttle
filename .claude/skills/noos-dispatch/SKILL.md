---
name: noos-dispatch
description: 'Orchestrate a new implementation task per the agent-workflow spec (write the task issue, split slices, hand implement #N to a worker session). Use when the user says a dispatch trigger keyword (e.g. "dispatch 修复X", "派单 修复X") or invokes /noos-dispatch.'
---

# noos-dispatch

等价纯文本暗号：`dispatch <ref>`。权威规则：noos_docs
`docs/agent-workflow.md` v0.3.3+；冲突时以 canonical 为准。

## 步骤

1. 使用现有 issue；没有时创建包含目标、验收和来源的 task issue。
2. 按可独立交付的边界拆分，在隔离分支／worktree 实现。
3. 向实现会话投递 `implement #N`。通道由当前环境决定，消息只传指针。
4. 跟踪阻塞和 follow-up；机械且无行为、契约或生成物变化的修正可直接做。
