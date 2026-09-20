/**
 * Node's `navigator` has no Web Locks API, so every authority path that
 * serializes read-modify-write through `navigator.locks.request` fails closed
 * instead. This installs a same-name serializing shim to match the browser.
 */

type LockCallback = (lock: { name: string; mode: "exclusive" }) => unknown;

const queues = new Map<string, Promise<unknown>>();

function request(
  name: string,
  optionsOrCallback: LockCallback | { mode?: string },
  maybeCallback?: LockCallback
): Promise<unknown> {
  const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
  if (typeof callback !== "function") {
    return Promise.reject(new TypeError("lock_callback_required"));
  }
  const run = () => callback({ name, mode: "exclusive" });
  const previous = queues.get(name) ?? Promise.resolve();
  const result = previous.then(run, run);
  queues.set(name, result.then(() => undefined, () => undefined));
  return result;
}

const nav = (globalThis as { navigator?: { locks?: unknown } }).navigator;
if (nav && !nav.locks) {
  Object.defineProperty(nav, "locks", { value: { request }, configurable: true, writable: true });
}
