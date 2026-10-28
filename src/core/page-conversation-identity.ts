/**
 * Durable provider-conversation identity for page context (issue #133).
 *
 * The page context signature also carries the route shape (`normalizedPathname`).
 * ChatGPT migrates a conversation between routes — `/c/<id>` ↔
 * `/g/<project>/c/<id>`, temporary ids becoming provider ids — without changing
 * the provider conversation. Treating that route move as a conversation change
 * ended the pinned continuation run and told the Human the conversation had
 * changed when it had not.
 *
 * The run's pinned identity is the provider conversation plus its logical
 * thread; the route a carrier is currently rendering is carrier-level. This
 * module states that narrower comparison so the caller can rebind a carrier
 * without ending the run, while a changed or unreadable conversation identity
 * still fails closed.
 */

export interface ProviderPageIdentity {
  /** Provider origin; a same id under another host is another provider. */
  origin: string;
  /** Provider conversation id from the route; empty means "not resolved". */
  conversationId: string;
  /** Page class from the route (e.g. `conversation`, `login`, `unsupported`). */
  pageKind: string;
}

/**
 * True only when both pages are the same, resolved conversation of the same
 * provider. An empty or non-conversation identity is never "the same": the run
 * may not cross an identity it cannot prove, and it must not continue on an
 * unknown one.
 */
export function isSameProviderConversation(previous: ProviderPageIdentity, next: ProviderPageIdentity): boolean {
  return previous.pageKind === "conversation" &&
    next.pageKind === "conversation" &&
    previous.origin === next.origin &&
    previous.conversationId !== "" &&
    previous.conversationId === next.conversationId;
}
