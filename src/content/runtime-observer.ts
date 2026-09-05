/**
 * Slice 0 browser-runtime observation primitives.
 * Provider DOM selectors stay in the adapter (index/chatgpt-dom); this module
 * only normalizes probes and applies the conservative operational state rules.
 */
export type RuntimeState = "ATTACHING" | "READY" | "GENERATING" | "STABILIZING" | "SUSPENDED" | "RECOVERING" | "BROKEN";

export interface RuntimeProbeSnapshot {
  provider: string;
  routeRef: string;
  providerConversationRef?: string;
  composerPresent: boolean;
  composerInteractive: boolean;
  stopGenerationControlPresent: boolean;
  assistantOutputMutating: boolean;
  assistantMessageCount?: number;
  userMessageCount?: number;
  providerErrorSurfacePresent: boolean;
  routeStable: boolean;
  observedAt?: number;
}

export interface CarrierObservation extends RuntimeProbeSnapshot {
  carrierRef: string;
  conversationIdentityState: "resolved" | "unresolved";
  state: RuntimeState;
  observedAt: number;
  sourceEpoch: number;
}

export function normalizeObservation(input: RuntimeProbeSnapshot, previous?: CarrierObservation, now = Date.now()): CarrierObservation {
  const providerConversationRef = input.providerConversationRef?.trim() || undefined;
  const carrierRef = previous?.carrierRef ?? `carrier-${randomToken()}`;
  const sourceEpoch = previous && (previous.routeRef !== input.routeRef || previous.providerConversationRef !== providerConversationRef)
    ? previous.sourceEpoch + 1
    : previous?.sourceEpoch ?? 0;
  const state = deriveRuntimeState({ ...input, providerConversationRef }, previous?.state);
  return {
    ...input,
    providerConversationRef,
    carrierRef,
    conversationIdentityState: providerConversationRef ? "resolved" : "unresolved",
    state,
    observedAt: input.observedAt ?? now,
    sourceEpoch
  };
}

export function deriveRuntimeState(probe: RuntimeProbeSnapshot, previous?: RuntimeState): RuntimeState {
  if (probe.providerErrorSurfacePresent) return "BROKEN";
  if (!probe.routeStable || !probe.providerConversationRef) return previous === "SUSPENDED" ? "RECOVERING" : "ATTACHING";
  if (probe.stopGenerationControlPresent || probe.assistantOutputMutating) return "GENERATING";
  if (!probe.composerPresent || !probe.composerInteractive) return "STABILIZING";
  // A quiet observation is required before READY. The first quiet sample is
  // deliberately STABILIZING; callers promote only after a subsequent sample.
  return previous === "STABILIZING" || previous === "READY" ? "READY" : "STABILIZING";
}

export class RuntimeObservationLedger {
  private current: CarrierObservation | null = null;

  observe(input: RuntimeProbeSnapshot, now = Date.now()): CarrierObservation {
    this.current = normalizeObservation(input, this.current ?? undefined, now);
    return this.current;
  }

  suspend(now = Date.now()): CarrierObservation | null {
    if (!this.current) return null;
    this.current = { ...this.current, state: "SUSPENDED", observedAt: now };
    return this.current;
  }

  acceptEvent(event: Pick<CarrierObservation, "carrierRef" | "sourceEpoch">): boolean {
    return Boolean(this.current && event.carrierRef === this.current.carrierRef && event.sourceEpoch === this.current.sourceEpoch);
  }

  get value(): CarrierObservation | null { return this.current; }
}

function randomToken(): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
