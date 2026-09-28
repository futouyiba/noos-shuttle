import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { bindPairingPanelEvents } from "../apps/noos-hub/src/ui/pairing-events";

/**
 * #128: the pairing panel's buttons went dead after ANY action, because the
 * handler ended with loadPairingPanel() — an innerHTML rebuild of
 * #pairing-panel — which destroyed the just-used per-button listeners and
 * never rebound them. The Human got stuck mid-pairing: code expires (3 min
 * TTL) → wants a new one → dead button.
 *
 * These pin the delegation fix against the exact failure scenario: click →
 * panel rebuilt → click again, with no re-bind call in between.
 */

interface Harness {
  dom: JSDOM;
  invoke: ReturnType<typeof vi.fn>;
  rebuilds: number;
}

function harness(initialBody: string): Harness {
  const dom = new JSDOM(`<body>${initialBody}</body>`, { url: "http://localhost/" });
  const invoke = vi.fn(async () => undefined);
  let rebuilds = 0;
  const win = dom.window as unknown as Window & typeof globalThis;
  const previous = { document: globalThis.document, window: globalThis.window, HTMLElement: globalThis.HTMLElement };
  for (const key of Object.keys(previous) as (keyof typeof previous)[]) {
    Object.defineProperty(globalThis, key, { value: (win as unknown as Record<string, unknown>)[key], configurable: true });
  }
  bindPairingPanelEvents(dom.window.document, {
    invoke,
    loadPairingPanel: async () => {
      // Exactly what the real one does: replace the panel's CONTENT, keeping
      // the container element (and any listener bound to it) alive.
      rebuilds += 1;
      dom.window.document.getElementById("pairing-panel")!.innerHTML = panelMarkup(rebuilds);
    },
    confirm: () => true,
    showToast: () => undefined
  });
  return { dom, invoke, rebuilds };
}

function panelMarkup(version: number): string {
  return `
    <button type="button" data-pairing="generate">Generate ${version}</button>
    <button type="button" data-pairing="approve">Approve</button>
    <button type="button" data-pairing="reject">Reject</button>
    <button type="button" data-pairing-revoke="chrome-extension://abc">Revoke</button>`;
}

function click(win: Window, selector: string): void {
  const button = (win as unknown as { document: Document }).document.querySelector<HTMLButtonElement>(selector);
  const EventCtor = (win as unknown as { Event: new (type: string, init?: EventInit) => Event }).Event;
  button?.dispatchEvent(new EventCtor("click", { bubbles: true, cancelable: true }));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("pairing panel survives its own innerHTML rebuilds (#128)", () => {
  it("two consecutive generate clicks BOTH reach invoke without any re-bind", async () => {
    const { dom, invoke } = harness(`<div id="pairing-panel">${panelMarkup(0)}</div>`);
    click(dom.window as unknown as Window, "[data-pairing='generate']");
    await flush();
    // The handler rebuilt the panel's contents — old code is now dead.
    expect(dom.window.document.getElementById("pairing-panel")!.innerHTML).toContain("Generate 1");
    click(dom.window as unknown as Window, "[data-pairing='generate']");
    await flush();
    const calls = invoke.mock.calls.filter(call => call[0] === "generate_pair_code_command");
    expect(calls).toHaveLength(2);
    expect(dom.window.document.getElementById("pairing-panel")!.innerHTML).toContain("Generate 2");
  });

  it("approve, reject, reset and revoke all stay live across rebuilds", async () => {
    const { dom, invoke } = harness(`<div id="pairing-panel">${panelMarkup(0)}</div>`);
    const win = dom.window as unknown as Window;
    click(win, "[data-pairing='generate']"); await flush(); // rebuild 1
    click(win, "[data-pairing='approve']"); await flush();  // rebuild 2
    click(win, "[data-pairing='reject']"); await flush();    // rebuild 3
    click(win, "[data-pairing-revoke]"); await flush();      // rebuild 4
    const commands = invoke.mock.calls.map(call => call[0]);
    expect(commands).toContain("generate_pair_code_command");
    expect(commands).toContain("approve_pending_enrollment");
    expect(commands).toContain("reject_pending_enrollment");
    expect(commands).toContain("revoke_paired_client");
    expect((invoke.mock.calls.find(call => call[0] === "revoke_paired_client") as unknown[])[1])
      .toEqual({ origin: "chrome-extension://abc" });
  });

  it("reset is refused when the Human cancels the confirmation", async () => {
    const dom = new JSDOM('<body><div id="pairing-panel"><button type="button" data-pairing="reset">Reset</button></div></body>');
    const invoke = vi.fn(async () => undefined);
    bindPairingPanelEvents(dom.window.document, {
      invoke,
      loadPairingPanel: async () => undefined,
      confirm: () => false,
      showToast: () => undefined
    });
    dom.window.document.querySelector<HTMLButtonElement>("[data-pairing='reset']")!
      .dispatchEvent(new (dom.window as unknown as { Event: new (type: string, init?: EventInit) => Event }).Event("click", { bubbles: true }));
    await flush();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not double-bind when called twice on the same container", async () => {
    const { dom, invoke } = harness(`<div id="pairing-panel">${panelMarkup(0)}</div>`);
    bindPairingPanelEvents(dom.window.document, {
      invoke,
      loadPairingPanel: async () => undefined,
      confirm: () => true,
      showToast: () => undefined
    });
    click(dom.window as unknown as Window, "[data-pairing='generate']");
    await flush();
    expect(invoke.mock.calls.filter(call => call[0] === "generate_pair_code_command")).toHaveLength(1);
  });
});
