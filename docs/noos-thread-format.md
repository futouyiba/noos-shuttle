# NOOS Thread v0.1 Format

NOOS Shuttle v0 captures markdown handoff blocks wrapped in exact markers:

```md
<!-- NOOS:THREAD:BEGIN -->
...
<!-- NOOS:THREAD:END -->
```

Recommended frontmatter:

```yaml
type: noos_thread
version: 0.1
source_app: chatgpt
source_url: https://chatgpt.com/...
target_agent: codex
status: active
created_at: 2026-05-02
title: example-thread-title
tags: [noos, shuttle, handoff]
preferred_path: .noos/handoffs/active/2026-05-02-example-thread-title.md
```

Required body sections for v0 validation:

```md
# Thread: Example Thread Title

## Intent
## Context Summary
## Task
## Constraints
## Acceptance Criteria
## Suggested Next-Agent Instructions
## Open Questions
## Relevant Files or Links
```

Validation warnings do not block copy or download. Broken begin/end markers do block capture because the extension cannot determine the intended handoff range.
