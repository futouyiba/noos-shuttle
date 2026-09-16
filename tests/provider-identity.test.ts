import { describe, expect, it } from "vitest";
import { extractProviderConversationId } from "../src/shared/provider-identity";

describe("extractProviderConversationId", () => {
  it("extracts ids from the established route forms", () => {
    expect(extractProviderConversationId("https://chatgpt.com/c/conv-a")).toBe("conv-a");
    expect(extractProviderConversationId("https://chatgpt.com/chat/conv-b")).toBe("conv-b");
    expect(extractProviderConversationId("https://chatgpt.com/u/7/c/conv-c")).toBe("conv-c");
    expect(extractProviderConversationId("https://chatgpt.com/c/WEB:provisional")).toBeUndefined();
  });

  it("extracts conversation ids nested under ChatGPT project routes", () => {
    expect(extractProviderConversationId("https://chatgpt.com/g/g-p-abc123/c/conv-project")).toBe("conv-project");
    expect(extractProviderConversationId("https://chatgpt.com/g/g-p-abc123/u/7/c/conv-project-2")).toBe("conv-project-2");
    expect(extractProviderConversationId("https://chatgpt.com/g/g-p-abc123/c/conv-x?model=x")).toBe("conv-x");
  });

  it("rejects project slugs, non-conversation paths, and unsupported hosts", () => {
    expect(extractProviderConversationId("https://chatgpt.com/g/g-p-abc123")).toBeUndefined();
    expect(extractProviderConversationId("https://chatgpt.com/")).toBeUndefined();
    expect(extractProviderConversationId("https://example.com/c/conv-a")).toBeUndefined();
    expect(extractProviderConversationId("http://chatgpt.com/c/conv-a")).toBeUndefined();
    expect(extractProviderConversationId(undefined)).toBeUndefined();
  });
});
