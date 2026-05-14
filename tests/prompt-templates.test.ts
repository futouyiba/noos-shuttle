import { describe, expect, it } from "vitest";
import { createGenerateCrystalPrompt, createGenerateThreadPrompt } from "../src/core/prompt-templates";

describe("createGenerateThreadPrompt", () => {
  it("creates a Chinese handoff prompt by default", () => {
    const prompt = createGenerateThreadPrompt("https://chatgpt.com/c/test");

    expect(prompt).toContain("请基于当前对话生成一份 NOOS Thread / 交接稿");
    expect(prompt).toContain("fenced markdown code block");
    expect(prompt).toContain("source_url: https://chatgpt.com/c/test");
    expect(prompt).toContain("handoff_revision");
    expect(prompt).toContain("让用户可以区分多份交接稿");
    expect(prompt).toContain("# 交接：<标题>");
    expect(prompt).toContain("## 建议给下一位代理的指令");
    expect(prompt).toContain("如果某一节没有内容，也保留标题并写“无”");
  });

  it("creates an English handoff prompt when requested", () => {
    const prompt = createGenerateThreadPrompt("https://chatgpt.com/c/test", "en");

    expect(prompt).toContain("Please generate a NOOS Thread / Handoff");
    expect(prompt).toContain("fenced markdown code block");
    expect(prompt).toContain("source_url: https://chatgpt.com/c/test");
    expect(prompt).toContain("handoff_revision");
    expect(prompt).toContain("distinguish multiple handoffs");
    expect(prompt).toContain("# Thread: <title>");
    expect(prompt).toContain("## Suggested Next-Agent Instructions");
    expect(prompt).toContain('if a section has no content, keep the heading and write "None"');
  });

  it("creates a Chinese crystal prompt", () => {
    const prompt = createGenerateCrystalPrompt("https://chatgpt.com/c/test");

    expect(prompt).toContain("NOOS Crystal / 讨论结晶");
    expect(prompt).toContain("<!-- NOOS:CRYSTAL:BEGIN -->");
    expect(prompt).toContain("type: noos_crystal");
    expect(prompt).toContain("crystal_key");
    expect(prompt).toContain("## 已确认结论");
    expect(prompt).toContain("下一轮最值得继续讨论的 3 个入口");
  });
});
