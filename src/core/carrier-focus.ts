/**
 * Carrier focus planning — Hub "查看对话" V1 (issue #44).
 *
 * Focusing a conversation tab is a projection of the existing Binding-Lease
 * model: the conversation identity is the provider conversation ref (the same
 * bare id `extractProviderConversationId` derives from a carrier URL), while
 * the browser tab is a disposable carrier (`browser-tab:{id}`). Focus is NOT
 * actuation — it sends no input to the page and never drives the provider —
 * so no lease is claimed. Observer tabs opened on a miss are pure observers
 * (duplicate-tab safety) and hold no lease either.
 *
 * Everything here is pure: browser APIs stay in the background runtime.
 */

import { extractProviderConversationId, isSupportedProviderHost, SUPPORTED_PROVIDER_HOSTS } from "../shared/provider-identity";

export const CARRIER_FOCUS_ACK_KIND = "NOOS_FOCUS_REQUEST";

/** URL patterns for enumerating candidate carrier tabs via tabs.query. */
export function carrierTabQueryPatterns(): string[] {
  return SUPPORTED_PROVIDER_HOSTS.map((host) => `https://${host}/*`);
}

export interface CarrierFocusRequest {
  requestId: string;
  conversationRef: string;
  conversationUrl: string;
  enqueuedAt: number;
}

/** Wire shape (snake_case) of one Hub focus request, per the /v1 HTTP conventions of this repo. */
interface CarrierFocusRequestWire {
  request_id?: unknown;
  conversation_ref?: unknown;
  conversation_url?: unknown;
  enqueued_at?: unknown;
}

export interface CarrierTabCandidate {
  tabId: number;
  windowId: number;
  url: string;
  active: boolean;
  lastAccessed: number;
  windowFocused: boolean;
}

export type CarrierFocusPlan =
  | { kind: "already_focused" }
  | { kind: "activate_tab"; tabId: number; windowId: number; focusWindow: boolean }
  | { kind: "open_observer_tab"; url: string };

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Focus requests come only from the local Hub over the paired HTTP bridge,
 * but the payload is still untrusted input: a request that would navigate the
 * browser to a non-provider origin (GitHub etc. must never steer windows) is
 * dropped here, as is any structurally malformed entry.
 */
function parseFocusRequest(value: unknown): CarrierFocusRequest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const wire = value as CarrierFocusRequestWire;
  const requestId = wire.request_id;
  const conversationRef = wire.conversation_ref;
  const conversationUrl = wire.conversation_url;
  const enqueuedAt = wire.enqueued_at;
  if (!isNonEmptyString(requestId) || !isNonEmptyString(conversationRef) ||
    !isNonEmptyString(conversationUrl) || !isFiniteInteger(enqueuedAt)) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(conversationUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || !isSupportedProviderHost(url.hostname)) return undefined;
  return {
    requestId,
    conversationRef,
    conversationUrl,
    enqueuedAt
  };
}

/** Parses the `{ok, requests}` body of GET /v1/focus/requests; invalid entries are skipped. */
export function parseCarrierFocusRequestsPayload(value: unknown): CarrierFocusRequest[] {
  if (!value || typeof value !== "object") return [];
  const requests = (value as { requests?: unknown }).requests;
  if (!Array.isArray(requests)) return [];
  return requests.map(parseFocusRequest).filter((request): request is CarrierFocusRequest => request !== undefined);
}

/**
 * Pure focus decision for one request against the enumerated carrier tabs:
 * match tabs by provider conversation ref, prefer the most recently accessed
 * on multi-hit, and no-op when the target already is the focused front tab.
 */
export function planCarrierFocus(request: CarrierFocusRequest, tabs: CarrierTabCandidate[]): CarrierFocusPlan {
  const matches = tabs
    .filter((tab) => extractProviderConversationId(tab.url) === request.conversationRef)
    .sort((left, right) => (right.lastAccessed - left.lastAccessed) || (left.tabId - right.tabId));
  const target = matches[0];
  if (!target) {
    return { kind: "open_observer_tab", url: request.conversationUrl };
  }
  if (target.active && target.windowFocused) {
    return { kind: "already_focused" };
  }
  return {
    kind: "activate_tab",
    tabId: target.tabId,
    windowId: target.windowId,
    focusWindow: !target.windowFocused
  };
}
