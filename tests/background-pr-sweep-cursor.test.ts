import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * PR #151 was narrowed to an observe-only experimental harness (designer ruling
 * 6680747888, path B): the background coordinator must no longer read or write a
 * durable PR-sweep cursor. These tests assert the *absence* of that capability,
 * so a future durable promotion has to be an explicit, reviewed change rather
 * than a quiet re-add.
 */

afterEach(() => vi.unstubAllGlobals());

async function loadHandler() {
  vi.resetModules();
  const addListener = vi.fn();
  const backing: Record<string, unknown> = {};
  const get = vi.fn(async (key: string) => ({ [key]: backing[key] }));
  const set = vi.fn(async (value: Record<string, unknown>) => { Object.assign(backing, value); });
  vi.stubGlobal("chrome", {
    runtime: { id: "extension-id", onInstalled: { addListener: vi.fn() }, onMessage: { addListener } },
    storage: { local: { get, set } }
  });
  await import("../src/background/service-worker");
  return { handler: addListener.mock.calls[0][0], backing, get, set };
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

describe("PR comment sweep cursor is observe-only in this harness", () => {
  it("does not handle a durable-advance message and writes nothing", async () => {
    const { handler, backing, set } = await loadHandler();

    const reply = send(handler, {
      type: "NOOS_PR_SWEEP_CURSOR_ADVANCE",
      prRef: PR,
      expectedStoredCursor: null,
      cursor: "c-1",
      operationId: "sweep-1",
      observedAt: 1_000
    });
    await settle();

    expect(reply).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(backing).toEqual({});
  });

  it("does not handle a cursor-read message, so no stored value can become authority", async () => {
    const { handler, backing, get } = await loadHandler();

    const reply = send(handler, { type: "NOOS_PR_SWEEP_CURSOR_READ", prRef: PR });
    await settle();

    expect(reply).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(backing).toEqual({});
  });

  it("keeps the service worker free of any PR-sweep cursor plumbing", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/background/service-worker.ts", import.meta.url)), "utf8");
    expect(source).not.toContain("NOOS_PR_SWEEP_CURSOR");
    expect(source).not.toContain("pr-sweep-cursor");
  });

  it("removes the background writer module entirely", () => {
    expect(existsSync(fileURLToPath(new URL("../src/background/pr-sweep-cursor.ts", import.meta.url)))).toBe(false);
  });

  it("keeps the content script off the storage lane and on the observation lane", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/content/index.ts", import.meta.url)), "utf8");
    expect(source).not.toContain("NOOS_PR_SWEEP_CURSOR");
    expect(source).not.toContain("commitPrSweepCursor");
    expect(source).toContain("reportPrSweepCursorObservation");
  });
});
