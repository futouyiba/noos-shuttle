import { describe, expect, it } from "vitest";
import { captureNoosResults } from "../src/core/result-capture";

const VALID_RESULT = `Noise before
<!-- NOOS:RESULT:BEGIN -->
---
type: noos_result
version: 0.1
source_app: chatgpt
source_url: https://chatgpt.com/c/example
status: active
created_at: 2026-11-05
result_key: 20261105-noos-result-route
title: NOOS Result Route
summary: Results save through the same Hub ingest path as handoffs and crystals.
producer: chatgpt
input_refs: [20261105-noos-vault-route]
review_status: pending
promotes_to: crystal
tags: [noos, result]
preferred_path: .noos/results/inbox/2026-11-05-noos-result-route.md
---

# 结果：NOOS Result Route

## 结果
Captured from the chatbot turn.

<!-- NOOS:RESULT:END -->
Noise after`;

describe("captureNoosResults", () => {
  it("captures a valid result", () => {
    const result = captureNoosResults(VALID_RESULT, "2026-11-05T00:00:00.000Z");

    expect(result.errors).toEqual([]);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].key).toBe("20261105-noos-result-route");
    expect(result.results[0].summary).toBe("Results save through the same Hub ingest path as handoffs and crystals.");
    expect(result.results[0].frontmatter?.type).toBe("noos_result");
    expect(result.results[0].warnings).toEqual([]);
  });

  it("captures multiple results independently", () => {
    const result = captureNoosResults(`${VALID_RESULT}\n${VALID_RESULT}`);

    expect(result.errors).toEqual([]);
    expect(result.results).toHaveLength(2);
  });

  it("ignores placeholder result marker examples", () => {
    const result = captureNoosResults(`<!-- NOOS:RESULT:BEGIN -->
\`\`\`markdown
...
\`\`\`
<!-- NOOS:RESULT:END -->

<!-- NOOS:RESULT:BEGIN -->
<结果正文>
<!-- NOOS:RESULT:END -->

${VALID_RESULT}`);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].key).toBe("20261105-noos-result-route");
  });

  it("repairs a result wrapped in a markdown code fence", () => {
    const result = captureNoosResults(`<!-- NOOS:RESULT:BEGIN -->
\`\`\`markdown
---
type: noos_result
version: 0.1
source_app: chatgpt
status: active
created_at: 2026-11-05
result_key: 20261105-fenced-result
title: Fenced Result
summary: Fenced generated results should parse.
tags: [noos, result]
---

# 结果：Fenced Result

## 结果
ChatGPT sometimes wraps generated Markdown in a code fence.
\`\`\`
<!-- NOOS:RESULT:END -->`);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].frontmatter?.type).toBe("noos_result");
    expect(result.results[0].key).toBe("20261105-fenced-result");
    expect(result.results[0].warnings).toEqual([]);
  });

  it("repairs rendered result frontmatter that becomes a heading without a closing fence", () => {
    const result = captureNoosResults(`<!-- NOOS:RESULT:BEGIN -->
---
## type: noos_result version: 0.1 source_app: chatgpt status: active created_at: 2026-11-05 result_key: 20261105-rendered-result title: Rendered Result summary: Heading-rendered frontmatter should parse. tags: [noos, result]
# 结果：Rendered Result

## 结果
ChatGPT can render frontmatter as a heading.

<!-- NOOS:RESULT:END -->`);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].frontmatter?.type).toBe("noos_result");
    expect(result.results[0].key).toBe("20261105-rendered-result");
    expect(result.results[0].warnings).toEqual([]);
  });

  it("reports an unclosed begin marker instead of inventing a result", () => {
    const result = captureNoosResults(`<!-- NOOS:RESULT:BEGIN -->
---
type: noos_result
title: Truncated
`);

    expect(result.results).toEqual([]);
    expect(result.errors).toEqual(["Found a NOOS result begin marker without a matching end marker."]);
  });

  it("returns nothing and no errors when no marker is present", () => {
    const result = captureNoosResults("A normal conversation without any NOOS markers.");

    expect(result.results).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("warns when required frontmatter is missing", () => {
    const result = captureNoosResults(`<!-- NOOS:RESULT:BEGIN -->
---
type: noos_result
version: 0.1
title: incomplete
---

# 结果：Incomplete

## 结果
Missing its key and summary.
<!-- NOOS:RESULT:END -->`);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].warnings).toContain("Frontmatter should include result_key.");
    expect(result.results[0].warnings).toContain("Frontmatter should include summary.");
  });
});
