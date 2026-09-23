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

/** A completed turn with enough material to evaluate (the lane refuses near-empty excerpts). */
const LONG_EXCERPT = "Settled another step of the gate question. ".repeat(8);

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
      set: async (value: Record<string, unknown>) => Object.assign(backing, value),
      remove: async (key: string | string[]) => {
        for (const entry of Array.isArray(key) ? key : [key]) delete backing[entry];
      }
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
  vetoHit?: boolean;
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

  it("consumes the round once when two worker instances converge the same completion", async () => {
    // M2: a page that reloads mid-round, and the worker instance that replaces
    // it, both offer the missing OPERATION_COMPLETED for a durable op that is
    // already COMPLETED. Only the first may move the Run.
    const backing: Record<string, unknown> = {};
    const first = await loadHandler(backing);
    await send(first.handler, { type: "start", input: START_INPUT });
    await send(first.handler, { type: "apply", runId: "bcr-bg-1", event: { type: "DISPATCH_ISSUED", operationId: "bcr-bg-1:go:1" }, now: 101 });
    await send(first.handler, { type: "apply", runId: "bcr-bg-1", event: { type: "OPERATION_ACCEPTED", operationId: "bcr-bg-1:go:1", turnRef: "turn:t1" }, now: 102 });

    const restarted = await loadHandler(backing);
    const applied = await send(restarted.handler, { type: "apply", runId: "bcr-bg-1", event: { type: "OPERATION_COMPLETED", operationId: "bcr-bg-1:go:1", turnRef: "turn:t1" }, now: 103 });
    expect(applied.ok).toBe(true);
    expect(applied.run?.consumedContinuations).toBe(1);

    const replayed = await send(first.handler, { type: "apply", runId: "bcr-bg-1", event: { type: "OPERATION_COMPLETED", operationId: "bcr-bg-1:go:1", turnRef: "turn:t1" }, now: 104 });
    expect(replayed.ok).toBe(false);
    expect(replayed.error).toMatch(/non-pending operation/);
    const settled = await send(restarted.handler, { type: "get_active", providerConversationRef: "conv-a" });
    expect(settled.run?.consumedContinuations).toBe(1);
    expect(settled.run?.phase).toBe("AWAITING_HUMAN_DECISION");
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

  it("reports keyless evaluator status and scrubs any legacy stored key (#100 slice 2)", async () => {
    const backing: Record<string, unknown> = {
      noosBcrEvaluatorConfig: { baseUrl: "https://api.deepseek.com", apiKey: "sk-legacy", model: "deepseek-chat" }
    };
    // The status endpoint answers configured/model with no key field; the
    // call is authorized, so seed a stored token as a paired extension has.
    backing.noosHubShuttleToken = "test-token";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, configured: true, baseUrl: "https://api.deepseek.com", model: "deepseek-chat" }), { status: 200 })));
    const { handler } = await loadHandler(backing);
    const raw = (message: object) => new Promise<RunReply>(resolve => {
      handler(message, providerSender(), value => resolve(value as RunReply));
    });
    const status = await raw({ type: "NOOS_CONTINUATION_EVAL_CONFIG", config: { apiKey: "sk-abc", model: "deepseek-chat" } });
    expect(status.ok).toBe(true);
    expect(status.evaluatorConfigured).toBe(true);
    expect(status.model).toBe("deepseek-chat");
    // Manual entry is retired: the supplied config is ignored and the legacy
    // key is scrubbed from local storage, not stored.
    expect(backing.noosBcrEvaluatorConfig).toBeUndefined();
    expect(JSON.stringify(status)).not.toContain("sk-");
  });

  it("evaluates an AUTO round through the Hub proxy and fails closed otherwise (#100 slice 2)", async () => {
    const assessment = JSON.stringify({
      goal_status: "IN_PROGRESS", focus_status: "OPEN_ADVANCING", scope_relation: "WITHIN_SCOPE",
      dependency: "NONE", anchor_need: "NONE", confidence: "HIGH"
    });
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/v1/bcr/evaluate")) {
        // The proxy returns only the provider content: no key, no config.
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body));
        expect(Object.keys(body).sort()).toEqual(["assistantTurnExcerpt", "goal", "scope"]);
        expect(String((init?.headers as Record<string, string>)["Authorization"] ?? "")).toContain("Bearer ");
        return new Response(JSON.stringify({ ok: true, content: assessment }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${target}`);
    });
    vi.stubGlobal("fetch", fetchImpl);
    const backing: Record<string, unknown> = {};
    const { handler } = await loadHandler(backing);
    const raw = (message: object) => new Promise<RunReply>(resolve => {
      handler(message, providerSender(), value => resolve(value as RunReply));
    });
    const noRun = await raw({ type: "NOOS_CONTINUATION_EVALUATE", runId: "ghost", assistantTurnExcerpt: LONG_EXCERPT });
    expect(noRun.ok).toBe(false);
    expect(noRun.error).toBe("no_active_auto_run");
    await send(handler, { type: "start", input: { ...START_INPUT, mode: "AUTO_X5", goal: "Settle the gate question" } });
    // Only an EVALUATING run may be evaluated: drive round 1 to completion.
    await send(handler, { type: "apply", runId: "bcr-bg-1", event: { type: "DISPATCH_ISSUED", operationId: "bcr-bg-1:go:1" }, now: 101 });
    await send(handler, { type: "apply", runId: "bcr-bg-1", event: { type: "OPERATION_ACCEPTED", operationId: "bcr-bg-1:go:1" }, now: 102 });
    const completed = await send(handler, { type: "apply", runId: "bcr-bg-1", event: { type: "OPERATION_COMPLETED", operationId: "bcr-bg-1:go:1", turnRef: "turn:t1" }, now: 103 });
    expect(completed.run?.phase).toBe("EVALUATING");
    // Unpaired: the proxy call is refused before any fetch happens.
    const unpaired = await raw({ type: "NOOS_CONTINUATION_EVALUATE", runId: "bcr-bg-1", assistantTurnExcerpt: LONG_EXCERPT });
    expect(unpaired.ok).toBe(true);
    expect(unpaired.decision).toBe("WOULD_STOP");
    expect(unpaired.stopReason).toBe("EVALUATOR_UNAVAILABLE");
    expect(unpaired.error).toBe("pairing_required");
    expect(fetchImpl).not.toHaveBeenCalled();
    backing.noosHubShuttleToken = "test-token";
    const passing = await raw({ type: "NOOS_CONTINUATION_EVALUATE", runId: "bcr-bg-1", assistantTurnExcerpt: `${LONG_EXCERPT}advanced the focus` });
    expect(passing.ok).toBe(true);
    expect(passing.decision).toBe("WOULD_CONTINUE");
    expect(passing.vetoHit).toBe(false);
    // The structured input the proxy received carries the run's frozen goal.
    const proxyBody = JSON.parse((fetchImpl.mock.calls.find(call => String(call[0]).endsWith("/v1/bcr/evaluate")) as unknown as [string, RequestInit])[1].body as string);
    expect(proxyBody.goal).toBe("Settle the gate question");
    // An upstream failure is reported as a stop with the Hub's code preserved —
    // distinguishable from the pairing failure above, not conflated with it.
    const failing = vi.fn(async (url: string | URL) => {
      if (String(url).endsWith("/v1/bcr/evaluate")) {
        return new Response(JSON.stringify({ ok: false, error_code: "evaluator_upstream_error" }), { status: 502 });
      }
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", failing);
    const denied = await raw({ type: "NOOS_CONTINUATION_EVALUATE", runId: "bcr-bg-1", assistantTurnExcerpt: LONG_EXCERPT });
    expect(denied.ok).toBe(true);
    expect(denied.decision).toBe("WOULD_STOP");
    expect(denied.stopReason).toBe("EVALUATOR_UNAVAILABLE");
    expect(denied.error).toBe("evaluator_upstream_error");
  });

  // Fail closed before the model is asked: an excerpt this short is a node that
  // has not rendered, and the UNCERTAIN/LOW answer it would earn is not a
  // judgment about the round. The stop must say "no text", not "a Human is needed".
  it("refuses to evaluate an unusable excerpt and never calls the evaluator", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const { handler } = await loadHandler();
    const raw = (message: object) => new Promise<RunReply>(resolve => {
      handler(message, providerSender(), value => resolve(value as RunReply));
    });
    await send(handler, { type: "start", input: { ...START_INPUT, mode: "AUTO_X5", goal: "Settle the gate question" } });
    await send(handler, { type: "apply", runId: "bcr-bg-1", event: { type: "DISPATCH_ISSUED", operationId: "bcr-bg-1:go:1" }, now: 101 });
    await send(handler, { type: "apply", runId: "bcr-bg-1", event: { type: "OPERATION_ACCEPTED", operationId: "bcr-bg-1:go:1" }, now: 102 });
    await send(handler, { type: "apply", runId: "bcr-bg-1", event: { type: "OPERATION_COMPLETED", operationId: "bcr-bg-1:go:1", turnRef: "turn:t1" }, now: 103 });
    for (const excerpt of ["", "OK", "已经完成。", "x".repeat(19)]) {
      const refused = await raw({ type: "NOOS_CONTINUATION_EVALUATE", runId: "bcr-bg-1", assistantTurnExcerpt: excerpt });
      expect(refused.ok, excerpt).toBe(true);
      expect(refused.decision, excerpt).toBe("WOULD_STOP");
      expect(refused.stopReason, excerpt).toBe("EXCERPT_UNAVAILABLE");
      // No veto claim either: the word list was never consulted.
      expect(refused.vetoHit, excerpt).toBeUndefined();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    const noRunId = await raw({ type: "NOOS_CONTINUATION_EVALUATE", assistantTurnExcerpt: LONG_EXCERPT });
    expect(noRunId.ok).toBe(false);
    expect(noRunId.error).toBe("runId_required");
    const tooLong = await raw({ type: "NOOS_CONTINUATION_EVALUATE", runId: "bcr-bg-1", assistantTurnExcerpt: "x".repeat(8_001) });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.error).toBe("excerpt_too_long");
  });

  it("syncs keyless evaluator status from the Hub and stores nothing (#100 slice 2)", async () => {
    const backing: Record<string, unknown> = { noosBcrEvaluatorConfig: { baseUrl: "https://api.deepseek.com", apiKey: "sk-legacy", model: "deepseek-chat" } };
    const { handler } = await loadHandler(backing);
    const raw = (message: object) => new Promise<RunReply>(resolve => {
      handler(message, providerSender(), value => resolve(value as RunReply));
    });
    // Hub unreachable (fetch rejects): fail-closed. A real Hub may be live on
    // 127.0.0.1:17642 on dev machines, so unreachability is always simulated.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));
    const unreachable = await raw({ type: "NOOS_CONTINUATION_EVAL_SYNC" });
    expect(unreachable.ok).toBe(false);
    expect(unreachable.error).toBe("hub_unreachable");
    // Sync runs on the STORED token (#100 slice 1) and never silently re-pairs.
    backing.noosHubShuttleToken = "test-token";
    // Hub configured: status reported, and the legacy key is scrubbed.
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ ok: true, configured: true, baseUrl: "https://api.deepseek.com", model: "deepseek-chat" }), { status: 200 });
    }));
    const synced = await raw({ type: "NOOS_CONTINUATION_EVAL_SYNC" });
    expect(synced.ok).toBe(true);
    expect(synced.synced).toBe(true);
    expect(synced.model).toBe("deepseek-chat");
    expect(backing.noosBcrEvaluatorConfig).toBeUndefined(), "legacy key scrubbed";
    // Hub not configured: reported as such.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, configured: false, baseUrl: "https://api.deepseek.com", model: null }), { status: 200 })));
    const notConfigured = await raw({ type: "NOOS_CONTINUATION_EVAL_SYNC" });
    expect(notConfigured.ok).toBe(true);
    expect(notConfigured.synced).toBe(false);
    expect(notConfigured.reason).toBe("hub_not_configured");
    // A response that still carries a key violates the keyless contract: the
    // extension refuses it rather than accepting configuration from the wire.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, configured: true, baseUrl: "https://api.deepseek.com", apiKey: "sk-leak", model: "deepseek-chat" }), { status: 200 })));
    const violation = await raw({ type: "NOOS_CONTINUATION_EVAL_SYNC" });
    expect(violation.ok).toBe(false);
    expect(violation.error).toBe("hub_contract_violation");
    // No authorized call ever hit /pair.
    expect(calls.every(url => !url.endsWith("/pair"))).toBe(true);
  });
});
