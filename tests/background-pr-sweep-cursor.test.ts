import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

async function loadHandler() {
  vi.resetModules();
  const addListener = vi.fn();
  const backing: Record<string, unknown> = {};
  vi.stubGlobal("chrome", {
    runtime: { id: "extension-id", onInstalled: { addListener: vi.fn() }, onMessage: { addListener } },
    storage: { local: {
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (value: Record<string, unknown>) => { Object.assign(backing, value); }
    } }
  });
  await import("../src/background/service-worker");
  return { handler: addListener.mock.calls[0][0], backing };
}

const SENDER = { id: "extension-id", frameId: 0, tab: { id: 11 }, url: "https://chatgpt.com/c/conversation-a" };
const PR = "futouyiba/noos-shuttle#61";

function send(handler: ReturnType<typeof vi.fn>, message: unknown, sender: unknown = SENDER) {
  const reply = vi.fn();
  handler(message, sender, reply);
  return reply;
}

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe("PR comment sweep watermark coordinator (issue #61 slice 5)", () => {
  it("reads an empty slot, advances, and returns the stored cursor", async () => {
    const { handler, backing } = await loadHandler();

    const empty = send(handler, { type: "NOOS_PR_SWEEP_CURSOR_READ", prRef: PR });
    await settle();
    expect(empty).toHaveBeenLastCalledWith({ ok: true });

    const advanced = send(handler, {
      type: "NOOS_PR_SWEEP_CURSOR_ADVANCE",
      prRef: PR,
      expectedStoredCursor: null,
      cursor: "c-1",
      operationId: "sweep-1",
      observedAt: 1_000
    });
    await settle();
    expect(advanced).toHaveBeenLastCalledWith({ ok: true, cursor: "c-1", observedAt: 1_000 });
    expect(backing.noosPrSweepCursors).toEqual({
      [PR]: { cursor: "c-1", operationId: "sweep-1", observedAt: 1_000 }
    });

    const read = send(handler, { type: "NOOS_PR_SWEEP_CURSOR_READ", prRef: PR });
    await settle();
    expect(read).toHaveBeenLastCalledWith({ ok: true, cursor: "c-1", observedAt: 1_000 });
  });

  it("refuses a stale writer and leaves the newer watermark in place", async () => {
    const { handler, backing } = await loadHandler();

    send(handler, { type: "NOOS_PR_SWEEP_CURSOR_ADVANCE", prRef: PR, expectedStoredCursor: null, cursor: "c-1", operationId: "sweep-1", observedAt: 1_000 });
    await settle();
    send(handler, { type: "NOOS_PR_SWEEP_CURSOR_ADVANCE", prRef: PR, expectedStoredCursor: "c-1", cursor: "c-2", operationId: "sweep-2", observedAt: 2_000 });
    await settle();

    const stale = send(handler, { type: "NOOS_PR_SWEEP_CURSOR_ADVANCE", prRef: PR, expectedStoredCursor: "c-1", cursor: "c-stale", operationId: "sweep-stale", observedAt: 3_000 });
    await settle();
    expect(stale).toHaveBeenLastCalledWith({ ok: false, reason: "cursor_conflict" });
    expect(backing.noosPrSweepCursors).toMatchObject({ [PR]: { cursor: "c-2" } });
  });

  it("keeps the store feature-local and never touches watcher state", async () => {
    const { handler, backing } = await loadHandler();
    send(handler, { type: "NOOS_PR_SWEEP_CURSOR_ADVANCE", prRef: PR, expectedStoredCursor: null, cursor: "c-1", operationId: "sweep-1", observedAt: 1_000 });
    await settle();
    expect(Object.keys(backing)).toEqual(["noosPrSweepCursors"]);
    expect(backing).not.toHaveProperty("watcherState");
    expect(backing).not.toHaveProperty("watermark");
  });

  it("rejects subframes, non-provider senders and invalid refs", async () => {
    const { handler } = await loadHandler();

    const subframe = send(handler, { type: "NOOS_PR_SWEEP_CURSOR_READ", prRef: PR }, { ...SENDER, frameId: 1 });
    const foreign = send(handler, { type: "NOOS_PR_SWEEP_CURSOR_READ", prRef: PR }, { ...SENDER, id: "other-extension" });
    const nonProvider = send(handler, { type: "NOOS_PR_SWEEP_CURSOR_READ", prRef: PR }, { ...SENDER, url: "https://example.com/c/x" });
    const invalidRef = send(handler, { type: "NOOS_PR_SWEEP_CURSOR_READ", prRef: "  " });
    await settle();

    for (const reply of [subframe, foreign, nonProvider, invalidRef]) {
      expect(reply).toHaveBeenCalledWith({ ok: false, error: "sender_not_allowed" });
    }
  });

  it("rejects an advance without a compare-and-set snapshot or with a multiline cursor", async () => {
    const { handler, backing } = await loadHandler();

    const noSnapshot = send(handler, { type: "NOOS_PR_SWEEP_CURSOR_ADVANCE", prRef: PR, cursor: "c-1", operationId: "sweep-1", observedAt: 1_000 });
    const multiline = send(handler, { type: "NOOS_PR_SWEEP_CURSOR_ADVANCE", prRef: PR, expectedStoredCursor: null, cursor: "a\nb", operationId: "sweep-1", observedAt: 1_000 });
    await settle();

    expect(noSnapshot).toHaveBeenCalledWith({ ok: false, error: "sender_not_allowed" });
    expect(multiline).toHaveBeenCalledWith({ ok: false, error: "sender_not_allowed" });
    expect(backing.noosPrSweepCursors).toBeUndefined();
  });
});
