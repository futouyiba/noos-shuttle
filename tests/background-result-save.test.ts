import { afterEach, describe, expect, it, vi } from "vitest";
import { hubVaultRelativePath } from "../src/core/hub-object-path";

/**
 * Issue #152: a chatbot-returned Result uses the same Hub write path as
 * handoffs and crystals, with `object_type=result`. These pin the message
 * contract (`NOOS_SAVE_RESULT_TO_VAULT`), the Hub payload, and the
 * Downloads-mirror fallback into `results/inbox`.
 */

type Handler = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | undefined;

const SENDER = {
  id: "extension-id",
  frameId: 0,
  tab: { id: 11, url: "https://chatgpt.com/c/conversation-a" },
  url: "https://chatgpt.com/c/conversation-a"
};

const RESULT_MARKDOWN = `<!-- NOOS:RESULT:BEGIN -->
---
type: noos_result
version: 0.1
result_key: 20261105-shortest-loop
title: Shortest Useful Loop
summary: Chatbot returned a markerized result.
---

# 结果：Shortest Useful Loop

## 结果
The loop closed.
<!-- NOOS:RESULT:END -->`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadHandler(storedToken: string | null): Promise<{
  handler: Handler;
  downloads: ReturnType<typeof vi.fn>;
  storage: Map<string, string>;
}> {
  vi.resetModules();
  const addListener = vi.fn();
  const storage = new Map<string, string>(storedToken ? [["noosHubShuttleToken", storedToken]] : []);
  const downloads = vi.fn(async () => 1);

  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension-id",
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener }
    },
    storage: {
      local: {
        get: async (key: string) => (storage.has(key) ? { [key]: storage.get(key) } : {}),
        set: async (value: Record<string, unknown>) => {
          for (const [key, val] of Object.entries(value)) storage.set(key, String(val));
        },
        remove: async (key: string) => {
          storage.delete(key);
        }
      }
    },
    downloads: { download: downloads }
  });

  await import("../src/background/service-worker");
  return { handler: addListener.mock.calls[0][0] as Handler, downloads, storage };
}

function send(handler: Handler, message: unknown, sender: unknown = SENDER): Promise<unknown> {
  return new Promise((resolve) => {
    const returned = handler(message, sender, resolve);
    if (returned !== true) {
      resolve(undefined);
    }
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const RESULT_SAVE_MESSAGE = {
  type: "NOOS_SAVE_RESULT_TO_VAULT",
  filename: "2026-11-05-shortest-useful-loop.md",
  content: RESULT_MARKDOWN
};

describe("chatbot Result save path (issue #152)", () => {
  it("posts object_type=result to the Hub ingest endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        location: "/vault/results/inbox/20261105-shortest-useful-loop.md",
        lookup_key: "20261105-shortest-useful-loop",
        object_id: "noos_obj_result"
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { handler, downloads } = await loadHandler("tok-result");

    const response = (await send(handler, RESULT_SAVE_MESSAGE)) as Record<string, unknown>;

    expect(response).toMatchObject({
      ok: true,
      backend: "hub_local",
      key: "20261105-shortest-useful-loop",
      objectId: "noos_obj_result"
    });
    expect(downloads).not.toHaveBeenCalled();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:17642/v1/ingest");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-result");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.object_type).toBe("result");
    expect(body.suggested).toMatchObject({ filename: "2026-11-05-shortest-useful-loop.md" });
    // F1: an explicit `active` would make Hub write to vault/results/active,
    // which its browse/recent enumerators never read. Omitting it lets Hub's
    // result default (`inbox`) apply.
    expect((body.suggested as Record<string, unknown>).status).toBeUndefined();
    expect(hubVaultRelativePath("result", (body.suggested as { status?: string }).status)).toBe("vault/results/inbox");
    expect(body.source).toMatchObject({
      app: "browser-shuttle",
      url: "https://chatgpt.com/c/conversation-a"
    });
    expect(body.content).toEqual({ media_type: "text/markdown", text: RESULT_MARKDOWN });
  });

  it("falls back to the Downloads mirror under results/inbox when the Hub is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("connect ECONNREFUSED"))));
    const { handler, downloads } = await loadHandler("tok-result");

    const response = (await send(handler, RESULT_SAVE_MESSAGE)) as Record<string, unknown>;

    expect(response).toMatchObject({ ok: true, backend: "downloads_mirror" });
    expect(String(response.location)).toContain("NOOS/vault/results/inbox/");
    expect(downloads).toHaveBeenCalledTimes(1);
    const options = downloads.mock.calls[0][0] as { filename: string; url: string };
    expect(options.filename).toBe("NOOS/vault/results/inbox/2026-11-05-shortest-useful-loop.md");
    expect(decodeURIComponent(options.url)).toContain(RESULT_MARKDOWN);
  });

  it("drops a dead token and falls back to the mirror instead of silently re-pairing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { ok: false, error_code: "unauthorized" })));
    const { handler, storage, downloads } = await loadHandler("dead-token");

    const response = (await send(handler, RESULT_SAVE_MESSAGE)) as Record<string, unknown>;

    expect(response).toMatchObject({ ok: true, backend: "downloads_mirror" });
    expect(String(response.location)).toContain("NOOS/vault/results/inbox/");
    expect(storage.has("noosHubShuttleToken")).toBe(false);
    expect(downloads).toHaveBeenCalledTimes(1);
  });

  it("ignores a malformed result message", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { handler } = await loadHandler("tok-result");

    const response = await send(handler, { type: "NOOS_SAVE_RESULT_TO_VAULT", filename: "x.md" });

    expect(response).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
