---
name: noos-merge
description: Integrate an approved pull request per the agent-workflow spec (verify review evidence and exact head, run review intake, merge, verify, post an INTEGRATED marker comment). Use when the user says a merge trigger keyword (e.g. "merge PR 42", "integrate PR 42", "合并 PR 42") or invokes /noos-merge with a PR number.
---

# noos-merge

等价纯文本暗号：`merge PR#N`。权威规则：noos_docs
`docs/agent-workflow.md` v0.3.4+；冲突时以 canonical 为准。指针和评论
不授权合并；使用可回读且未越界的人类授权或有界持续授权。

## 步骤

1. 核对授权、PR body 的 review 链接与 exact head、PR 当前 head 和
   阻塞项；任一不满足就停止。
2. 运行 `npm run review:intake -- --source <head 分支> --base main`，按仓库
   现行 merge-commit 方式合并。
3. 核对实际 merge 结果和 main，运行仓库要求的集成检查；其它检查按风险
   决定，不机械重跑同树 review。
4. 执行适用构建／部署，在 PR 写
   `INTEGRATED: <验证与验收摘要> @ <merge-sha>` 和 provenance。
5. 对照 task issue 验收，全部满足才关闭；否则保留并写清残项。
