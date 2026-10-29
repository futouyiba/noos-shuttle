import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { findMainChatComposer, getChatComposer, isChatbotGenerating } from "../src/content/chatgpt-dom";

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
 * Active-generation evidence is structural, not lexical (issue #84 ruling).
 * A control is not active merely because its exact attribute happens to be one
 * of the words a live stop control uses; a turn-scoped control or a disclosure
 * toggle is history.
 */
describe("isChatbotGenerating — lexical exactness is not authority", () => {
  it.each([
    ["data-testid stop-button", `<button type="button" data-testid="stop-button"></button>`],
    ["aria-label 停止回答", `<button type="button" aria-label="停止回答"></button>`],
    ["aria-label 停止生成", `<button type="button" aria-label="停止生成"></button>`],
    ["aria-label 停止", `<button type="button" aria-label="停止"></button>`],
    ["aria-label Stop", `<button type="button" aria-label="Stop"></button>`]
  ])("does not read a turn-scoped %s control as active", (_name, control) => {
    withDom(
      `<body><section data-turn="assistant" data-testid="conversation-turn-6">${control}</section>${COMPOSER}${COMPOSER_END}</body>`,
      () => {
        expect(isChatbotGenerating()).toBe(false);
      }
    );
  });

  it("does not read a converged disclosure by its aria-label inside a turn as active", () => {
    withDom(
      `<body>
        <section data-turn="assistant" data-testid="conversation-turn-6">
          <button type="button" aria-label="已停止思考"></button>
        </section>
        ${COMPOSER}${COMPOSER_END}
      </body>`,
      () => {
        expect(isChatbotGenerating()).toBe(false);
      }
    );
  });

  it("does not read an English converged aria-label outside a turn as active", () => {
    withDom(`<body><button type="button" aria-label="Stopped thinking"></button>${COMPOSER}${COMPOSER_END}</body>`, () => {
      expect(isChatbotGenerating()).toBe(false);
    });
  });

  it("does not restore the deleted substring scanner for a stop-bearing testid", () => {
    // The removed index.ts scan matched this shape on `[data-testid*='stop']`
    // alone; the guarded classifier must not.
    withDom(`<body><button type="button" data-testid="thinking-stop-toggle">已停止思考</button>${COMPOSER}${COMPOSER_END}</body>`, () => {
      expect(isChatbotGenerating()).toBe(false);
    });
  });

  it("does not read an exact stop control carrying aria-expanded as active", () => {
    withDom(`<body>${COMPOSER}<button type="button" data-testid="stop-button" aria-expanded="false"></button>${COMPOSER_END}</body>`, () => {
      expect(isChatbotGenerating()).toBe(false);
    });
  });

  it("counts a generic exact stop label when it sits in the composer region", () => {
    withDom(`<body>${COMPOSER}<button type="button" aria-label="停止"></button>${COMPOSER_END}</body>`, () => {
      expect(isChatbotGenerating()).toBe(true);
    });
  });
});

/**
 * The two former independent paths must not be able to bypass the same guard
 * (issue #84): index.ts delegates to this classifier instead of scanning the
 * page with its own lexical selectors.
 */
describe("index.ts delegates stop-control detection to this classifier", () => {
  // fileURLToPath, not .pathname: this repo path contains spaces.
  const index = readFileSync(fileURLToPath(new URL("../src/content/index.ts", import.meta.url)), "utf8");

  it("has no independent lexical stop-control scanner", () => {
    expect(index).not.toMatch(/querySelectorAll[^\n]*data-testid\*='stop'/);
    expect(index).not.toMatch(/aria-label\*='Stop'/);
    expect(index).not.toMatch(/aria-label\*='停止'/);
  });

  it("derives stopGenerationControlPresent only from the classifier", () => {
    expect(index).toContain("stopGenerationControlPresent: isChatbotGenerating(),");
  });
});

/** The ProseMirror-shaped composer ChatGPT is rolling out (issue #134). */
const PROSEMIRROR_COMPOSER = `<form><div class="ProseMirror" role="textbox" contenteditable="true"></div></form>`;

/** An open historical-message edit box: a usable textarea inside a turn. */
const EDITING_TURN = `<section data-message-author-role="assistant" data-testid="conversation-turn-6"><textarea>editing history</textarea></section>`;

describe("findMainChatComposer", () => {
  it("finds the ProseMirror composer when #prompt-textarea is absent (issue #134)", () => {
    withDom(`<body><main><article>a turn</article></main>${PROSEMIRROR_COMPOSER}</body>`, () => {
      expect(findMainChatComposer()).toBe(document.querySelector(".ProseMirror"));
    });
  });

  it("does not let a historical-message editor substitute for the main composer", () => {
    withDom(`<body>${EDITING_TURN}${PROSEMIRROR_COMPOSER}</body>`, () => {
      const composer = findMainChatComposer();
      expect(composer).toBe(document.querySelector(".ProseMirror"));
      expect(composer?.tagName).not.toBe("TEXTAREA");
    });
  });

  it("uses the same placement filter for execution-side lookup", () => {
    withDom(`<body>${EDITING_TURN}${PROSEMIRROR_COMPOSER}</body>`, () => {
      expect(getChatComposer()).toBe(document.querySelector(".ProseMirror"));
    });
  });

  it("rejects search and dialog textboxes as composer fallbacks", () => {
    withDom(
      `<body><form role="search"><input role="textbox" value="search"></form><div role="dialog"><textarea>dialog</textarea></div></body>`,
      () => {
        expect(findMainChatComposer()).toBeNull();
        expect(getChatComposer()).toBeNull();
      }
    );
  });

  it("does not accept a stray textarea outside the composer region as the composer", () => {
    // The decoy shape the smoke suite also plants: a usable textarea with no
    // composer-region ancestor while the main composer is missing.
    withDom(`<body><main><textarea>stray</textarea></main></body>`, () => {
      expect(findMainChatComposer()).toBeNull();
    });
  });

  it("keeps #prompt-textarea primary on legacy pages", () => {
    // The legacy shape the smoke suite renders: role=textbox carries
    // usability in jsdom, which does not implement isContentEditable.
    withDom(
      `<body><main></main><form><div id="prompt-textarea" role="textbox" contenteditable="true"></div></form></body>`,
      () => {
        expect(findMainChatComposer()).toBe(document.querySelector("#prompt-textarea"));
      }
    );
  });

  it("returns null, not a substitute, while the primary composer is unusable", () => {
    withDom(
      `<body><main></main><form><div id="prompt-textarea" contenteditable="true" aria-readonly="true"></div></form>${PROSEMIRROR_COMPOSER}</body>`,
      () => {
        expect(findMainChatComposer()).toBeNull();
      }
    );
  });
});
