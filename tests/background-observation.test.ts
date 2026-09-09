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
});
