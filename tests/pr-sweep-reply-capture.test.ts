import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { buildShortcutPayload } from "../src/core/continuation-payload";
import {
  capturePrSweepReplyBaseline,
  findPrSweepReply,
  type PrSweepReplyBaseline
} from "../src/content/pr-sweep-reply-capture";

/**
 * Issue #61 slice 5, R2: the sweep's completion predicate must accept an echo
 * only from the reply to *this* operation's submitted user turn. A DOM that
 * merely grew by one assistant message is not evidence — history back-loading
 * and unrelated turns both break the count/last-message heuristic. These cases
 * run the real parser and the real capture predicate against jsdom.
 */

const PR_REF = "futouyiba/noos-shuttle#61";
const CURSOR = "c-1";
const PAYLOAD = buildShortcutPayload("PR_COMMENT_SWEEP", {
  prRef: PR_REF,
  cursor: CURSOR,
  sourceUrl: "https://chatgpt.com/c/example",
  conversationRef: "conversation:example"
});

function message(role: "user" | "assistant", text: string): string {
  return `<section data-message-author-role="${role}"><div>${text}</div></section>`;
}

function render(...messages: string[]): HTMLElement {
  const dom = new JSDOM(`<!doctype html><html><body><main>${messages.join("")}</main></body></html>`);
  return dom.window.document.querySelector("main") as HTMLElement;
}

function baseline(root: HTMLElement): PrSweepReplyBaseline {
  const captured = capturePrSweepReplyBaseline(root, PAYLOAD);
  if (!captured) throw new Error("baseline capture failed");
  return captured;
}

function append(root: HTMLElement, ...messages: string[]): void {
  root.insertAdjacentHTML("beforeend", messages.join(""));
}

const ECHO = "NOOS:PR_SWEEP:CURSOR=c-2";

describe("findPrSweepReply — reply binding (R2)", () => {
  it("accepts the echo in the assistant reply inside the submitted user turn", () => {
    const root = render(message("user", "an earlier question"), message("assistant", "an earlier answer"));
    const boundary = baseline(root);
    append(root,
      message("user", PAYLOAD),
      message("assistant", `已读并分类。\n${ECHO}`)
    );

    expect(findPrSweepReply(root, boundary)).toEqual({ state: "echo", cursor: "c-2" });
  });

  it("rejects an echo that already existed before dispatch even when the DOM grew", () => {
    // Reviewer R2 counterexample: baseline assistant count = 1; the only
    // assistant is an old echo for another PR. After dispatch the DOM back-loads
    // one more (earlier) assistant, so a count-only predicate sees growth and
    // reads the old echo. The boundary predicate reads no echo at all.
    const root = render(
      message("user", "an earlier question"),
      message("assistant", `old sweep echo\nNOOS:PR_SWEEP:CURSOR=old-other-pr`)
    );
    const boundary = baseline(root);
    append(root, message("assistant", "back-loaded older reply"));

    expect(findPrSweepReply(root, boundary)).toEqual({ state: "waiting" });
  });

  it("rejects a back-loaded historical echo inserted before the dispatch boundary", () => {
    const root = render(message("assistant", `old echo\nNOOS:PR_SWEEP:CURSOR=old-other-pr`));
    const boundary = baseline(root);
    root.insertAdjacentHTML("afterbegin", message("assistant", `older echo\nNOOS:PR_SWEEP:CURSOR=oldest`));

    expect(findPrSweepReply(root, boundary)).toEqual({ state: "waiting" });
  });

  it("rejects an echo from an unrelated turn after this operation's turn", () => {
    const root = render(message("assistant", "baseline answer"));
    const boundary = baseline(root);
    append(root,
      message("user", PAYLOAD),
      message("assistant", "本轮没有水位回传。"),
      message("user", "unrelated follow-up"),
      message("assistant", `unrelated answer\n${ECHO}`)
    );

    expect(findPrSweepReply(root, boundary)).toEqual({ state: "waiting" });
  });

  it("rejects an echo carried by an unrelated assistant reply that arrives before the submitted turn", () => {
    const root = render(message("assistant", "baseline answer"));
    const boundary = baseline(root);
    append(root,
      message("assistant", `unrelated reply\n${ECHO}`),
      message("user", PAYLOAD)
    );

    expect(findPrSweepReply(root, boundary)).toEqual({ state: "waiting" });
  });

  it("never reads the user turn's own echo (the payload instruction itself)", () => {
    const root = render(message("assistant", "baseline answer"));
    const boundary = baseline(root);
    append(root, message("user", `${PAYLOAD}\n${ECHO}`));

    expect(findPrSweepReply(root, boundary)).toEqual({ state: "waiting" });
  });

  it("fails closed when the dispatch boundary is no longer rendered", () => {
    const root = render(message("assistant", "baseline answer"));
    const boundary = baseline(root);
    root.innerHTML = `${message("user", PAYLOAD)}${message("assistant", `reply\n${ECHO}`)}`;

    expect(findPrSweepReply(root, boundary)).toEqual({ state: "waiting" });
  });

  it("fails closed when two identical submitted turns are visible after the boundary", () => {
    // Two tabs can submit the same payload (same PR + cursor). There is no
    // per-operation nonce in the frozen payload, so neither reply can be
    // attributed to this tab: advance nothing instead of guessing.
    const root = render(message("assistant", "baseline answer"));
    const boundary = baseline(root);
    append(root,
      message("user", PAYLOAD),
      message("assistant", `first reply\nNOOS:PR_SWEEP:CURSOR=c-1`),
      message("user", PAYLOAD),
      message("assistant", `second reply\nNOOS:PR_SWEEP:CURSOR=c-2`)
    );

    expect(findPrSweepReply(root, boundary)).toEqual({ state: "waiting" });
  });

  it("cannot accept an echo when the submitted user turn is not found", () => {
    const root = render(message("assistant", "baseline answer"));
    const boundary = baseline(root);
    append(root,
      message("user", "some other user turn"),
      message("assistant", `reply\n${ECHO}`)
    );

    expect(findPrSweepReply(root, boundary)).toEqual({ state: "waiting" });
  });

  it("reports waiting while the reply is still streaming without an echo", () => {
    const root = render(message("assistant", "baseline answer"));
    const boundary = baseline(root);
    append(root, message("user", PAYLOAD), message("assistant", "正在读取..."));

    expect(findPrSweepReply(root, boundary)).toEqual({ state: "waiting" });
  });

  it("uses the last valid echo when the bound reply repeats the line", () => {
    const root = render(message("assistant", "baseline answer"));
    const boundary = baseline(root);
    append(root,
      message("user", PAYLOAD),
      message("assistant", `NOOS:PR_SWEEP:CURSOR=c-1\nNOOS:PR_SWEEP:CURSOR=c-2`)
    );

    expect(findPrSweepReply(root, boundary)).toEqual({ state: "echo", cursor: "c-2" });
  });

  it("treats a repeated duplicate echo for the same PR as one observed token", () => {
    const root = render(message("assistant", "baseline answer"));
    const boundary = baseline(root);
    append(root,
      message("user", PAYLOAD),
      message("assistant", `${ECHO}\n${ECHO}`)
    );

    expect(findPrSweepReply(root, boundary)).toEqual({ state: "echo", cursor: "c-2" });
  });
});

describe("findPrSweepReply — no-new veto (R3)", () => {
  function boundReply(text: string): { root: HTMLElement; boundary: PrSweepReplyBaseline } {
    const root = render(message("assistant", "baseline answer"));
    const boundary = baseline(root);
    append(root, message("user", PAYLOAD), message("assistant", text));
    return { root, boundary };
  }

  it("does not advance when the reply says there are no new comments", () => {
    const { root, boundary } = boundReply("无新评论");
    expect(findPrSweepReply(root, boundary)).toEqual({ state: "no_new_comments" });
  });

  it("does not advance when 'no new comments' and a valid echo share one reply", () => {
    const { root, boundary } = boundReply(`无新评论\n${ECHO}`);
    expect(findPrSweepReply(root, boundary)).toEqual({ state: "no_new_comments" });
  });

  it("does not advance when the echo comes before the no-new statement", () => {
    const { root, boundary } = boundReply(`${ECHO}\n无新评论`);
    expect(findPrSweepReply(root, boundary)).toEqual({ state: "no_new_comments" });
  });

  it("does not advance on the English no-new branch either", () => {
    const { root, boundary } = boundReply(`No new comments.\n${ECHO}`);
    expect(findPrSweepReply(root, boundary)).toEqual({ state: "no_new_comments" });
  });
});
