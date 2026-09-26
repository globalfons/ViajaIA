import { safeFetch, type OutboundPolicy } from "../security/ssrf";
import { redactSecretsDeep } from "../security/guardrails";
import {
  nodeDataSchemas,
  type NodeData,
  type NodeType,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from "./schema";
import { getPath, resolveDeep, resolveSecrets, resolveTemplate, type TemplateScope } from "./template";

/**
 * Workflow engine. Executes a validated DAG with:
 *   - parallel branches (all ready nodes of a wave run concurrently),
 *   - conditions (true/false handles) with skip propagation, so joins work,
 *   - retries with backoff, per-node timeouts, continueOnError,
 *   - human approval and long delays as *waiting* states,
 *   - agent nodes that may themselves wait for an approval.
 * The whole run state is plain JSON: the worker persists it between steps,
 * so a run survives restarts and can wait for days.
 */

export type NodeStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "waiting";
export type RunStatus = "running" | "waiting" | "completed" | "failed" | "cancelled";

export interface NodeState {
  status: NodeStatus;
  output?: unknown;
  /** Resolved input of the node (templates applied, secrets redacted) for debugging. */
  input?: unknown;
  error?: string;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  /** Why the node waits and until when / for what. */
  wait?: { kind: "approval"; approvalKey: string } | { kind: "delay"; until: string } | { kind: "agent_run"; agentRunId: string };
  logs: string[];
}

export interface RunState {
  runId: string;
  input: Record<string, unknown>;
  nodes: Record<string, NodeState>;
  edges: Record<string, "active" | "skipped">;
  output?: Record<string, unknown>;
}

export interface AgentNodeResult {
  status: "completed" | "needs_approval" | "escalated" | "blocked" | "failed";
  output: string;
  structured?: Record<string, unknown> | null;
  agentRunId: string;
  error?: string;
}

export interface EngineDeps {
  runAgent(p: { agentId: string; message: string; runId: string; nodeId: string; signal: AbortSignal }): Promise<AgentNodeResult>;
  /** Re-checks an agent run a node is waiting for. Returns null while still pending. */
  getAgentRun?(agentRunId: string): Promise<AgentNodeResult | null>;
  runTool(p: { tool: string; args: Record<string, unknown>; runId: string; nodeId: string; signal: AbortSignal }): Promise<unknown>;
  getSecret?(name: string): Promise<string | null>;
  /** Called when a node starts waiting for a human (create the approval row). */
  requestApproval?(p: { runId: string; nodeId: string; approvalKey: string; title: string; instructions: string; payload: unknown; expiresAt: string | null }): Promise<void>;
  onNodeFinished?(nodeId: string, node: NodeState): void | Promise<void>;
  outbound?: OutboundPolicy;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Delays up to this many seconds run inline; longer ones make the run wait. */
  inlineDelaySeconds?: number;
  maxConcurrency?: number;
}

export interface ApprovalDecision {
  nodeId: string;
  approved: boolean;
  by?: string;
  note?: string;
}

export function initRunState(graph: WorkflowGraph, runId: string, input: Record<string, unknown>): RunState {
  return {
    runId,
    input,
    nodes: Object.fromEntries(graph.nodes.map((n) => [n.id, { status: "pending" as NodeStatus, attempts: 0, logs: [] }])),
    edges: {},
  };
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class NodeTimeoutError extends Error {}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new NodeTimeoutError(`Timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function evaluateCondition(data: NodeData<"condition">, scope: TemplateScope): boolean {
  const results = data.rules.map((r) => {
    const left = resolveTemplate(r.left, scope);
    const right = typeof r.right === "string" ? resolveTemplate(r.right, scope) : r.right;
    const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
    switch (r.op) {
      case "eq":
        return String(left ?? "") === String(right ?? "");
      case "neq":
        return String(left ?? "") !== String(right ?? "");
      case "gt":
        return num(left) > num(right);
      case "gte":
        return num(left) >= num(right);
      case "lt":
        return num(left) < num(right);
      case "lte":
        return num(left) <= num(right);
      case "contains":
        return Array.isArray(left) ? left.map(String).includes(String(right)) : String(left ?? "").toLowerCase().includes(String(right ?? "").toLowerCase());
      case "not_contains":
        return !(Array.isArray(left) ? left.map(String).includes(String(right)) : String(left ?? "").toLowerCase().includes(String(right ?? "").toLowerCase()));
      case "exists":
        return left !== undefined && left !== null && left !== "";
      case "not_exists":
        return left === undefined || left === null || left === "";
      case "in":
        return String(right ?? "")
          .split(",")
          .map((x) => x.trim())
          .includes(String(left ?? ""));
    }
  });
  return data.combinator === "and" ? results.every(Boolean) : results.some(Boolean);
}

export class WorkflowEngine {
  private readonly incoming = new Map<string, WorkflowEdge[]>();
  private readonly outgoing = new Map<string, WorkflowEdge[]>();
  private readonly byId = new Map<string, WorkflowNode>();

  constructor(
    private readonly graph: WorkflowGraph,
    private readonly deps: EngineDeps,
  ) {
    for (const n of graph.nodes) this.byId.set(n.id, n);
    for (const e of graph.edges) {
      this.incoming.set(e.target, [...(this.incoming.get(e.target) ?? []), e]);
      this.outgoing.set(e.source, [...(this.outgoing.get(e.source) ?? []), e]);
    }
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  private scope(state: RunState): TemplateScope {
    const nodes: Record<string, { output: unknown; status: NodeStatus }> = {};
    for (const [id, n] of Object.entries(state.nodes)) nodes[id] = { output: n.output, status: n.status };
    return { input: state.input, nodes, run: { id: state.runId } };
  }

  /** Marks outgoing edges after a node settles. `handle` selects a branch. */
  private settleEdges(state: RunState, nodeId: string, outcome: "all" | "none" | { handle: string }) {
    for (const e of this.outgoing.get(nodeId) ?? []) {
      state.edges[e.id] = outcome === "all" ? "active" : outcome === "none" ? "skipped" : e.sourceHandle === outcome.handle ? "active" : "skipped";
    }
  }

  private readyNodes(state: RunState): WorkflowNode[] {
    const ready: WorkflowNode[] = [];
    for (const n of this.graph.nodes) {
      const ns = state.nodes[n.id]!;
      if (ns.status !== "pending") continue;
      const inc = this.incoming.get(n.id) ?? [];
      if (inc.length === 0) {
        ready.push(n);
        continue;
      }
      if (inc.some((e) => !state.edges[e.id])) continue; // an upstream node has not settled yet
      if (inc.every((e) => state.edges[e.id] === "skipped")) {
        ns.status = "skipped";
        this.settleEdges(state, n.id, "none");
        continue;
      }
      ready.push(n);
    }
    return ready;
  }

  /** Applies a human decision to an approval node. */
  decide(state: RunState, d: ApprovalDecision): RunState {
    const next: RunState = structuredClone(state);
    const node = this.byId.get(d.nodeId);
    const ns = next.nodes[d.nodeId];
    if (!node || node.type !== "approval" || !ns || ns.status !== "waiting") throw new Error("No pending approval for this node");
    ns.finishedAt = this.now().toISOString();
    ns.output = { approved: d.approved, by: d.by ?? null, note: d.note ?? null };
    delete ns.wait;
    const hasRejectedBranch = (this.outgoing.get(node.id) ?? []).some((e) => e.sourceHandle === "rejected");
    if (d.approved || hasRejectedBranch) {
      ns.status = "succeeded";
      this.settleEdges(next, node.id, { handle: d.approved ? "approved" : "rejected" });
    } else {
      ns.status = "failed";
      ns.error = "Rejected by reviewer";
      this.settleEdges(next, node.id, "none");
    }
    ns.logs.push(`${d.approved ? "Approved" : "Rejected"}${d.by ? ` by ${d.by}` : ""}${d.note ? `: ${d.note}` : ""}`);
    return next;
  }

  /**
   * Runs every node that can run now. Returns the new state and run status.
   * Idempotent: calling it again on a waiting run re-checks delays/agent runs.
   */
  async advance(prev: RunState): Promise<{ state: RunState; status: RunStatus; nextWakeAt: string | null }> {
    const state: RunState = structuredClone(prev);
    const limit = Math.max(1, this.deps.maxConcurrency ?? 5);

    // Re-check waiting nodes (delays that elapsed, agent runs that were decided).
    for (const n of this.graph.nodes) {
      const ns = state.nodes[n.id]!;
      if (ns.status !== "waiting" || !ns.wait) continue;
      if (ns.wait.kind === "delay" && new Date(ns.wait.until) <= this.now()) {
        this.finish(state, n, "succeeded", { waitedUntil: ns.wait.until });
      } else if (ns.wait.kind === "agent_run" && this.deps.getAgentRun) {
        const r = await this.deps.getAgentRun(ns.wait.agentRunId);
        if (r && r.status !== "needs_approval") this.applyAgentResult(state, n, r);
      }
    }

    for (let wave = 0; wave < this.graph.nodes.length + 1; wave++) {
      const ready = this.readyNodes(state);
      if (ready.length === 0) break;
      for (let i = 0; i < ready.length; i += limit) {
        await Promise.all(ready.slice(i, i + limit).map((n) => this.execute(state, n)));
      }
      // A failed node without continueOnError stops the run.
      if (Object.values(state.nodes).some((n) => n.status === "failed")) break;
    }

    const statuses = Object.values(state.nodes).map((n) => n.status);
    let status: RunStatus;
    if (statuses.includes("failed")) {
      status = "failed";
      // Nothing else will run: make that explicit for the UI and logs.
      for (const ns of Object.values(state.nodes)) if (ns.status === "pending") ns.status = "skipped";
    }
    else if (statuses.includes("waiting")) status = "waiting";
    else if (statuses.some((s) => s === "pending" || s === "running")) status = "running";
    else status = "completed";

    if (status === "completed") {
      const out: Record<string, unknown> = {};
      for (const n of this.graph.nodes) {
        if (n.type === "end" && state.nodes[n.id]!.status === "succeeded") Object.assign(out, state.nodes[n.id]!.output as object);
      }
      state.output = out;
    }
    const wakes = Object.values(state.nodes)
      .map((n) => (n.status === "waiting" && n.wait?.kind === "delay" ? n.wait.until : null))
      .filter((x): x is string => x !== null)
      .sort();
    return { state, status, nextWakeAt: wakes[0] ?? null };
  }

  private finish(state: RunState, node: WorkflowNode, status: "succeeded" | "failed", output?: unknown, error?: string) {
    const ns = state.nodes[node.id]!;
    ns.status = status;
    ns.output = output;
    ns.error = error;
    ns.finishedAt = this.now().toISOString();
    delete ns.wait;
    if (status === "failed") this.settleEdges(state, node.id, "none");
    else if (node.type === "condition") this.settleEdges(state, node.id, { handle: (output as { result: boolean }).result ? "true" : "false" });
    else this.settleEdges(state, node.id, "all");
    void this.deps.onNodeFinished?.(node.id, ns);
  }

  private applyAgentResult(state: RunState, node: WorkflowNode, r: AgentNodeResult) {
    const ns = state.nodes[node.id]!;
    const output = { status: r.status, text: r.output, structured: r.structured ?? null, agentRunId: r.agentRunId };
    if (r.status === "needs_approval") {
      ns.status = "waiting";
      ns.output = output;
      ns.wait = { kind: "agent_run", agentRunId: r.agentRunId };
      ns.logs.push("Waiting for approval of an agent action");
      return;
    }
    if (r.status === "failed" || r.status === "blocked") {
      const data = node.data as { continueOnError?: boolean };
      if (data.continueOnError) this.finish(state, node, "succeeded", { ...output, error: r.error ?? r.status });
      else this.finish(state, node, "failed", output, r.error ?? `Agent ${r.status}`);
      return;
    }
    this.finish(state, node, "succeeded", output);
  }

  private async execute(state: RunState, node: WorkflowNode): Promise<void> {
    const ns = state.nodes[node.id]!;
    ns.status = "running";
    ns.startedAt = this.now().toISOString();
    const scope = this.scope(state);
    const sleep = this.deps.sleep ?? defaultSleep;
    const type = node.type as NodeType;

    switch (type) {
      case "start":
        return this.finish(state, node, "succeeded", state.input);
      case "parallel":
        return this.finish(state, node, "succeeded", {});
      case "end": {
        const data = nodeDataSchemas.end.parse(node.data);
        return this.finish(state, node, "succeeded", resolveDeep(data.output, scope));
      }
      case "condition": {
        const data = nodeDataSchemas.condition.parse(node.data);
        const result = evaluateCondition(data, scope);
        ns.logs.push(`Condition evaluated to ${result}`);
        return this.finish(state, node, "succeeded", { result });
      }
      case "approval": {
        const data = nodeDataSchemas.approval.parse(node.data);
        const approvalKey = `${state.runId}:${node.id}`;
        ns.status = "waiting";
        ns.wait = { kind: "approval", approvalKey };
        const expiresAt = data.timeoutHours ? new Date(this.now().getTime() + data.timeoutHours * 3_600_000).toISOString() : null;
        const request = {
          title: String(resolveTemplate(data.title, scope)),
          instructions: String(resolveTemplate(data.instructions, scope)),
          payload: resolveTemplate(data.payload, scope),
        };
        ns.input = redactSecretsDeep(request);
        await this.deps.requestApproval?.({ runId: state.runId, nodeId: node.id, approvalKey, ...request, expiresAt });
        ns.logs.push("Waiting for human approval");
        return;
      }
      case "delay": {
        const data = nodeDataSchemas.delay.parse(node.data);
        if (data.seconds <= (this.deps.inlineDelaySeconds ?? 5)) {
          await sleep(data.seconds * 1000);
          return this.finish(state, node, "succeeded", { waitedSeconds: data.seconds });
        }
        ns.status = "waiting";
        ns.wait = { kind: "delay", until: new Date(this.now().getTime() + data.seconds * 1000).toISOString() };
        ns.logs.push(`Waiting until ${ns.wait.until}`);
        return;
      }
      case "agent":
      case "tool":
      case "webhook":
        return this.executeWithRetry(state, node, scope);
    }
  }

  private async executeWithRetry(state: RunState, node: WorkflowNode, scope: TemplateScope) {
    const ns = state.nodes[node.id]!;
    const data = nodeDataSchemas[node.type as "agent" | "tool" | "webhook"].parse(node.data);
    const sleep = this.deps.sleep ?? defaultSleep;
    let lastError = "Unknown error";

    for (let attempt = 1; attempt <= data.retry.maxAttempts; attempt++) {
      ns.attempts = attempt;
      try {
        if (node.type === "agent") {
          const d = data as NodeData<"agent">;
          const message = String(resolveTemplate(d.message, scope));
          ns.input = redactSecretsDeep({ agentId: d.agentId, message });
          const r = await withTimeout(d.timeoutMs, (signal) => this.deps.runAgent({ agentId: d.agentId, message, runId: state.runId, nodeId: node.id, signal }));
          if (r.status === "failed" && attempt < d.retry.maxAttempts) throw new Error(r.error ?? "Agent failed");
          ns.logs.push(`Attempt ${attempt}: agent ${r.status}`);
          return this.applyAgentResult(state, node, r);
        }
        if (node.type === "tool") {
          const d = data as NodeData<"tool">;
          const args = resolveDeep(d.args, scope) as Record<string, unknown>;
          ns.input = redactSecretsDeep({ tool: d.tool, args });
          const out = await withTimeout(d.timeoutMs, (signal) => this.deps.runTool({ tool: d.tool, args, runId: state.runId, nodeId: node.id, signal }));
          ns.logs.push(`Attempt ${attempt}: tool ${d.tool} ok`);
          return this.finish(state, node, "succeeded", redactSecretsDeep(out));
        }
        const d = data as NodeData<"webhook">;
        // Headers are never recorded: they may carry resolved {{secret:…}} values.
        ns.input = redactSecretsDeep({ method: d.method, url: String(resolveTemplate(d.url, scope)), body: d.method !== "GET" && d.body ? resolveTemplate(d.body, scope) : undefined });
        const out = await withTimeout(d.timeoutMs, () => this.callWebhook(d, scope));
        ns.logs.push(`Attempt ${attempt}: ${d.method} → HTTP ${out.status}`);
        return this.finish(state, node, "succeeded", out);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        ns.logs.push(`Attempt ${attempt} failed: ${lastError.slice(0, 300)}`);
        if (attempt < data.retry.maxAttempts) await sleep(data.retry.backoffMs * 2 ** (attempt - 1));
      }
    }
    if (data.continueOnError) return this.finish(state, node, "succeeded", { error: lastError });
    return this.finish(state, node, "failed", undefined, lastError);
  }

  private async callWebhook(d: NodeData<"webhook">, scope: TemplateScope) {
    const url = String(resolveTemplate(d.url, scope));
    const headers: Record<string, string> = { "user-agent": "DigitalizaTusNegocios-Workflows/1.0" };
    for (const [k, v] of Object.entries(d.headers)) {
      const resolved = String(resolveTemplate(v, scope));
      headers[k.toLowerCase()] = this.deps.getSecret ? await resolveSecrets(resolved, this.deps.getSecret) : resolved;
    }
    let body: string | undefined;
    if (d.method !== "GET" && d.body) {
      const resolved = resolveTemplate(d.body, scope);
      body = typeof resolved === "string" ? resolved : JSON.stringify(resolved);
      headers["content-type"] ??= "application/json";
    }
    const res = await safeFetch(url, { ...this.deps.outbound, method: d.method, headers, body, maxBytes: 1024 * 1024, timeoutMs: d.timeoutMs, fetchImpl: this.deps.fetchImpl });
    const text = res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    return { status: res.status, body: json ?? text.slice(0, 10_000) };
  }
}

export { getPath };
