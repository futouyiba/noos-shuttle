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
  it("invalidates READY when a route or generation signal changes in the same millisecond", () => {
    const ledger = new RuntimeObservationLedger();
    ledger.observe(base, 1);
    expect(ledger.observe(base, 2001).state).toBe("READY");
    expect(ledger.observe({ ...base, stopGenerationControlPresent: true }, 2001).state).toBe("GENERATING");
    expect(ledger.observe({ ...base, routeRef: "/c/c2", providerConversationRef: "c2" }, 2001))
      .toMatchObject({ state: "STABILIZING", providerConversationRef: "c2", sourceEpoch: 1 });
    expect(ledger.observe(base, 2000).providerConversationRef).toBe("c2");
  });
  it("records identity provenance and distinguishes a failed handshake from a confirmed tab", () => {
    const ledger = new RuntimeObservationLedger();
    expect(ledger.observe(base, 1)).toMatchObject({
      carrierIdentityState: "execution-local", conversationIdentitySource: "provider-route"
    });
    ledger.attachCarrier("browser-tab:21");
    expect(ledger.observe(base, 2).carrierIdentityState).toBe("browser-tab");
    expect(ledger.observe({ ...base, providerConversationRef: undefined }, 3)).toMatchObject({
      conversationIdentityState: "unresolved", conversationIdentitySource: "unavailable"
    });
  });

  it.each([{ providerConversationRef: 42 }, { provider: "" }, { routeRef: undefined }])(
    "does not crash or become READY with malformed identity probes: %j", invalid => {
      const ledger = new RuntimeObservationLedger();
      const probe = { ...base, ...invalid } as unknown as typeof base;
      expect(ledger.observe(probe, 1).state).toBe("RECOVERING");
      expect(ledger.observe(probe, 5001).state).toBe("RECOVERING");
    }
  );

  it("waits for repeated error observations and separates reload instances on one carrier", () => {
    const a = new RuntimeObservationLedger();
    a.attachCarrier("browser-tab:12");
    const before = a.observe(base, 1);
    const b = new RuntimeObservationLedger();
    b.attachCarrier("browser-tab:12");
    const after = b.observe(base, 2);
    expect(after.carrierRef).toBe(before.carrierRef);
    expect(after.executionInstanceRef).not.toBe(before.executionInstanceRef);
    expect(b.acceptEvent(before)).toBe(false);
    const error = { ...base, providerErrorSurfacePresent: true };
    expect(b.observe(error, 3).state).toBe("RECOVERING");
    expect(b.observe(error, 15003).state).toBe("BROKEN");
    expect(b.observe(base, 15004).state).toBe("STABILIZING");
  });
  it("cannot carry READY into another route or promote duplicate samples", () => {
    const ledger = new RuntimeObservationLedger();
    ledger.observe(base, 1);
    expect(ledger.observe(base, 2001).state).toBe("READY");
    const changed = { ...base, routeRef: "/c/c2", providerConversationRef: "c2" };
    expect(ledger.observe(changed, 2002).state).toBe("STABILIZING");
    expect(ledger.observe(changed, 2002).state).toBe("STABILIZING");
    expect(ledger.observe(changed, 4002).state).toBe("READY");
    expect(ledger.observe(base, 1000).providerConversationRef).toBe("c2");
  });

  it("preserves suspension until explicit resume and observes unidentified generation", () => {
    const ledger = new RuntimeObservationLedger();
    ledger.observe(base, 1);
    ledger.suspend(2);
    expect(ledger.observe(base, 10000).state).toBe("SUSPENDED");
    ledger.resume();
    expect(ledger.observe(base, 10001).state).toBe("STABILIZING");
    expect(ledger.observe({ ...base, providerConversationRef: undefined, stopGenerationControlPresent: true }, 10002).state).toBe("GENERATING");
  });

  it("does not interpret missing booleans as negative generation evidence", () => {
    const ledger = new RuntimeObservationLedger();
    const malformed = { ...base, stopGenerationControlPresent: undefined } as unknown as typeof base;
    ledger.observe(malformed, 1);
    expect(ledger.observe(malformed, 5000).state).toBe("RECOVERING");
  });
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
