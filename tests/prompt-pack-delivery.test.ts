import { describe, expect, it, vi } from "vitest";
import { buildPromptPackSelection, promptPackFilename } from "../src/core/prompt-pack";

describe("Prompt Pack selection normalization", () => {
  it("trims, drops empty keys, and de-duplicates while preserving order", () => {
    expect(
      buildPromptPackSelection([" key-a ", "", null, "key-b", "key-a", "   "])
    ).toEqual({ lookupKeys: ["key-a", "key-b"] });
  });

  it("sends the optional task verbatim and omits it when blank", () => {
    const instruction = "Use the sources, but do not mention NOOS:RESULT:BEGIN literally.";
    expect(buildPromptPackSelection(["key-a"], `  ${instruction}  `)).toEqual({
      lookupKeys: ["key-a"],
      instruction
    });
    expect(buildPromptPackSelection(["key-a"], "   ")).toEqual({ lookupKeys: ["key-a"] });
    expect(buildPromptPackSelection(["key-a"])).toEqual({ lookupKeys: ["key-a"] });
  });

  it("names the attachment from the Hub key without leaking path separators", () => {
    expect(promptPackFilename("20261109-demo", "20261109-demo-abc123")).toBe(
      "20261109-demo-abc123.md"
    );
    expect(promptPackFilename("../pack/one", null)).toBe("-pack-one.md");
    expect(promptPackFilename("", "")).toBe("prompt-pack.md");
  });
});

describe("Prompt Pack background channel", () => {
  it("maps the content-script message to the Hub action body", async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() }
      }
    };

    const { PROMPT_PACK_BUILD_COMMAND, buildPromptPackHubActionBody } = await import(
      "../src/background/service-worker"
    );

    expect(PROMPT_PACK_BUILD_COMMAND).toBe("promptPack.build");
    expect(
      buildPromptPackHubActionBody({
        type: "NOOS_BUILD_PROMPT_PACK",
        lookupKeys: ["key-a", "key-b"],
        instruction: "Do the task.",
        title: "Demo Pack"
      })
    ).toEqual({
      command: "promptPack.build",
      lookup_keys: ["key-a", "key-b"],
      instruction: "Do the task.",
      title: "Demo Pack"
    });
  });
});
