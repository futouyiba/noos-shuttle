import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

async function loadHandshake() {
  vi.resetModules();
  const addListener = vi.fn();
  vi.stubGlobal("chrome", {
    runtime: { onInstalled: { addListener: vi.fn() }, onMessage: { addListener } }
  });
  await import("../src/background/service-worker");
  return addListener.mock.calls[0][0];
}

async function loadMutation() {
  vi.resetModules();
  const addListener = vi.fn();
  const backing: Record<string, unknown> = { noosSubmissionOperations: [] };
  vi.stubGlobal("chrome", {
    runtime: { id: "extension-id", onInstalled: { addListener: vi.fn() }, onMessage: { addListener } },
    storage: { local: {
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (value: Record<string, unknown>) => Object.assign(backing, value)
    } }
  });
  await import("../src/background/service-worker");
  return addListener.mock.calls[0][0];
}

async function loadMutationWithBacking() {
  vi.resetModules();
  const addListener = vi.fn();
  const backing: Record<string, unknown> = { noosSubmissionOperations: [] };
  vi.stubGlobal("chrome", {
    runtime: { id: "extension-id", onInstalled: { addListener: vi.fn() }, onMessage: { addListener } },
    storage: { local: {
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (value: Record<string, unknown>) => Object.assign(backing, value)
    } }
  });
  await import("../src/background/service-worker");
  return { handler: addListener.mock.calls[0][0], backing };
}

describe("read-only observation carrier handshake", () => {
  it("uses trusted sender tabs, separates duplicate tabs and reconstructs after worker restart", async () => {
    const handler = await loadHandshake();
    const reply = vi.fn();
    const message = { type: "NOOS_OBSERVATION_CARRIER", carrierRef: "forged" };
    handler(message, { frameId: 0, tab: { id: 11, windowId: 1 }, documentId: "doc-a" }, reply);
    expect(reply).toHaveBeenLastCalledWith({ carrierRef: "browser-tab:11", windowId: 1, documentId: "doc-a" });
    handler(message, { frameId: 0, tab: { id: 12, windowId: 1 }, documentId: "doc-b" }, reply);
    expect(reply).toHaveBeenLastCalledWith({ carrierRef: "browser-tab:12", windowId: 1, documentId: "doc-b" });
    const restarted = await loadHandshake();
    restarted(message, { frameId: 0, tab: { id: 11, windowId: 2 }, documentId: "doc-c" }, reply);
    expect(reply).toHaveBeenLastCalledWith({ carrierRef: "browser-tab:11", windowId: 2, documentId: "doc-c" });
  });

  it("does not attach subframes or messages without a sender tab", async () => {
    const handler = await loadHandshake();
    const reply = vi.fn();
    handler({ type: "NOOS_OBSERVATION_CARRIER" }, { frameId: 1, tab: { id: 11 } }, reply);
    handler({ type: "NOOS_OBSERVATION_CARRIER" }, { frameId: 0 }, reply);
    expect(reply).not.toHaveBeenCalled();
  });

  it("accepts only fully validated top-frame provider mutation messages", async () => {
    const handler = await loadMutation();
    const reply = vi.fn();
    const valid = {
      type: "NOOS_SUBMISSION_MUTATION",
      mutation: {
        type: "prepare",
        input: {
          operationId: "go-1",
          operationKind: "GO",
          workItemId: "work-1",
          logicalThreadId: "thread-1",
          targetCarrierRef: "browser-tab:11",
          providerConversationRef: "conversation-a",
          dispatchFence: {
            providerConversationRef: "conversation-a",
            bindingEpoch: 1,
            leaseGeneration: 1,
            leaseOwnerRef: "owner-1",
            targetCarrierRef: "browser-tab:11"
          },
          payloadFingerprint: "f9a9bbb2",
          payload: "payload-1",
          preSubmitBaseline: { routeRef: "/c/conversation-a", assistantMessageCount: 1, userMessageCount: 1, observedAt: 1 }
        }
      }
    };
    handler(valid, { id: "extension-id", frameId: 0, tab: { id: 11 }, url: "https://chatgpt.com/c/conversation-a" }, reply);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));

    const invalidReply = vi.fn();
    handler(valid, { id: "extension-id", frameId: 1, tab: { id: 11 }, url: "https://chatgpt.com/c/conversation-a" }, invalidReply);
    handler({ ...valid, mutation: { type: "record", operationId: "go-1", state: "FAILED_SAFE", details: {} } }, { id: "extension-id", frameId: 0, tab: { id: 11 }, url: "https://chatgpt.com/c/conversation-a" }, invalidReply);
    handler(valid, { id: "other-extension", frameId: 0, tab: { id: 11 }, url: "https://chatgpt.com/c/conversation-a" }, invalidReply);
    expect(invalidReply).not.toHaveBeenCalled();
  });

  it("initializes and persists authority before granting a real claim", async () => {
    const { handler, backing } = await loadMutationWithBacking();
    const reply = vi.fn();
    const prepare = {
      type: "NOOS_SUBMISSION_MUTATION",
      mutation: {
        type: "prepare",
        input: {
          operationId: "go-authority",
          operationKind: "GO",
          workItemId: "work-1",
          logicalThreadId: "thread-1",
          targetCarrierRef: "browser-tab:11",
          providerConversationRef: "conversation-a",
          dispatchFence: {
            providerConversationRef: "conversation-a",
            bindingEpoch: 1,
            leaseGeneration: 1,
            leaseOwnerRef: "owner-1",
            targetCarrierRef: "browser-tab:11"
          },
          payloadFingerprint: "f9a9bbb2",
          payload: "payload-1",
          preSubmitBaseline: { routeRef: "/c/conversation-a", assistantMessageCount: 1, userMessageCount: 1, observedAt: 1 }
        }
      }
    };
    handler(prepare, { id: "extension-id", frameId: 0, tab: { id: 11 }, url: "https://chatgpt.com/c/conversation-a" }, reply);
    await new Promise(resolve => setTimeout(resolve, 0));
    handler({
      type: "NOOS_SUBMISSION_MUTATION",
      mutation: {
        type: "claim",
        operationId: "go-authority",
        now: 10,
        context: {
          logicalThreadId: "thread-1",
          providerConversationRef: "conversation-a",
          bindingEpoch: 1,
          leaseGeneration: 1,
          leaseOwnerRef: "owner-1",
          targetCarrierRef: "browser-tab:11",
          carrierState: "READY",
          logicalControl: "CONTINUE",
          explicitGo: true,
          sourceEpoch: 0,
          sourceObservedAt: 1
        }
      }
    }, { id: "extension-id", frameId: 0, tab: { id: 11 }, url: "https://chatgpt.com/c/conversation-a" }, reply);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ ok: true, result: expect.objectContaining({ state: "DISPATCHING" }) }));
    expect(backing.noosSubmissionAuthority).toEqual(expect.objectContaining({ logicalThreadId: "thread-1", providerConversationRef: "conversation-a" }));
  });
});
