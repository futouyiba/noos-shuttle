/**
 * Reply binding for the PR comment sweep (issue #61 slice 5).
 *
 * A sweep may only advance its watermark from the reply to *this* operation's
 * submitted user turn. Counting assistant messages and reading the last one is
 * not enough: ChatGPT re-renders and back-loads history, so a DOM that grew by
 * one assistant message can still hold an echo from an earlier sweep (or from
 * an unrelated turn). The predicate therefore takes a baseline before dispatch
 * and only accepts content that appears after it, anchored on the submitted
 * user turn:
 *
 *  1. the last message rendered at dispatch time is the boundary; messages that
 *     existed before it — including history back-loaded after dispatch — are
 *     outside the accepted range;
 *  2. the submitted user turn is the first user message after that boundary
 *     whose text carries the payload's own first line (explicit PR ref +
 *     cursor);
 *  3. the reply is the assistant content between that user turn and the next
 *     user turn. Echoes in other turns, in the user turn itself, or in an
 *     older/back-loaded message are never candidates.
 *
 * When any of those facts cannot be established the predicate reports
 * `waiting` and advances nothing: an extra re-read is safe, a skipped comment is
 * not. The token is still opaque here — this module never orders or interprets
 * it.
 */
import { parsePrSweepCursorEcho, prSweepReportsNoNewComments } from "../core/pr-sweep-cursor";

export const PR_SWEEP_MESSAGE_SELECTOR = "[data-message-author-role='user'], [data-message-author-role='assistant']";

/** Normalization used only for message identity; it never rewrites payload bytes. */
export function normalizePrSweepMessageText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The submitted turn's stable text anchor. The payload's first line carries the
 * explicit PR ref and the cursor the Human dispatched, so it identifies this
 * sweep's user turn without relying on message counts or ids.
 */
export function prSweepTurnAnchor(payload: string): string | undefined {
  const firstLine = normalizePrSweepMessageText(payload.split(/\r?\n/, 1)[0] ?? "");
  return firstLine || undefined;
}

export interface PrSweepReplyBaseline {
  /**
   * Normalized text of the last non-empty message rendered before dispatch, or
   * null when no message was rendered. Only messages after the last occurrence
   * of this text are candidates.
   */
  readonly headText: string | null;
  /** Normalized first line of the exact payload handed to the provider. */
  readonly turnAnchor: string;
}

export type PrSweepReplyCapture =
  | { readonly state: "waiting" }
  /** The payload's explicit "no new comments" branch: a global veto on advance. */
  | { readonly state: "no_new_comments" }
  | { readonly state: "echo"; readonly cursor: string };

function messageElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(PR_SWEEP_MESSAGE_SELECTOR));
}

function roleOf(element: Element): string {
  return element.getAttribute("data-message-author-role") ?? "";
}

function textOf(element: Element): string {
  return normalizePrSweepMessageText(element.textContent ?? "");
}

/**
 * Capture the dispatch boundary. Call this immediately before dispatch and pass
 * the exact payload bytes that are about to be written to the composer.
 */
export function capturePrSweepReplyBaseline(root: ParentNode, payload: string): PrSweepReplyBaseline | undefined {
  const turnAnchor = prSweepTurnAnchor(payload);
  if (!turnAnchor) return undefined;
  const messages = messageElements(root);
  let headText: string | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = textOf(messages[index]);
    if (text) {
      headText = text;
      break;
    }
  }
  return { headText, turnAnchor };
}

/**
 * Read the reply bound to the baseline's submitted user turn. This is the
 * completion predicate for the sweep wait; it is deliberately read-only.
 */
export function findPrSweepReply(root: ParentNode, baseline: PrSweepReplyBaseline): PrSweepReplyCapture {
  const turnAnchor = normalizePrSweepMessageText(baseline.turnAnchor);
  if (!turnAnchor) return { state: "waiting" };

  const messages = messageElements(root);

  // The baseline boundary must still be rendered. A conversation switch or a
  // full re-render without it means we cannot prove which turn belongs to this
  // operation, so fail closed instead of guessing.
  let headIndex = -1;
  if (baseline.headText !== null) {
    const headText = normalizePrSweepMessageText(baseline.headText);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (textOf(messages[index]) === headText) {
        headIndex = index;
        break;
      }
    }
    if (headIndex === -1) return { state: "waiting" };
  }

  // The submitted user turn: the first user message after the boundary carrying
  // the payload anchor. A back-loaded earlier sweep existed before the boundary
  // and is excluded; an unrelated later turn does not carry this anchor.
  //
  // Exactly one anchor turn must be visible after the boundary. Two identical
  // payload turns (for example, the same sweep submitted from another tab) leave
  // the reply unattributable, so fail closed instead of picking one.
  const anchorIndexes: number[] = [];
  for (let index = headIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (roleOf(message) !== "user") continue;
    if (textOf(message).includes(turnAnchor)) anchorIndexes.push(index);
  }
  if (anchorIndexes.length !== 1) return { state: "waiting" };
  const turnIndex = anchorIndexes[0];

  // The turn ends at the next user message; anything after it belongs to a
  // different turn and must never satisfy this operation.
  let turnEnd = messages.length;
  for (let index = turnIndex + 1; index < messages.length; index += 1) {
    if (roleOf(messages[index]) === "user") {
      turnEnd = index;
      break;
    }
  }

  // Keep line structure: the echo protocol is line-oriented. Normalizing the
  // reply (as the identity/anchor helpers do) would merge two echo lines into
  // one value and could turn `c-1` + `c-2` into a single bogus token.
  const replyText = messages
    .slice(turnIndex + 1, turnEnd)
    .filter(message => roleOf(message) === "assistant")
    .map(message => message.textContent ?? "")
    .join("\n");
  if (!replyText.trim()) return { state: "waiting" };

  // R3: "no new comments" is a global veto, checked before any echo. The
  // payload asks for an explicit no-silence answer, and that answer can also
  // carry a range echo; there is still no observed range to advance to.
  if (prSweepReportsNoNewComments(replyText)) return { state: "no_new_comments" };

  const cursor = parsePrSweepCursorEcho(replyText);
  return cursor ? { state: "echo", cursor } : { state: "waiting" };
}
