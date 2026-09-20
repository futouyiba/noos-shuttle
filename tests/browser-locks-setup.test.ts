import { describe, expect, it } from "vitest";

type LockManager = { request: (name: string, a: unknown, b?: unknown) => Promise<unknown> };

const locks = (globalThis as unknown as { navigator: { locks: LockManager } }).navigator.locks;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("navigator.locks test shim", () => {
  it("runs same-name requests one at a time, in order", async () => {
    const order: string[] = [];
    const gate = deferred<void>();
    const first = locks.request("serialize", { mode: "exclusive" }, async () => {
      order.push("first:in");
      await gate.promise;
      order.push("first:out");
      return "first";
    });
    const second = locks.request("serialize", { mode: "exclusive" }, async () => {
      order.push("second:in");
      return "second";
    });
    await flush();
    expect(order).toEqual(["first:in"]);
    gate.resolve();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(order).toEqual(["first:in", "first:out", "second:in"]);
  });

  it("does not serialize different lock names", async () => {
    const order: string[] = [];
    const gate = deferred<void>();
    const held = locks.request("name-a", { mode: "exclusive" }, async () => {
      order.push("a:in");
      await gate.promise;
      return "a";
    });
    const other = locks.request("name-b", { mode: "exclusive" }, async () => {
      order.push("b:in");
      return "b";
    });
    await expect(other).resolves.toBe("b");
    expect(order).toEqual(["a:in", "b:in"]);
    gate.resolve();
    await expect(held).resolves.toBe("a");
  });

  it("supports the two-argument form and propagates the callback result", async () => {
    await expect(locks.request("two-arg", async () => 42)).resolves.toBe(42);
  });

  it("keeps the queue moving when a holder throws", async () => {
    const boom = locks.request("throwing", { mode: "exclusive" }, async () => {
      throw new Error("boom");
    });
    await expect(boom).rejects.toThrow("boom");
    await expect(locks.request("throwing", { mode: "exclusive" }, async () => "recovered")).resolves.toBe("recovered");
  });
});
