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
  executionInstanceRef: string;
  conversationIdentityState: "resolved" | "unresolved";
  conversationIdentitySource: "provider-route" | "unavailable";
  carrierIdentityState: "execution-local" | "browser-tab";
  state: RuntimeState;
  observedAt: number;
  sourceEpoch: number;
  quietSince: number | null;
  errorSince: number | null;
}

export const OBSERVATION_QUIET_MS = 2_000;

export function normalizeObservation(input: RuntimeProbeSnapshot, previous?: CarrierObservation, now = Date.now()): CarrierObservation {
  const providerConversationRef = typeof input.providerConversationRef === "string" ? input.providerConversationRef.trim() || undefined : undefined;
  const carrierRef = previous?.carrierRef ?? `carrier-${randomToken()}`;
  const sourceEpoch = previous && (previous.provider !== input.provider || previous.routeRef !== input.routeRef || previous.providerConversationRef !== providerConversationRef)
    ? previous.sourceEpoch + 1
    : previous?.sourceEpoch ?? 0;
  const probesValid = typeof input.provider === "string" && Boolean(input.provider.trim()) &&
    typeof input.routeRef === "string" && input.routeRef.startsWith("/") &&
    (input.providerConversationRef == null || typeof input.providerConversationRef === "string") &&
    [input.composerPresent, input.composerInteractive, input.stopGenerationControlPresent,
    input.assistantOutputMutating, input.providerErrorSurfacePresent, input.routeStable].every(value => typeof value === "boolean");
  const quiet = probesValid && input.composerPresent && input.composerInteractive && input.routeStable &&
    Boolean(providerConversationRef) && !input.stopGenerationControlPresent && !input.assistantOutputMutating && !input.providerErrorSurfacePresent;
  const quietSince = quiet ? (sourceEpoch === previous?.sourceEpoch ? previous.quietSince ?? now : now) : null;
  const errorSince = input.providerErrorSurfacePresent ? (sourceEpoch === previous?.sourceEpoch ? previous.errorSince ?? now : now) : null;
  const state = !probesValid || (errorSince !== null && now - errorSince < 15_000) ? "RECOVERING" : deriveRuntimeState({ ...input, providerConversationRef },
    quietSince !== null && now - quietSince >= OBSERVATION_QUIET_MS ? "STABILIZING" : undefined);
  return {
    ...input,
    providerConversationRef,
    carrierRef,
    executionInstanceRef: previous?.executionInstanceRef ?? `observer-${randomToken()}`,
    conversationIdentityState: providerConversationRef ? "resolved" : "unresolved",
    conversationIdentitySource: providerConversationRef ? "provider-route" : "unavailable",
    carrierIdentityState: previous?.carrierIdentityState ?? "execution-local",
    state,
    observedAt: now,
    sourceEpoch,
    quietSince,
    errorSince
  };
}

export function deriveRuntimeState(probe: RuntimeProbeSnapshot, previous?: RuntimeState): RuntimeState {
  if (probe.providerErrorSurfacePresent) return "BROKEN";
  if (probe.stopGenerationControlPresent || probe.assistantOutputMutating) return "GENERATING";
  if (!probe.routeStable || !probe.providerConversationRef) return previous === "SUSPENDED" ? "RECOVERING" : "ATTACHING";
  if (!probe.composerPresent || !probe.composerInteractive) return "STABILIZING";
  // normalizeObservation supplies STABILIZING only after the timed quiet window.
  return previous === "STABILIZING" || previous === "READY" ? "READY" : "STABILIZING";
}

export class RuntimeObservationLedger {
  private current: CarrierObservation | null = null;
  private suspended = false;
  private carrierRef: string | undefined;

  attachCarrier(carrierRef: string): void {
    this.carrierRef = carrierRef;
    if (this.current) this.current = { ...this.current, carrierRef, carrierIdentityState: "browser-tab" };
  }

  observe(input: RuntimeProbeSnapshot, now = Date.now()): CarrierObservation {
    // Multiple synchronous DOM callbacks can share a millisecond. They cannot
    // advance quiet time, but must still invalidate READY on changed evidence.
    if (this.current && (this.suspended || now < this.current.observedAt)) return this.current;
    this.current = normalizeObservation(input, this.current ?? undefined, now);
    if (this.carrierRef) this.current = { ...this.current, carrierRef: this.carrierRef, carrierIdentityState: "browser-tab" };
    return this.current;
  }

  suspend(now = Date.now()): CarrierObservation | null {
    this.suspended = true;
    if (!this.current) return null;
    this.current = { ...this.current, state: "SUSPENDED", observedAt: now, quietSince: null };
    return this.current;
  }

  resume(): void {
    this.suspended = false;
    if (this.current) this.current = { ...this.current, state: "RECOVERING", quietSince: null };
  }

  acceptEvent(event: Pick<CarrierObservation, "carrierRef" | "executionInstanceRef" | "sourceEpoch">): boolean {
    return Boolean(this.current && event.carrierRef === this.current.carrierRef &&
      event.executionInstanceRef === this.current.executionInstanceRef && event.sourceEpoch === this.current.sourceEpoch);
  }

  get value(): CarrierObservation | null { return this.current; }
}

function randomToken(): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
