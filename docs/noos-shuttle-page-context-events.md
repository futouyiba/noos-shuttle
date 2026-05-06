# NOOS Shuttle Page Context Events

NOOS Shuttle runs inside long-lived chatbot tabs. Those tabs can change conversation, refresh, restore from browser history, move between supported and unsupported hosts, or enter an account/login state without a full page reload. The extension therefore treats the current page as a changing context, not as a static document.

## Goals

- Detect when the visible chatbot context is no longer the same handoff source.
- Cancel stale `Generate & Collect` waits when the page is unloaded or replaced.
- Reset captured handoff state when the user switches to another conversation.
- Keep a backgrounded tab stable; switching away from the tab must not cancel a valid generation wait.
- Avoid assuming that ChatGPT is the only supported surface.

## Page Context Model

The content script builds a `PageContext` snapshot:

```ts
type PageKind = "conversation" | "composer" | "login" | "unavailable" | "unsupported" | "unknown";

interface PageContext {
  href: string;
  origin: string;
  pathname: string;
  conversationId: string;
  pageKind: PageKind;
  textFingerprint: string;
  signature: string;
}
```

The `signature` is the part used for reset decisions. It includes:

- Origin
- Normalized path
- Conversation id, when one can be detected
- Page kind

Query strings and hash fragments are intentionally ignored for reset decisions because chatbot pages often use them for UI state that does not represent a different conversation.

## Page Kinds

- `conversation`: a supported chatbot page with a detected conversation id.
- `composer`: a supported chatbot page with a visible text composer but no conversation id yet.
- `login`: a supported chatbot host showing login, auth, OAuth, sign-in, or registration state.
- `unavailable`: a supported chatbot host showing not-found, unable-to-load, or permission text.
- `unsupported`: a page outside the supported chatbot host list.
- `unknown`: a supported chatbot host that does not currently match the known conversation, composer, login, or unavailable states.

## Watched Events

The extension watches several event families because modern chatbot apps often change state without a full reload:

- `history.pushState` and `history.replaceState`: SPA route changes.
- `popstate` and `hashchange`: browser back/forward and hash navigation.
- `focus`: user returns to a tab after changing windows or accounts elsewhere.
- `pageshow`: restored pages, including browser back-forward cache.
- `visibilitychange`: when the tab becomes visible again, re-check context.
- `pagehide`: page unload, refresh, navigation away, or back-forward cache transition; active generation waits are cancelled.
- A 1 second context polling fallback: catches route, account, or DOM state changes missed by browser events.

The extension also uses generation-specific observation while `Generate & Collect` is waiting:

- `MutationObserver`: watches chatbot DOM changes during generation.
- `isChatbotGenerating()`: detects active generation markers.
- A 1.5 second capture poll: catches completed handoffs even if the page does not emit a clean DOM mutation at the right moment.
- A 120 second wait timeout: prevents a stuck wait from living forever.

## Reset Behavior

When the page context signature changes, NOOS Shuttle:

1. Cancels the active generation/capture wait.
2. Closes the popover and settings panel.
3. Resets state to `idle`.
4. Clears captured thread candidates and the selected index.
5. Closes any choice, warning, or success modal.
6. Shows the localized `conversationChanged` message.

This reset is intentionally conservative. A handoff collected from one conversation should not remain selected after the user moves to a different conversation, account state, or chatbot host.

## Scenario Handling

| Scenario | Detection | Behavior |
| --- | --- | --- |
| ChatGPT conversation switch | `pushState`, `replaceState`, `popstate`, or polling sees a new conversation id | Reset panel state and cancel stale waits |
| Page refresh | `pagehide` cancels the active wait; new content script starts clean after reload | No old wait survives reload |
| Tab backgrounded | No cancellation on hidden state | Generation wait may continue; context is checked when visible again |
| Tab restored from history | `pageshow` triggers context check | Reset only if signature changed |
| Unsupported website | Host becomes `unsupported` | Reset captured state |
| User logs out or switches auth state | Page kind becomes `login`, `unavailable`, or `unknown` | Reset captured state |
| Conversation no longer accessible | Text match marks `unavailable` | Reset captured state |

## Current Limits

- Account identity is inferred from page state; the extension does not yet read a stable account id from chatbot providers.
- Conversation id patterns are heuristic and provider-specific. ChatGPT is strongest; other chatbot surfaces may need additional route patterns.
- Local NOOS Vault write status is still routed through browser download APIs. The planned Hub local write channel should provide stronger success/failure reporting.
- If a chatbot changes visible conversation content without URL, route, or detectable page-kind changes, the 1 second poll can still miss semantic-only changes. Provider-specific selectors can improve this later.

## Implementation Location

The page context guard lives in:

```text
src/content/index.ts
```

The core functions are:

- `installConversationWatcher`
- `checkPageContext`
- `resetForConversationChange`
- `getPageContext`
- `detectConversationId`
- `detectPageKind`
