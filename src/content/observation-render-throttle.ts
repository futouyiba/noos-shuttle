/**
 * Coalesce panel renders requested by the session-observation loop
 * (issue #126, deliverable 2).
 *
 * During streaming generation the observation loop reacts to provider-output
 * mutations. Whatever it decides to repaint must not reach the panel at token
 * rate: a full-DOM rebuild per burst is what made a generating tab impossible
 * to type into, and even with `panel-input-preservation` restoring the text,
 * five rebuilds a second is five focus() round-trips the Human feels.
 *
 * Leading edge immediate, trailing edge coalesced: the first request after a
 * quiet period renders at once (a state transition the user is waiting for is
 * never delayed by a full window), and any further requests inside the window
 * collapse into one trailing render scheduled for the window's end. The bound
 * is therefore minIntervalMs by construction — with 200 ms, at most 5 renders
 * per second however often `request()` is called.
 *
 * User-action renders are NOT routed through this: a click that changes
 * viewState must repaint immediately, and it is not the observation loop.
 */

export interface RenderThrottleOptions {
  /** Minimum spacing between actual renders. Issue #126 sets 200. */
  readonly minIntervalMs: number;
  readonly now: () => number;
  readonly setTimeout: (handler: () => void, timeout: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface RenderThrottle {
  /** Ask for a render; it may happen now, coalesced, or on flush. */
  request(): void;
  /** Render immediately if a coalesced one is pending (tests, teardown). */
  flush(): void;
}

export function createRenderThrottle(render: () => void, options: RenderThrottleOptions): RenderThrottle {
  let lastRenderAt = -Infinity;
  let trailingHandle: unknown = null;

  const renderNow = () => {
    lastRenderAt = options.now();
    render();
  };

  return {
    request() {
      if (trailingHandle !== null) return;
      const elapsed = options.now() - lastRenderAt;
      if (elapsed >= options.minIntervalMs) {
        renderNow();
        return;
      }
      trailingHandle = options.setTimeout(() => {
        trailingHandle = null;
        renderNow();
      }, options.minIntervalMs - elapsed);
    },
    flush() {
      if (trailingHandle === null) return;
      options.clearTimeout(trailingHandle);
      trailingHandle = null;
      renderNow();
    }
  };
}
