import { describe, expect, it } from "vitest";
import { isResolvedProviderConversation, isSameProviderConversation, type ProviderPageIdentity } from "../src/core/page-conversation-identity";

const page = (over: Partial<ProviderPageIdentity> = {}): ProviderPageIdentity => ({
  origin: "https://chatgpt.com",
  conversationId: "conv-1",
  pageKind: "conversation",
  ...over
});

describe("isSameProviderConversation", () => {
  it("keeps the same conversation across a route reshape", () => {
    // `/c/<id>` and `/g/<project>/c/<id>` are the same provider conversation.
    expect(isSameProviderConversation(page(), page())).toBe(true);
  });

  it("treats a changed conversation id as a conversation change", () => {
    expect(isSameProviderConversation(page(), page({ conversationId: "conv-2" }))).toBe(false);
  });

  it("never proves sameness from an empty or unresolved id", () => {
    expect(isSameProviderConversation(page({ conversationId: "" }), page({ conversationId: "" }))).toBe(false);
    expect(isSameProviderConversation(page(), page({ conversationId: "" }))).toBe(false);
    expect(isSameProviderConversation(page({ conversationId: "" }), page())).toBe(false);
  });

  it("does not cross providers", () => {
    expect(isSameProviderConversation(page(), page({ origin: "https://chat.openai.com" }))).toBe(false);
  });

  it("does not treat a non-conversation page as the conversation", () => {
    expect(isSameProviderConversation(page(), page({ pageKind: "login" }))).toBe(false);
    expect(isSameProviderConversation(page({ pageKind: "unsupported" }), page())).toBe(false);
  });
});

describe("isResolvedProviderConversation", () => {
  it("recognizes a conversation page with a provider id", () => {
    expect(isResolvedProviderConversation(page())).toBe(true);
  });

  it("does not treat a placeholder, empty, or non-conversation page as resolved", () => {
    expect(isResolvedProviderConversation(page({ conversationId: "" }))).toBe(false);
    expect(isResolvedProviderConversation(page({ pageKind: "unknown" }))).toBe(false);
    expect(isResolvedProviderConversation(page({ pageKind: "composer", conversationId: "" }))).toBe(false);
  });
});
