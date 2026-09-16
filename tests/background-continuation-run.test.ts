import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContinuationRunMutation } from "../src/core/continuation-run";

afterEach(() => vi.unstubAllGlobals());

const START_INPUT = {
  runId: "bcr-bg-1",
  workItemId: "shuttle-bcr-run",
  logicalThreadId: "thread:conv-a",
  providerConversationRef: "conv-a",
  bindingEpoch: 3,
  maxContinuations: 5,
  now: 100
};

function providerSender() {
  return { frameId: 0, tab: { id: 11 }, id: "extension-id", url: "https://chatgpt.com/c/conv-a" };
}

async function loadHandler(backing: Record<string, unknown> = {}) {
  vi.resetModules();
  const addListener = vi.fn();
  vi.stubGlobal("chrome", {
    runtime: { id: "extension-id", onInstalled: { addListener: vi.fn() }, onMessage: { addListener } },
    storage: { local: {
      get: async (key: string) => ({ [key]: backing[key] }),
      set: async (value: Record<string, unknown>) => Object.assign(backing, value)
    } }
  });
  await import("../src/background/service-worker");
  return { handler: addListener.mock.calls[0][0] as MessageHandler, backing };
}

type MessageHandler = (message: unknown, sender: unknown, reply: (value: unknown) => void) => void;

interface RunReply {
  ok: boolean;
  run?: { runId: string; status: string; phase: string; consumedContinuations: number; stopReason?: string; lastConsumedTurnRef?: string };
  error?: string;
}

function send(handler: MessageHandler, mutation: object): Promise<RunReply> {
  return new Promise(resolve => {
    handler({ type: "NOOS_CONTINUATION_RUN_MUTATION", mutation }, providerSender(), value => resolve(value as RunReply));
  });
}

describe("background continuation run coordinator", () => {
  it("persists a durable active run and survives a service-worker restart", async () => {
    const backing: Record<string, unknown> = {};
    const first = await loadHandler(backing);
    const started = await send(first.handler, { type: "start", input: START_INPUT });
    expect(started.ok).toBe(true);
    expect(started.run?.status).toBe("ACTIVE");
    expect(started.run?.phase).toBe("READY_TO_GO");
    expect(backing.noosContinuationRunStore).toBeDefined();

    const restarted = await loadHandler(backing);
    const fetched = await send(restarted.handler, { type: "get_active", providerConversationRef: "conv-a" });
    expect(fetched.ok).toBe(true);
    expect(fetched.run?.runId).toBe("bcr-bg-1");
  });

  it("drives a round through durable state: dispatch, acceptance, completion, human continue", async () => {
    const { handler } = await loadHandler();
    const send_ = send.bind(null, handler);
    await send_({ type: "start", input: START_INPUT });
    await send_({ type: "apply", runId: "bcr-bg-1", event: { type: "DISPATCH_ISSUED", operationId: "bcr-bg-1:go:1" }, now: 101 });
    const generating = await send_({ type: "get_active", providerConversationRef: "conv-a" });
    expect(generating.run?.phase).toBe("ASSISTANT_GENERATING");
    await send_({ type: "apply", runId: "bcr-bg-1", event: { type: "OPERATION_ACCEPTED", operationId: "bcr-bg-1:go:1", turnRef: "turn:t1" }, now: 102 });
    const completed = await send_({ type: "apply", runId: "bcr-bg-1", event: { type: "OPERATION_COMPLETED", operationId: "bcr-bg-1:go:1", turnRef: "turn:t1" }, now: 103 });
    expect(completed.run?.phase).toBe("AWAITING_HUMAN_DECISION");
    expect(completed.run?.consumedContinuations).toBe(1);
    const continued = await send_({ type: "apply", runId: "bcr-bg-1", event: { type: "HUMAN_CONTINUE" }, now: 104 });
    expect(continued.run?.phase).toBe("READY_TO_GO");
    const active = await send_({ type: "get_active", providerConversationRef: "conv-a" });
    expect(active.run?.lastConsumedTurnRef).toBe("turn:t1");
  });

  it("archives an intervened run and keeps the candidate pool durable", async () => {
    const { handler } = await loadHandler();
    const send_ = send.bind(null, handler);
    await send_({ type: "start", input: START_INPUT });
    await send_({ type: "apply", runId: "bcr-bg-1", event: { type: "DISPATCH_ISSUED", operationId: "bcr-bg-1:go:1" }, now: 101 });
    const intervened = await send_({ type: "apply", runId: "bcr-bg-1", event: { type: "USER_INTERVENTION" }, now: 102 });
    expect(intervened.run?.status).toBe("CANCELLED");
    expect(intervened.run?.stopReason).toBe("USER_INTERVENTION");
    const none = await send_({ type: "get_active", providerConversationRef: "conv-a" });
    expect(none.ok).toBe(true);
    expect(none.run).toBeUndefined();
    const candidate = { candidateId: "bcr-bg-1:1", runId: "bcr-bg-1", continuationIndex: 1, providerConversationRef: "conv-a", decision: "RUN_ABORTED", humanAction: "intervened", stopReason: "USER_INTERVENTION", capturedAt: 103 };
    const attached = await send_({ type: "attach_candidate", candidate });
    expect(attached.ok).toBe(true);
    const replayed = await send_({ type: "attach_candidate", candidate: { ...candidate, capturedAt: 104 } });
    expect(replayed.ok).toBe(true);
  });

  it("rejects oversize budgets, duplicate runs, and non-provider senders", async () => {
    const { handler } = await loadHandler();
    const send_ = send.bind(null, handler);
    const gated = await send_({ type: "start", input: { ...START_INPUT, maxContinuations: 20 } });
    expect(gated.ok).toBe(false);
    expect(gated.error).toMatch(/experimental cap/);
    await send_({ type: "start", input: START_INPUT });
    const duplicate = await send_({ type: "start", input: { ...START_INPUT, runId: "bcr-bg-2" } });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error).toMatch(/already exists/);

    const subframe = await new Promise<RunReply>(resolve => {
      handler(
        { type: "NOOS_CONTINUATION_RUN_MUTATION", mutation: { type: "start", input: START_INPUT } },
        { frameId: 1, tab: { id: 11 }, url: "https://chatgpt.com/c/conv-a" },
        value => resolve(value as RunReply)
      );
    });
    expect(subframe.ok).toBe(false);

    const foreign = await new Promise<RunReply>(resolve => {
      handler(
        { type: "NOOS_CONTINUATION_RUN_MUTATION", mutation: { type: "start", input: START_INPUT } },
        { frameId: 0, tab: { id: 11 }, id: "extension-id", url: "https://evil.example.com/c/conv-a" },
        value => resolve(value as RunReply)
      );
    });
    expect(foreign.ok).toBe(false);

    const garbage = await send_({ type: "start", input: { ...START_INPUT, workItemId: "" } });
    expect(garbage.ok).toBe(false);
    const unknownEvent = await send_({ type: "apply", runId: "bcr-bg-1", event: { type: "NOT_AN_EVENT" }, now: 1 });
    expect(unknownEvent.ok).toBe(false);
  });
});
