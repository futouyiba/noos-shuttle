import { describe, expect, it } from "vitest";
import { RuntimeObservationLedger, deriveRuntimeState, normalizeObservation } from "../src/content/runtime-observer";

const base = {
  provider: "https://chatgpt.com",
  routeRef: "/c/c1",
  providerConversationRef: "c1",
  composerPresent: true,
  composerInteractive: true,
  stopGenerationControlPresent: false,
  assistantOutputMutating: false,
  providerErrorSurfacePresent: false,
  routeStable: true
};

describe("runtime observation", () => {
  it("requires multiple quiet signals before READY", () => {
    expect(deriveRuntimeState(base)).toBe("STABILIZING");
    expect(deriveRuntimeState(base, "STABILIZING")).toBe("READY");
    expect(deriveRuntimeState({ ...base, stopGenerationControlPresent: true }, "READY")).toBe("GENERATING");
  });

  it("normalizes missing identity and detects route/conversation changes", () => {
    const first = normalizeObservation(base, undefined, 10);
    const unresolved = normalizeObservation({ ...base, providerConversationRef: "" }, first, 20);
    expect(unresolved.conversationIdentityState).toBe("unresolved");
    expect(unresolved.state).toBe("ATTACHING");
    const second = normalizeObservation({ ...base, routeRef: "/c/c2", providerConversationRef: "c2" }, unresolved, 30);
    expect(second.carrierRef).toBe(first.carrierRef);
    expect(second.sourceEpoch).toBe(first.sourceEpoch + 2);
  });

  it("represents duplicate carriers by distinct ledgers with the same conversation", () => {
    const a = new RuntimeObservationLedger();
    const b = new RuntimeObservationLedger();
    const aObs = a.observe(base, 1);
    const bObs = b.observe(base, 1);
    expect(aObs.providerConversationRef).toBe(bObs.providerConversationRef);
    expect(aObs.carrierRef).not.toBe(bObs.carrierRef);
  });

  it("rejects stale source epochs after navigation and reconstructs after restart", () => {
    const ledger = new RuntimeObservationLedger();
    const first = ledger.observe(base, 1);
    const next = ledger.observe({ ...base, routeRef: "/c/c2", providerConversationRef: "c2" }, 2);
    expect(ledger.acceptEvent(first)).toBe(false);
    expect(ledger.acceptEvent(next)).toBe(true);
    const restarted = new RuntimeObservationLedger();
    const recovered = restarted.observe({ ...base, routeRef: "/c/c2", providerConversationRef: "c2" }, 3);
    expect(recovered.conversationIdentityState).toBe("resolved");
    expect(recovered.state).toBe("STABILIZING");
  });

  it("fails safe on provider errors and contradictory signals", () => {
    expect(deriveRuntimeState({ ...base, providerErrorSurfacePresent: true })).toBe("BROKEN");
    expect(deriveRuntimeState({ ...base, composerInteractive: false }, "READY")).toBe("STABILIZING");
    expect(deriveRuntimeState({ ...base, routeStable: false }, "READY")).toBe("ATTACHING");
  });
});
