---
name: noos-review
description: Independently review a pull request per the agent-workflow spec (resolve full vs incremental from the thread, run verification yourself, post a REVIEW marker comment). Use when the user says a review trigger keyword (e.g. "review PR 42", "复审 PR 42") or invokes /noos-review with a PR number.
---

# noos-review

等价纯文本暗号：`review PR#N`（接受 `复审`）。权威展开：noos_docs
`docs/agent-workflow.md` 附录 B（v0.3.0+）；冲突时以附录 B 为准。

## 步骤

1. 解析 PR 指针（宽松归一：`PR 42` / `PR42` / `PR#42` / `pr 42` /
   大小写无关、全角归一）；歧义时向用户确认，不猜。
2. `gh pr view <N> --json url,title,headRefName,headRefOid,baseRefName`
   与 `gh pr diff <N>` 获取被审内容；`gh pr view <N> --comments` 解析
   线程中最新 `REVIEW:` 标记的 head。
3. 与当前 head 比对：线程无有效 `REVIEW:` 标记（带 provenance）时
   为全量审；否则取最新有效标记的 head——相同＝重看，不同＝增量
   复审（基线＝上次 reviewed head，审其后的全部 commit，内容不
   限，§1.3）。
4. 按触及路径分级（§1.4）：源码、脚本、CI workflow、构建配置、
   lockfile 一律 §1.2 全项——在本地 checkout 该 PR 亲跑关键命令并
   引用实际输出，核心不变量做变异验证；不采信实现者转述。
5. 不改被审代码；技术异议按 §2.5 回流 designer 重裁，不当场僵持。
6. 结论评论到 PR，首行严格标记 `REVIEW: APPROVE @ <head-sha>` 或
   `REVIEW: REQUEST_CHANGES @ <head-sha>`，第二行 provenance（如
   `（rev: 直评, 委派: orch）`；由实现会话转述时
   `（rev: relayed by impl, 委派: impl）`，行为独立性在正文说明）；
   findings 各带 severity（MAJOR / MINOR）、文件行号与亲跑证据。
