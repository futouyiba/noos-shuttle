import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * #100 slice 1, extension half: pairing is an explicit, Human-mediated act.
 *
 * The old flow auto-GET /pair on any 401 — which, once the Hub stops issuing
 * tokens on a bare GET, would be both useless and dishonest (silent retry
 * forever). These pin the new shape: a code in, a token out, and an
 * unauthorized reply that surfaces re-pairing rather than hiding it.
 */

type FetchMock = ReturnType<typeof vi.fn>;

function installChrome(fetchMock: FetchMock, storedToken: string | null): {
  storageSet: ReturnType<typeof vi.fn>;
  storageRemove: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>(storedToken ? [["noosHubShuttleToken", storedToken]] : []);
  const storageSet = vi.fn(async (value: Record<string, string>) => {
    for (const [key, val] of Object.entries(value)) store.set(key, val);
  });
  const storageRemove = vi.fn(async (key: string) => { store.delete(key); });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() }
    },
    storage: { local: { get: async (key: string) => Object.fromEntries(store.has(key) ? [[key, store.get(key)]] : []), set: storageSet, remove: storageRemove } }
  };
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  return { storageSet, storageRemove };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("pairWithHub posts the Human's code and nothing else", () => {
  beforeEach(() => { vi.resetModules(); });

  it("stores the token on a successful enrollment", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, token: "tok-1", origin: "chrome-extension://x" }));
    const { storageSet } = installChrome(fetchMock, null);
    const { pairWithHub } = await import("../src/background/service-worker");

    const outcome = await pairWithHub("12345678");
    expect(outcome).toEqual({ status: "paired", token: "tok-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/pair");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toBe(JSON.stringify({ code: "12345678" }));
    expect(storageSet).toHaveBeenCalledWith({ noosHubShuttleToken: "tok-1" });
  });

  it("surfaces the Hub's refusal verbatim and stores nothing", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401, { ok: false, error_code: "pairing_code_expired" }));
    const { storageSet } = installChrome(fetchMock, null);
    const { pairWithHub } = await import("../src/background/service-worker");

    const outcome = await pairWithHub("12345678");
    expect(outcome).toEqual({ status: "pairing_required", errorCode: "pairing_code_expired" });
    expect(storageSet).not.toHaveBeenCalled();
  });

  it("refuses a malformed code without touching the network", async () => {
    const fetchMock = vi.fn();
    installChrome(fetchMock, null);
    const { pairWithHub } = await import("../src/background/service-worker");

    const outcome = await pairWithHub("abcd");
    expect(outcome).toEqual({ status: "pairing_required", errorCode: "pairing_code_invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("an unauthorized reply surfaces re-pairing; it never silently re-pairs", () => {
  beforeEach(() => { vi.resetModules(); });

  it("GET repair drops the dead token and never calls /pair", async () => {
    let pairingCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/pair")) { pairingCalls += 1; return jsonResponse(401, { error_code: "pairing_required" }); }
      return jsonResponse(401, { ok: false, error_code: "unauthorized" });
    });
    const { storageRemove } = installChrome(fetchMock, "dead-token");
    const { fetchHubJsonWithRepair } = await import("../src/background/service-worker");

    const result = (await fetchHubJsonWithRepair("http://127.0.0.1:17642/v1/vault/recent")) as { errorCode?: string };
    expect(result.errorCode).toBe("unauthorized");
    expect(storageRemove).toHaveBeenCalledWith("noosHubShuttleToken");
    expect(pairingCalls).toBe(0);
  });

  it("POST repair follows the same rule", async () => {
    let pairingCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/pair")) { pairingCalls += 1; return jsonResponse(401, { error_code: "pairing_required" }); }
      return jsonResponse(401, { ok: false, error_code: "unauthorized" });
    });
    const { storageRemove } = installChrome(fetchMock, "dead-token");
    const { postHubJsonWithRepair } = await import("../src/background/service-worker");

    const result = (await postHubJsonWithRepair("http://127.0.0.1:17642/v1/actions", { command: "x" })) as { errorCode?: string };
    expect(result.errorCode).toBe("unauthorized");
    expect(storageRemove).toHaveBeenCalledWith("noosHubShuttleToken");
    expect(pairingCalls).toBe(0);
  });
});
