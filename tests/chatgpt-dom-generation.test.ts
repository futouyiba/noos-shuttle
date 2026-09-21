import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { isChatbotGenerating } from "../src/content/chatgpt-dom";

/**
 * `chatgpt-dom` reads the live `document`/`window`, so each case installs a
 * jsdom window as the global before calling into the module.
 */
function withDom(html: string, callback: () => void): void {
  const dom = new JSDOM(html, { url: "https://chatgpt.com/c/example", pretendToBeVisual: true });
  const win = dom.window as unknown as Window & typeof globalThis;

  // jsdom performs no layout: every element measures 0x0, which would read as
  // invisible. Report a non-zero box for laid-out elements and keep collapsed
  // ones at zero so `isVisible` still exercises its own guards.
  Object.defineProperty(win.Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: Element) {
      const collapsed = win.getComputedStyle(this).display === "none";
      const width = collapsed ? 0 : 94;
      const height = collapsed ? 0 : 24;
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) };
    }
  });

  const keys = ["document", "window", "Node", "Element", "HTMLElement", "HTMLButtonElement", "HTMLTextAreaElement"] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: win[key as keyof typeof win], configurable: true });
  }

  try {
    callback();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete (globalThis as Record<string, unknown>)[key];
      }
    }
  }
}

/** The composer region a real stop control belongs to (issue #80 first-hand read). */
const COMPOSER = `<form><div id="prompt-textarea" contenteditable="true"></div>`;
const COMPOSER_END = `</form>`;

/** Reproduces the converged-turn disclosure control reported in issue #69. */
const CONVERGED_TURN = `
  <main>
    <section data-turn="assistant" data-testid="conversation-turn-6" data-turn-id="ecca01a9">
      <div class="markdown"><p>推理过程已收敛。</p></div>
      <button type="button"><span>已停止思考</span></button>
    </section>
  </main>`;

describe("isChatbotGenerating", () => {
  it("does not read a converged 已停止思考 disclosure control as an active generation", () => {
    withDom(`<body>${CONVERGED_TURN}${COMPOSER}${COMPOSER_END}</body>`, () => {
      expect(isChatbotGenerating()).toBe(false);
    });
  });

  it("does not read a converged disclosure control outside a turn container as active", () => {
    withDom(`<body><button type="button">已停止思考</button>${COMPOSER}${COMPOSER_END}</body>`, () => {
      expect(isChatbotGenerating()).toBe(false);
    });
  });

  it("does not read an aria-expanded disclosure toggle as active", () => {
    withDom(`<body><button type="button" aria-expanded="false">停止</button>${COMPOSER}${COMPOSER_END}</body>`, () => {
      expect(isChatbotGenerating()).toBe(false);
    });
  });

  it("does not read an English converged disclosure control as active", () => {
    withDom(
      `<body>
        <section data-turn="assistant" data-testid="conversation-turn-2">
          <button type="button" aria-expanded="false">Stopped thinking</button>
        </section>
        ${COMPOSER}${COMPOSER_END}
      </body>`,
      () => {
        expect(isChatbotGenerating()).toBe(false);
      }
    );
  });

  it("detects the composer stop button while the provider is generating", () => {
    withDom(
      `<body>${COMPOSER}<button id="composer-submit-button" data-testid="stop-button" aria-label="停止回答"></button>${COMPOSER_END}</body>`,
      () => {
        expect(isChatbotGenerating()).toBe(true);
      }
    );
  });

  it("detects a composer stop button matched only by its aria-label", () => {
    withDom(`<body>${COMPOSER}<button type="button" aria-label="停止回答"></button>${COMPOSER_END}</body>`, () => {
      expect(isChatbotGenerating()).toBe(true);
    });
  });

  it("still detects a composer-side stop control that only its text identifies", () => {
    withDom(`<body>${COMPOSER}<button type="button">Stop generating</button>${COMPOSER_END}</body>`, () => {
      expect(isChatbotGenerating()).toBe(true);
    });
  });

  it("detects the composer stop button even while a converged disclosure control is present", () => {
    withDom(
      `<body>${CONVERGED_TURN}${COMPOSER}<button id="composer-submit-button" data-testid="stop-button" aria-label="停止回答"></button>${COMPOSER_END}</body>`,
      () => {
        expect(isChatbotGenerating()).toBe(true);
      }
    );
  });

  it("ignores a collapsed composer stop control", () => {
    withDom(
      `<body>${COMPOSER}<button id="composer-submit-button" data-testid="stop-button" style="display: none"></button>${COMPOSER_END}</body>`,
      () => {
        expect(isChatbotGenerating()).toBe(false);
      }
    );
  });
});

/**
 * Narrowing the fallback is only safe while the exact-attribute pass stays
 * unguarded, so these pin the ways a later change could quietly reintroduce a
 * false negative.
 *
 * Placement matters more than the assertion: a fixture the fallback would
 * catch anyway pins nothing. So the fixtures that pin a *selector* are
 * turn-scoped, where only the exact pass can reach them — a composer-scoped
 * `停止生成` fixture would pass even with that selector deleted. The
 * `aria-expanded` fixture is composer-scoped on purpose; it pins a different
 * property, that neither new guard is extended to the exact pass.
 */
describe("isChatbotGenerating — the exact-attribute pass is deliberately unguarded", () => {
  it("detects an exact stop control that sits inside an assistant turn", () => {
    withDom(
      `<body>
        <section data-turn="assistant" data-testid="conversation-turn-6">
          <button type="button" data-testid="stop-button"></button>
        </section>
        ${COMPOSER}${COMPOSER_END}
      </body>`,
      () => {
        expect(isChatbotGenerating()).toBe(true);
      }
    );
  });

  it("detects an exact aria-label stop control that sits inside an assistant turn", () => {
    withDom(
      `<body>
        <section data-turn="assistant" data-testid="conversation-turn-6">
          <button type="button" aria-label="停止回答"></button>
        </section>
        ${COMPOSER}${COMPOSER_END}
      </body>`,
      () => {
        expect(isChatbotGenerating()).toBe(true);
      }
    );
  });

  it("detects an exact stop control that carries aria-expanded", () => {
    withDom(
      `<body>${COMPOSER}<button type="button" data-testid="stop-button" aria-expanded="false"></button>${COMPOSER_END}</body>`,
      () => {
        expect(isChatbotGenerating()).toBe(true);
      }
    );
  });

  it("detects a stop control whose only signal is the aria-label='停止生成' selector", () => {
    // Turn-scoped so the fallback excludes it: without the selector this
    // control is invisible to the module.
    withDom(
      `<body>
        <section data-turn="assistant" data-testid="conversation-turn-6">
          <button type="button" aria-label="停止生成"></button>
        </section>
        ${COMPOSER}${COMPOSER_END}
      </body>`,
      () => {
        expect(isChatbotGenerating()).toBe(true);
      }
    );
  });

  it("detects a stop control identified in turn by the aria-label='停止' selector", () => {
    // Same shape as above — the fallback excludes turn-scoped controls, so this
    // can only be reached through the exact pass.
    withDom(
      `<body>
        <section data-turn="assistant" data-testid="conversation-turn-6">
          <button type="button" aria-label="停止"></button>
        </section>
        ${COMPOSER}${COMPOSER_END}
      </body>`,
      () => {
        expect(isChatbotGenerating()).toBe(true);
      }
    );
  });
});
