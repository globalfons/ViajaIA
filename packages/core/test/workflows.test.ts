import { describe, expect, it, vi } from "vitest";
import { WorkflowEngine, initRunState, type EngineDeps, type AgentNodeResult } from "../src/workflows/engine";
import { validateWorkflowGraph, type WorkflowGraph } from "../src/workflows/schema";
import { resolveTemplate, resolveDeep, resolveSecrets } from "../src/workflows/template";
import { mockFetch } from "../src/testing/fake-llm";

const AGENT = "00000000-0000-4000-8000-000000000001";
const n = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
const e = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}${sourceHandle ? `-${sourceHandle}` : ""}`, source, target, sourceHandle });

function graph(nodes: ReturnType<typeof n>[], edges: ReturnType<typeof e>[]): WorkflowGraph {
  const { graph, issues } = validateWorkflowGraph({ nodes, edges });
  if (!graph) throw new Error(issues.map((i) => i.message).join("; "));
  return graph;
}

function deps(over: Partial<EngineDeps> = {}): EngineDeps {
  return {
    runAgent: vi.fn(async ({ message }) => ({ status: "completed", output: `agent: ${message}`, structured: null, agentRunId: "ar-1" }) as AgentNodeResult),
    runTool: vi.fn(async ({ args }) => ({ ok: true, args })),
    sleep: async () => {},
    ...over,
  };
}

async function runToEnd(g: WorkflowGraph, d: EngineDeps, input: Record<string, unknown> = {}) {
  const engine = new WorkflowEngine(g, d);
  return engine.advance(initRunState(g, "run-1", input));
}

describe("graph validation", () => {
  it("accepts a minimal START → END", () => {
    expect(validateWorkflowGraph({ nodes: [n("s", "start"), n("x", "end")], edges: [e("s", "x")] }).issues).toEqual([]);
  });

  it.each([
    ["no start", { nodes: [n("a", "parallel"), n("x", "end")], edges: [e("a", "x")] }, /exactly one START/],
    ["cycle", { nodes: [n("s", "start"), n("a", "parallel"), n("b", "parallel"), n("x", "end")], edges: [e("s", "a"), e("a", "b"), e("b", "a"), e("b", "x")] }, /cycle/],
    ["dangling edge", { nodes: [n("s", "start"), n("x", "end")], edges: [e("s", "x"), e("s", "ghost")] }, /missing node/],
    ["condition without both branches", { nodes: [n("s", "start"), n("c", "condition", { rules: [{ left: "{{input.a}}", op: "exists" }] }), n("x", "end")], edges: [e("s", "c"), e("c", "x", "true")] }, /both true and false/],
    ["bad node data", { nodes: [n("s", "start"), n("a", "agent", { agentId: "nope" }), n("x", "end")], edges: [e("s", "a"), e("a", "x")] }, /agentId/],
    ["unconnected node", { nodes: [n("s", "start"), n("lonely", "parallel"), n("x", "end")], edges: [e("s", "x")] }, /not connected/],
  ])("rejects %s", (_name, g, re) => {
    const { issues } = validateWorkflowGraph(g);
    expect(issues.map((i) => i.message).join("\n")).toMatch(re);
  });
});

describe("templates", () => {
  const scope = { input: { name: "Ana", tags: ["vip"] }, nodes: { a: { output: { score: 80 } } } };
  it("resolves single placeholders to raw values and interpolates strings", () => {
    expect(resolveTemplate("{{nodes.a.output.score}}", scope)).toBe(80);
    expect(resolveTemplate("Hola {{input.name}} ({{nodes.a.output.score}})", scope)).toBe("Hola Ana (80)");
    expect(resolveDeep({ x: ["{{input.tags}}"] }, scope)).toEqual({ x: [["vip"]] });
  });
  it("blocks prototype access", () => {
    expect(resolveTemplate("{{input.__proto__}}", scope)).toBeUndefined();
    expect(resolveTemplate("{{input.constructor.name}}", scope)).toBeUndefined();
  });
  it("leaves secrets untouched until explicitly resolved server-side", async () => {
    expect(resolveTemplate("Bearer {{secret:CRM_TOKEN}}", scope)).toBe("Bearer {{secret:CRM_TOKEN}}");
    expect(await resolveSecrets("Bearer {{secret:CRM_TOKEN}}", async () => "t0k")).toBe("Bearer t0k");
    await expect(resolveSecrets("{{secret:MISSING}}", async () => null)).rejects.toThrow(/not configured/);
  });
});

describe("WorkflowEngine", () => {
  it("runs a linear flow passing data between nodes", async () => {
    const g = graph(
      [n("s", "start"), n("a", "agent", { agentId: AGENT, message: "Resume: {{input.text}}" }), n("x", "end", { output: { summary: "{{nodes.a.output.text}}" } })],
      [e("s", "a"), e("a", "x")],
    );
    const res = await runToEnd(g, deps(), { text: "hola" });
    expect(res.status).toBe("completed");
    expect(res.state.output).toEqual({ summary: "agent: Resume: hola" });
  });

  it("records each node's resolved input and timing for debugging, with secrets redacted", async () => {
    const f = mockFetch(() => ({ body: { ok: 1 } }));
    const g = graph(
      [
        n("s", "start"),
        n("a", "agent", { agentId: AGENT, message: "Resume: {{input.text}}" }),
        n("t", "tool", { tool: "http_get", args: { url: "https://x.test/?q={{input.text}}", token: "sk-live-abcdefghijklmnopqrstuvwxyz123456" } }),
        n("w", "webhook", { url: "https://hooks.example.com/{{input.text}}", headers: { Authorization: "Bearer {{secret:CRM_TOKEN}}" } }),
        n("x", "end"),
      ],
      [e("s", "a"), e("a", "t"), e("t", "w"), e("w", "x")],
    );
    const res = await runToEnd(g, deps({ fetchImpl: f, getSecret: async () => "s3cr3t" }), { text: "hola" });
    const nodes = res.state.nodes;
    expect(nodes.a!.input).toEqual({ agentId: AGENT, message: "Resume: hola" });
    expect(nodes.t!.input).toMatchObject({ tool: "http_get", args: { url: "https://x.test/?q=hola" } });
    expect(JSON.stringify(nodes.t!.input)).not.toContain("sk-live-abcdefghijklmnop");
    expect(nodes.w!.input).toEqual({ method: "POST", url: "https://hooks.example.com/hola" });
    expect(JSON.stringify(res.state)).not.toContain("s3cr3t");
    for (const id of ["a", "t", "w"]) expect(Date.parse(nodes[id]!.finishedAt!) >= Date.parse(nodes[id]!.startedAt!)).toBe(true);
  });

  it("follows the matching condition branch and skips the other (joins still run)", async () => {
    const d = deps();
    const g = graph(
      [
        n("s", "start"),
        n("c", "condition", { rules: [{ left: "{{input.score}}", op: "gte", right: 70 }] }),
        n("hot", "tool", { tool: "notify", args: { level: "hot" } }),
        n("cold", "tool", { tool: "notify", args: { level: "cold" } }),
        n("join", "parallel"),
        n("x", "end", { output: { hot: "{{nodes.hot.status}}", cold: "{{nodes.cold.status}}" } }),
      ],
      [e("s", "c"), e("c", "hot", "true"), e("c", "cold", "false"), e("hot", "join"), e("cold", "join"), e("join", "x")],
    );
    const res = await runToEnd(g, d, { score: 85 });
    expect(res.status).toBe("completed");
    expect(res.state.output).toEqual({ hot: "succeeded", cold: "skipped" });
    expect(d.runTool).toHaveBeenCalledTimes(1);
  });

  it("executes parallel branches concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const d = deps({
      runTool: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return {};
      },
    });
    const g = graph(
      [n("s", "start"), n("p", "parallel"), n("t1", "tool", { tool: "a" }), n("t2", "tool", { tool: "b" }), n("t3", "tool", { tool: "c" }), n("x", "end")],
      [e("s", "p"), e("p", "t1"), e("p", "t2"), e("p", "t3"), e("t1", "x"), e("t2", "x"), e("t3", "x")],
    );
    expect((await runToEnd(g, d)).status).toBe("completed");
    expect(maxInFlight).toBe(3);
  });

  it("retries with exponential backoff and records attempts", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const d = deps({
      sleep: async (ms) => void sleeps.push(ms),
      runTool: async () => {
        if (++calls < 3) throw new Error("503");
        return { ok: true };
      },
    });
    const g = graph([n("s", "start"), n("t", "tool", { tool: "x", retry: { maxAttempts: 3, backoffMs: 100 } }), n("x", "end")], [e("s", "t"), e("t", "x")]);
    const res = await runToEnd(g, d);
    expect(res.status).toBe("completed");
    expect(res.state.nodes.t!.attempts).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("fails the run after exhausting retries; continueOnError keeps going", async () => {
    const d = deps({ runTool: async () => Promise.reject(new Error("boom")) });
    const failing = graph([n("s", "start"), n("t", "tool", { tool: "x", retry: { maxAttempts: 2, backoffMs: 0 } }), n("x", "end")], [e("s", "t"), e("t", "x")]);
    const res = await runToEnd(failing, d);
    expect(res.status).toBe("failed");
    expect(res.state.nodes.t).toMatchObject({ status: "failed", error: "boom", attempts: 2 });
    expect(res.state.nodes.x!.status).toBe("skipped");

    const tolerant = graph([n("s", "start"), n("t", "tool", { tool: "x", continueOnError: true }), n("x", "end", { output: { err: "{{nodes.t.output.error}}" } })], [e("s", "t"), e("t", "x")]);
    expect((await runToEnd(tolerant, d)).state.output).toEqual({ err: "boom" });
  });

  it("enforces node timeouts", async () => {
    const d = deps({ runTool: () => new Promise(() => {}) });
    const g = graph([n("s", "start"), n("t", "tool", { tool: "x", timeoutMs: 1000 }), n("x", "end")], [e("s", "t"), e("t", "x")]);
    vi.useFakeTimers();
    const p = runToEnd(g, d);
    await vi.advanceTimersByTimeAsync(1100);
    vi.useRealTimers();
    const res = await p;
    expect(res.state.nodes.t!.error).toMatch(/Timed out/);
  });

  it("pauses for human approval and follows approved/rejected branches", async () => {
    const requestApproval = vi.fn(async () => {});
    const d = deps({ requestApproval });
    const g = graph(
      [
        n("s", "start"),
        n("ap", "approval", { title: "¿Enviar oferta a {{input.email}}?" }),
        n("send", "tool", { tool: "send" }),
        n("log", "tool", { tool: "log" }),
        n("x", "end"),
      ],
      [e("s", "ap"), e("ap", "send", "approved"), e("ap", "log", "rejected"), e("send", "x"), e("log", "x")],
    );
    const engine = new WorkflowEngine(g, d);
    const paused = await engine.advance(initRunState(g, "r", { email: "a@b.test" }));
    expect(paused.status).toBe("waiting");
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({ title: "¿Enviar oferta a a@b.test?", approvalKey: "r:ap" }));

    const rejected = await engine.advance(engine.decide(paused.state, { nodeId: "ap", approved: false, by: "ana" }));
    expect(rejected.status).toBe("completed");
    expect(rejected.state.nodes.send!.status).toBe("skipped");
    expect(rejected.state.nodes.log!.status).toBe("succeeded");

    expect(() => engine.decide(rejected.state, { nodeId: "ap", approved: true })).toThrow(/No pending approval/);
  });

  it("a rejection without a rejected branch fails the run", async () => {
    const g = graph([n("s", "start"), n("ap", "approval", { title: "ok?" }), n("x", "end")], [e("s", "ap"), e("ap", "x", "approved")]);
    const engine = new WorkflowEngine(g, deps());
    const paused = await engine.advance(initRunState(g, "r", {}));
    const res = await engine.advance(engine.decide(paused.state, { nodeId: "ap", approved: false }));
    expect(res.status).toBe("failed");
  });

  it("long delays make the run wait until the wake-up time", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const g = graph([n("s", "start"), n("d", "delay", { seconds: 3600 }), n("x", "end")], [e("s", "d"), e("d", "x")]);
    const engine = new WorkflowEngine(g, deps({ now: () => now }));
    const waiting = await engine.advance(initRunState(g, "r", {}));
    expect(waiting).toMatchObject({ status: "waiting", nextWakeAt: "2026-01-01T01:00:00.000Z" });
    expect((await engine.advance(waiting.state)).status).toBe("waiting");
    now = new Date("2026-01-01T01:00:01Z");
    expect((await engine.advance(waiting.state)).status).toBe("completed");
  });

  it("agent nodes wait while the agent's own action awaits approval", async () => {
    let decided = false;
    const d = deps({
      runAgent: async () => ({ status: "needs_approval", output: "", agentRunId: "ar-9" }),
      getAgentRun: async () => (decided ? { status: "completed", output: "hecho", agentRunId: "ar-9" } : null),
    });
    const g = graph([n("s", "start"), n("a", "agent", { agentId: AGENT, message: "x" }), n("x", "end", { output: { r: "{{nodes.a.output.text}}" } })], [e("s", "a"), e("a", "x")]);
    const engine = new WorkflowEngine(g, d);
    const w = await engine.advance(initRunState(g, "r", {}));
    expect(w.status).toBe("waiting");
    expect((await engine.advance(w.state)).status).toBe("waiting");
    decided = true;
    const done = await engine.advance(w.state);
    expect(done).toMatchObject({ status: "completed", state: { output: { r: "hecho" } } });
  });

  it("webhooks resolve secrets server-side and go through SSRF protection", async () => {
    const f = mockFetch(() => ({ body: { received: true } }));
    const d = deps({ fetchImpl: f, getSecret: async (name) => (name === "CRM_TOKEN" ? "s3cr3t" : null) });
    const g = graph(
      [
        n("s", "start"),
        n("w", "webhook", { url: "https://hooks.example.com/lead", headers: { Authorization: "Bearer {{secret:CRM_TOKEN}}" }, body: '{"email":"{{input.email}}"}' }),
        n("x", "end", { output: { ok: "{{nodes.w.output.body.received}}" } }),
      ],
      [e("s", "w"), e("w", "x")],
    );
    const res = await runToEnd(g, d, { email: "a@b.test" });
    expect(res.state.output).toEqual({ ok: true });
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer s3cr3t");
    expect(f.calls[0]!.json).toEqual({ email: "a@b.test" });
    // The secret never lands in the persisted run state.
    expect(JSON.stringify(res.state)).not.toContain("s3cr3t");

    const internal = graph([n("s", "start"), n("w", "webhook", { url: "https://169.254.169.254/latest/meta-data" }), n("x", "end")], [e("s", "w"), e("w", "x")]);
    const blocked = await runToEnd(internal, deps({ fetchImpl: f }));
    expect(blocked.state.nodes.w!.error).toMatch(/Private address/);
  });

  it("state survives a JSON round-trip between steps", async () => {
    const g = graph([n("s", "start"), n("ap", "approval", { title: "t" }), n("x", "end")], [e("s", "ap"), e("ap", "x", "approved")]);
    const engine = new WorkflowEngine(g, deps());
    const paused = await engine.advance(initRunState(g, "r", {}));
    const restored = JSON.parse(JSON.stringify(paused.state));
    expect((await engine.advance(engine.decide(restored, { nodeId: "ap", approved: true }))).status).toBe("completed");
  });

  it("condition operators", async () => {
    const check = async (rules: unknown[], input: Record<string, unknown>, combinator = "and") => {
      const g = graph(
        [n("s", "start"), n("c", "condition", { combinator, rules }), n("t", "end", { output: { r: "yes" } }), n("f", "end", { output: { r: "no" } })],
        [e("s", "c"), e("c", "t", "true"), e("c", "f", "false")],
      );
      return (await runToEnd(g, deps(), input)).state.output!.r;
    };
    expect(await check([{ left: "{{input.cat}}", op: "in", right: "reclamacion, incidencia" }], { cat: "incidencia" })).toBe("yes");
    expect(await check([{ left: "{{input.text}}", op: "contains", right: "URGENTE" }], { text: "es urgente" })).toBe("yes");
    expect(await check([{ left: "{{input.missing}}", op: "exists" }], {})).toBe("no");
    expect(await check([{ left: "{{input.a}}", op: "eq", right: "1" }, { left: "{{input.b}}", op: "eq", right: "1" }], { a: 1, b: 2 }, "or")).toBe("yes");
  });
});
