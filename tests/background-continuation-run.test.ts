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
  evaluatorConfigured?: boolean;
  model?: string;
  decision?: string;
  stopReason?: string;
  synced?: boolean;
  reason?: string;
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
    const gated = await send_({ type: "start", input: { ...START_INPUT, maxContinuations: 50 } });
    expect(gated.ok).toBe(false);
    expect(gated.error).toMatch(/expected one of 1 \| 5 \| 10 \| 20/);
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

  it("stores evaluator config without echoing the key and reports configured state", async () => {
    const backing: Record<string, unknown> = {};
    const { handler } = await loadHandler(backing);
    const raw = (message: object) => new Promise<RunReply>(resolve => {
      handler(message, providerSender(), value => resolve(value as RunReply));
    });
    const unset = await raw({ type: "NOOS_CONTINUATION_EVAL_CONFIG" });
    expect(unset.ok).toBe(true);
    expect(unset.evaluatorConfigured).toBe(false);
    const saved = await raw({ type: "NOOS_CONTINUATION_EVAL_CONFIG", config: { apiKey: "sk-abc", model: "deepseek-chat" } });
    expect(saved.ok).toBe(true);
    expect(saved.evaluatorConfigured).toBe(true);
    expect(saved.model).toBe("deepseek-chat");
    expect(JSON.stringify(backing.noosBcrEvaluatorConfig)).toContain("sk-abc");
    const readBack = await raw({ type: "NOOS_CONTINUATION_EVAL_CONFIG" });
    expect(readBack.evaluatorConfigured).toBe(true);
    expect(JSON.stringify(readBack)).not.toContain("sk-abc");
  });

  it("evaluates an AUTO round through the stored config and fails closed otherwise", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      goal_status: "IN_PROGRESS", focus_status: "OPEN_ADVANCING", scope_relation: "WITHIN_SCOPE",
      dependency: "NONE", anchor_need: "NONE", confidence: "HIGH"
    }) } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const backing: Record<string, unknown> = {};
    const { handler } = await loadHandler(backing);
    const raw = (message: object) => new Promise<RunReply>(resolve => {
      handler(message, providerSender(), value => resolve(value as RunReply));
    });
    const unconfigured = await raw({ type: "NOOS_CONTINUATION_EVALUATE", runId: "bcr-bg-1", assistantTurnExcerpt: "advanced" });
    expect(unconfigured.ok).toBe(false);
    expect(unconfigured.error).toBe("evaluator_unconfigured");
    await raw({ type: "NOOS_CONTINUATION_EVAL_CONFIG", config: { apiKey: "sk-abc", model: "deepseek-chat" } });
    const noRun = await raw({ type: "NOOS_CONTINUATION_EVALUATE", runId: "ghost", assistantTurnExcerpt: "advanced" });
    expect(noRun.ok).toBe(false);
    expect(noRun.error).toBe("no_active_auto_run");
    await send(handler, { type: "start", input: { ...START_INPUT, mode: "AUTO_X5", goal: "Settle the gate question" } });
    // Only an EVALUATING run may be evaluated: drive round 1 to completion.
    await send(handler, { type: "apply", runId: "bcr-bg-1", event: { type: "DISPATCH_ISSUED", operationId: "bcr-bg-1:go:1" }, now: 101 });
    await send(handler, { type: "apply", runId: "bcr-bg-1", event: { type: "OPERATION_ACCEPTED", operationId: "bcr-bg-1:go:1" }, now: 102 });
    const completed = await send(handler, { type: "apply", runId: "bcr-bg-1", event: { type: "OPERATION_COMPLETED", operationId: "bcr-bg-1:go:1", turnRef: "turn:t1" }, now: 103 });
    expect(completed.run?.phase).toBe("EVALUATING");
    const passing = await raw({ type: "NOOS_CONTINUATION_EVALUATE", runId: "bcr-bg-1", assistantTurnExcerpt: "advanced the focus" });
    expect(passing.ok).toBe(true);
    expect(passing.decision).toBe("WOULD_CONTINUE");
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.model).toBe("deepseek-chat");
    expect(body.messages[1].content).toContain("Settle the gate question");
    const failing = vi.fn(async () => new Response("denied", { status: 401 }));
    vi.stubGlobal("fetch", failing);
    const denied = await raw({ type: "NOOS_CONTINUATION_EVALUATE", runId: "bcr-bg-1", assistantTurnExcerpt: "advanced" });
    expect(denied.ok).toBe(true);
    expect(denied.decision).toBe("WOULD_STOP");
    expect(denied.stopReason).toBe("EVALUATOR_UNAVAILABLE");
  });

  it("syncs the evaluator config from the Hub pull endpoint and lands it locally", async () => {
    const backing: Record<string, unknown> = {};
    const { handler } = await loadHandler(backing);
    const raw = (message: object) => new Promise<RunReply>(resolve => {
      handler(message, providerSender(), value => resolve(value as RunReply));
    });
    // Hub unreachable (fetch rejects): fail-closed, nothing stored. A real
    // Hub may be live on 127.0.0.1:17642 on dev machines, so unreachability
    // is always simulated, never assumed.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));
    const unreachable = await raw({ type: "NOOS_CONTINUATION_EVAL_SYNC" });
    expect(unreachable.ok).toBe(false);
    expect(unreachable.error).toBe("hub_unreachable");
    expect(backing.noosBcrEvaluatorConfig).toBeUndefined();
    // Hub responds but has no evaluator config: not synced, local untouched.
    // The pair endpoint shares the stub and must still yield a token.
    const hubEndpointPayload = (target: string): Response =>
      target.endsWith("/pair")
        ? new Response(JSON.stringify({ token: "test-token" }), { status: 200 })
        : new Response(JSON.stringify({ ok: true, configured: false, baseUrl: "https://api.deepseek.com", apiKey: null, model: null }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => hubEndpointPayload(String(url))));
    const notConfigured = await raw({ type: "NOOS_CONTINUATION_EVAL_SYNC" });
    expect(notConfigured.ok).toBe(true);
    expect(notConfigured.synced).toBe(false);
    expect(notConfigured.reason).toBe("hub_not_configured");
    // Hub serves a full config: normalized and stored locally.
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).endsWith("/pair")) return new Response(JSON.stringify({ token: "test-token" }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, configured: true, baseUrl: "https://api.deepseek.com", apiKey: "sk-hub", model: "deepseek-chat" }), { status: 200 });
    }));
    const synced = await raw({ type: "NOOS_CONTINUATION_EVAL_SYNC" });
    expect(synced.ok).toBe(true);
    expect(synced.synced).toBe(true);
    expect(synced.model).toBe("deepseek-chat");
    expect(backing.noosBcrEvaluatorConfig).toEqual({ baseUrl: "https://api.deepseek.com", apiKey: "sk-hub", model: "deepseek-chat" });
    // A served config off the allowlist is refused and never stored.
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).endsWith("/pair")) return new Response(JSON.stringify({ token: "test-token" }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, configured: true, baseUrl: "https://evil.example.com", apiKey: "sk-evil", model: "m" }), { status: 200 });
    }));
    const invalid = await raw({ type: "NOOS_CONTINUATION_EVAL_SYNC" });
    expect(invalid.ok).toBe(true);
    expect(invalid.synced).toBe(false);
    expect(invalid.reason).toBe("hub_config_invalid");
    expect((backing.noosBcrEvaluatorConfig as { apiKey?: string }).apiKey).toBe("sk-hub");
  });
});
