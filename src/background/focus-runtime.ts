/**
 * Carrier focus runtime — Hub "查看对话" V1 (issue #44).
 *
 * The background polls the local Hub (paired HTTP bridge on
 * 127.0.0.1:17642) for focus requests and executes the plan from
 * src/core/carrier-focus.ts: activate the matching carrier tab, focus its
 * window, or open an observer tab on a miss. Re-execution is idempotent —
 * an already-open observer tab matches on the next poll, so a lost ack only
 * converges, never duplicates tabs.
 *
 * MV3 lifetime: a short setInterval drives second-level latency while the
 * service worker is alive; a 30s chrome.alarms timer is the wake-up floor
 * after the worker is reclaimed.
 */

import {
  carrierTabQueryPatterns,
  parseCarrierFocusRequestsPayload,
  planCarrierFocus,
  type CarrierFocusRequest,
  type CarrierTabCandidate
} from "../core/carrier-focus";

export const HUB_FOCUS_REQUESTS_URL = "http://127.0.0.1:17642/v1/focus/requests";
export const HUB_FOCUS_ACK_URL = "http://127.0.0.1:17642/v1/focus/ack";
export const CARRIER_FOCUS_ALARM = "noos-carrier-focus-poll";
export const CARRIER_FOCUS_ALARM_PERIOD_MINUTES = 0.5;
export const CARRIER_FOCUS_POLL_INTERVAL_MS = 5_000;

export interface CarrierFocusRuntimeDeps {
  fetchRequests(): Promise<unknown>;
  postAck(requestId: string): Promise<unknown>;
  queryTabs(): Promise<CarrierTabCandidate[]>;
  activateTab(tabId: number): Promise<void>;
  focusWindow(windowId: number): Promise<void>;
  openObserverTab(url: string): Promise<void>;
}

export interface CarrierFocusRunSummary {
  processed: number;
  acked: number;
}

/** Handles every pending request from one poll; a failing ack only logs — the Hub re-serves the request. */
export async function processCarrierFocusRequests(deps: CarrierFocusRuntimeDeps): Promise<CarrierFocusRunSummary> {
  const requests: CarrierFocusRequest[] = parseCarrierFocusRequestsPayload(await deps.fetchRequests());
  if (requests.length === 0) {
    return { processed: 0, acked: 0 };
  }

  const tabs = await deps.queryTabs();
  let acked = 0;
  for (const request of requests) {
    const plan = planCarrierFocus(request, tabs);
    try {
      if (plan.kind === "activate_tab") {
        await deps.activateTab(plan.tabId);
        if (plan.focusWindow) {
          await deps.focusWindow(plan.windowId);
        }
      } else if (plan.kind === "open_observer_tab") {
        await deps.openObserverTab(plan.url);
      }
    } catch (error) {
      console.warn("NOOS carrier focus execution failed for request", request.requestId, error);
      continue;
    }

    try {
      await deps.postAck(request.requestId);
      acked += 1;
    } catch (error) {
      console.warn("NOOS carrier focus ack failed for request", request.requestId, error);
    }
  }
  return { processed: requests.length, acked };
}

/**
 * Wires polling to the service-worker lifetime: an immediate tick plus a
 * 5s interval while alive, and the 30s alarm as the MV3 wake-up floor.
 * The returned ticker shares the in-flight guard with the interval, so the
 * alarm handler can reuse it without racing a live poll; this module stays
 * free of direct chrome access for testability.
 */
export function startCarrierFocusPolling(deps: CarrierFocusRuntimeDeps): () => void {
  let inFlight = false;
  const tick = () => {
    if (inFlight) return;
    inFlight = true;
    processCarrierFocusRequests(deps)
      .catch((error) => console.debug("NOOS carrier focus poll skipped:", error))
      .finally(() => {
        inFlight = false;
      });
  };

  setInterval(tick, CARRIER_FOCUS_POLL_INTERVAL_MS);
  tick();
  return tick;
}

export { carrierTabQueryPatterns };
