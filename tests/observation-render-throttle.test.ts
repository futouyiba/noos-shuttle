import { describe, expect, it } from "vitest";
import { createRenderThrottle } from "../src/content/observation-render-throttle";

/**
 * Issue #126's deliverable 2: the observation loop's repaints must never reach
 * the panel at token rate. The bound is by construction — leading edge
 * immediate, trailing requests coalesced into one per window — and these cases
 * pin it with a controlled clock.
 */

function fakeClock() {
  let now = 0;
  let sequence = 0;
  const pending = new Map<number, { handler: () => void; at: number }>();
  return {
    now: () => now,
    setTimeout: (handler: () => void, timeout: number) => {
      sequence += 1;
      pending.set(sequence, { handler, at: now + timeout });
      return sequence;
    },
    clearTimeout: (handle: unknown) => {
      pending.delete(handle as number);
    },
    advance: (ms: number) => {
      const target = now + ms;
      for (;;) {
        const due = Array.from(pending.entries()).filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].handler();
      }
      now = target;
    }
  };
}

function harness(minIntervalMs = 200) {
  const clock = fakeClock();
  let renders = 0;
  const throttle = createRenderThrottle(() => { renders += 1; }, {
    minIntervalMs,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  return { clock, throttle, renders: () => renders };
}

describe("createRenderThrottle (issue #126)", () => {
  it("renders the first request immediately — a waited-for transition is not delayed", () => {
    const h = harness();
    h.throttle.request();
    expect(h.renders()).toBe(1);
  });

  it("bounds token-rate requests to one render per window, plus one trailing", () => {
    const h = harness(200);
    h.throttle.request(); // leading, immediate
    // Simulate a token every 30 ms for a full second — 33 requests.
    for (let tick = 0; tick < 33; tick += 1) {
      h.clock.advance(30);
      h.throttle.request();
    }
    // In-flight trailing renders execute as their windows elapse; the loop's
    // 1010 ms of advances have flushed everything scheduled at/before them.
    expect(h.renders()).toBeLessThanOrEqual(7); // 1 leading + ≤6 windows in ~1s
    // And it is not starved either: coalescing still repaints regularly.
    expect(h.renders()).toBeGreaterThanOrEqual(4);
  });

  it("collapses a burst inside one window into a single trailing render", () => {
    const h = harness(200);
    h.throttle.request();
    const before = h.renders();
    for (let i = 0; i < 10; i += 1) h.throttle.request();
    expect(h.renders()).toBe(before); // nothing until the window closes
    h.clock.advance(250);
    expect(h.renders()).toBe(before + 1); // exactly one, not ten
  });

  it("recovers full rate once the caller goes quiet (no permanent backoff)", () => {
    const h = harness(200);
    h.throttle.request();
    h.clock.advance(1_000);
    h.throttle.request();
    expect(h.renders()).toBe(2);
  });

  it("flush() renders a pending coalesced request immediately", () => {
    const h = harness(200);
    h.throttle.request();
    h.throttle.request();
    expect(h.renders()).toBe(1);
    h.throttle.flush();
    expect(h.renders()).toBe(2);
    // And the flushed timer must not fire twice later.
    h.clock.advance(500);
    expect(h.renders()).toBe(2);
  });
});
