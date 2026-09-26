import {
  BUILTIN_TOOLS,
  executeTool,
  initRunState,
  validateWorkflowGraph,
  WorkflowEngine,
  type AgentNodeResult,
  type EngineDeps,
  type NodeState,
  type RunState,
  type ToolDefinition,
  type WorkflowGraph,
} from "@dtn/core";
import { runAgent, assertOrgActive, NotFoundError, type RunAgentParams } from "./agents";
import { enqueueJob } from "./jobs";
import { secretResolver } from "./secrets";
import type { Queryable } from "./pool";

/**
 * Workflow service (service role; every query is scoped by organization_id).
 */

export class WorkflowValidationError extends Error {
  readonly status = 400;
  constructor(readonly issues: { nodeId?: string; edgeId?: string; message: string }[]) {
    super(`Invalid workflow: ${issues.map((i) => i.message).join("; ")}`);
    this.name = "WorkflowValidationError";
  }
}

export const DEFAULT_GRAPH: WorkflowGraph = {
  nodes: [
    { id: "start", type: "start", position: { x: 80, y: 160 }, data: { label: "Inicio", inputSchema: null } },
    { id: "end", type: "end", position: { x: 480, y: 160 }, data: { label: "Fin", output: {} } },
  ],
  edges: [{ id: "start-end", source: "start", target: "end", sourceHandle: null }],
};

export interface WorkflowRow {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  status: "draft" | "active" | "archived";
  latest_version: number;
  published_version: number | null;
  created_at: string;
  updated_at: string;
}

const WF_COLS = "id, organization_id, name, description, status, latest_version, published_version, created_at, updated_at";

export function parseGraph(graph: unknown): WorkflowGraph {
  const { graph: g, issues } = validateWorkflowGraph(graph);
  if (!g) throw new WorkflowValidationError(issues);
  return g;
}

export async function listWorkflows(db: Queryable, organizationId: string): Promise<WorkflowRow[]> {
  const { rows } = await db.query<WorkflowRow>(
    `select ${WF_COLS} from public.workflows where organization_id = $1 and status <> 'archived' order by updated_at desc`,
    [organizationId],
  );
  return rows;
}

export async function getWorkflow(db: Queryable, organizationId: string, id: string): Promise<WorkflowRow> {
  const { rows } = await db.query<WorkflowRow>(`select ${WF_COLS} from public.workflows where id = $1 and organization_id = $2`, [id, organizationId]);
  if (!rows[0]) throw new NotFoundError("Workflow");
  return rows[0];
}

export async function getWorkflowGraph(db: Queryable, organizationId: string, workflowId: string, version: number): Promise<WorkflowGraph> {
  const { rows } = await db.query<{ graph: WorkflowGraph }>(
    "select graph from public.workflow_versions where workflow_id = $1 and organization_id = $2 and version = $3",
    [workflowId, organizationId, version],
  );
  if (!rows[0]) throw new NotFoundError("Workflow version");
  return rows[0].graph;
}

export async function createWorkflow(
  db: Queryable,
  organizationId: string,
  input: { name: string; description?: string; graph?: unknown; templateKey?: string | null },
  userId?: string | null,
): Promise<WorkflowRow> {
  await assertOrgActive(db, organizationId);
  // Templates may reference agents that do not exist yet: store as-is, validate on publish.
  const graph = input.graph ?? DEFAULT_GRAPH;
  const { rows } = await db.query<WorkflowRow>(
    `insert into public.workflows (organization_id, name, description, latest_version, template_key, created_by)
     values ($1, $2, $3, 1, $4, $5) returning ${WF_COLS}`,
    [organizationId, input.name, input.description ?? "", input.templateKey ?? null, userId ?? null],
  );
  await db.query("insert into public.workflow_versions (organization_id, workflow_id, version, graph, created_by) values ($1, $2, 1, $3, $4)", [
    organizationId,
    rows[0]!.id,
    graph,
    userId ?? null,
  ]);
  return rows[0]!;
}

/** Saves a new immutable version. Drafts may be incomplete; publishing validates. */
export async function saveWorkflowVersion(
  db: Queryable,
  organizationId: string,
  workflowId: string,
  graph: unknown,
  opts: { userId?: string | null; note?: string; name?: string; description?: string } = {},
): Promise<{ version: number; issues: ReturnType<typeof validateWorkflowGraph>["issues"] }> {
  const { issues } = validateWorkflowGraph(graph);
  const { rows } = await db.query<{ latest_version: number }>(
    `update public.workflows set latest_version = latest_version + 1,
       name = coalesce($3, name), description = coalesce($4, description)
     where id = $1 and organization_id = $2 and status <> 'archived' returning latest_version`,
    [workflowId, organizationId, opts.name ?? null, opts.description ?? null],
  );
  if (!rows[0]) throw new NotFoundError("Workflow");
  const version = rows[0].latest_version;
  await db.query(
    "insert into public.workflow_versions (organization_id, workflow_id, version, graph, note, created_by) values ($1, $2, $3, $4, $5, $6)",
    [organizationId, workflowId, version, graph, opts.note ?? null, opts.userId ?? null],
  );
  return { version, issues };
}

export async function publishWorkflow(db: Queryable, organizationId: string, workflowId: string, version?: number): Promise<WorkflowRow> {
  const wf = await getWorkflow(db, organizationId, workflowId);
  const v = version ?? wf.latest_version;
  const graph = parseGraph(await getWorkflowGraph(db, organizationId, workflowId, v));
  await assertAgentsBelongToOrg(db, organizationId, graph);
  const { rows } = await db.query<WorkflowRow>(
    `update public.workflows set published_version = $3, status = 'active' where id = $1 and organization_id = $2 returning ${WF_COLS}`,
    [workflowId, organizationId, v],
  );
  return rows[0]!;
}

/** Agent nodes may only reference agents of the same organization. */
async function assertAgentsBelongToOrg(db: Queryable, organizationId: string, graph: WorkflowGraph) {
  const ids = [...new Set(graph.nodes.filter((n) => n.type === "agent").map((n) => String(n.data.agentId)))];
  if (!ids.length) return;
  const { rows } = await db.query<{ id: string }>(
    "select id from public.agents where organization_id = $1 and id = any($2::uuid[]) and status <> 'archived'",
    [organizationId, ids],
  );
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw new WorkflowValidationError(missing.map((id) => ({ message: `Agent ${id} does not exist in this organization` })));
}

export async function startWorkflowRun(
  db: Queryable,
  organizationId: string,
  workflowId: string,
  input: Record<string, unknown>,
  opts: { trigger?: "manual" | "api" | "webhook" | "schedule" | "event"; userId?: string | null; version?: number; allowDraft?: boolean } = {},
): Promise<{ runId: string; version: number }> {
  await assertOrgActive(db, organizationId);
  const wf = await getWorkflow(db, organizationId, workflowId);
  const version = opts.version ?? (opts.allowDraft ? wf.latest_version : wf.published_version);
  if (!version || wf.status === "archived") throw new NotFoundError("Published workflow");
  const graph = parseGraph(await getWorkflowGraph(db, organizationId, workflowId, version));
  await assertAgentsBelongToOrg(db, organizationId, graph);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.workflow_runs (organization_id, workflow_id, version, trigger, input, created_by)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [organizationId, workflowId, version, opts.trigger ?? "manual", input, opts.userId ?? null],
  );
  const runId = rows[0]!.id;
  const state = initRunState(graph, runId, input);
  await db.query("update public.workflow_runs set state = $2 where id = $1", [runId, state]);
  await enqueueJob(db, { type: "workflow.advance", organizationId, payload: { runId }, dedupeKey: `workflow.advance:${runId}` });
  return { runId, version };
}

export interface WorkflowRuntimeOptions {
  /** Extra tools available to TOOL nodes (tests / integrations). */
  extraTools?: ToolDefinition[];
  agentRuntime?: RunAgentParams["runtime"];
  getSecret?: (organizationId: string, name: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  allowInsecureOutbound?: boolean;
}

function engineDeps(db: Queryable, organizationId: string, runId: string, graph: WorkflowGraph, opts: WorkflowRuntimeOptions): EngineDeps {
  opts = { ...opts, getSecret: opts.getSecret ?? secretResolver(db) };
  const nodeTypes = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const tools = new Map([...BUILTIN_TOOLS, ...(opts.extraTools ?? [])].map((t) => [t.name, t]));
  return {
    runAgent: async ({ agentId, message, nodeId }) => {
      const { runId: agentRunId, result } = await runAgent({
        db,
        organizationId,
        agentId,
        message,
        source: "workflow",
        allowInactive: true,
        workflowRunId: runId,
        workflowNodeId: nodeId,
        runtime: opts.agentRuntime,
      });
      return { status: result.status, output: result.output, structured: result.structured ?? null, agentRunId, error: result.error };
    },
    getAgentRun: async (agentRunId) => {
      const { rows } = await db.query<{ status: string; output: string | null; structured: Record<string, unknown> | null; error: string | null }>(
        "select status, output, structured, error from public.agent_runs where id = $1 and organization_id = $2",
        [agentRunId, organizationId],
      );
      const r = rows[0];
      if (!r || r.status === "needs_approval" || r.status === "running") return null;
      return { status: r.status as AgentNodeResult["status"], output: r.output ?? "", structured: r.structured, agentRunId, error: r.error ?? undefined };
    },
    runTool: async ({ tool, args, signal }) => {
      const def = tools.get(tool);
      if (!def) throw new Error(`Tool "${tool}" is not available`);
      return executeTool(def, args, { organizationId, workflowRunId: runId, getSecret: opts.getSecret ? (n) => opts.getSecret!(organizationId, n) : undefined }, signal);
    },
    getSecret: opts.getSecret ? (name) => opts.getSecret!(organizationId, name) : async () => null,
    requestApproval: async (p) => {
      await db.query(
        `insert into public.approvals (organization_id, approval_key, workflow_run_id, node_id, title, instructions, payload, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (approval_key) do nothing`,
        [organizationId, p.approvalKey, runId, p.nodeId, p.title.slice(0, 200), p.instructions.slice(0, 5000), JSON.stringify(p.payload ?? null), p.expiresAt],
      );
    },
    onNodeFinished: async (nodeId, ns: NodeState) => {
      await db.query(
        `insert into public.workflow_step_runs (organization_id, run_id, node_id, node_type, status, attempts, output, error, logs, started_at, finished_at)
         values ($1, $2, $3, $11, $4, $5, $6, $7, $8, $9, $10)
         on conflict (run_id, node_id) do update set status = excluded.status, attempts = excluded.attempts, output = excluded.output,
           error = excluded.error, logs = excluded.logs, finished_at = excluded.finished_at`,
        [organizationId, runId, nodeId, ns.status, ns.attempts, JSON.stringify(ns.output ?? null), ns.error ?? null, ns.logs, ns.startedAt ?? null, ns.finishedAt ?? null, nodeTypes.get(nodeId) ?? "unknown"],
      );
    },
    outbound: { allowInsecure: opts.allowInsecureOutbound ?? false },
    fetchImpl: opts.fetchImpl,
    now: opts.now,
  };
}

interface RunRow {
  id: string;
  organization_id: string;
  workflow_id: string;
  version: number;
  status: string;
  state: RunState;
  state_version: number;
}

async function loadRun(db: Queryable, runId: string, organizationId?: string): Promise<RunRow> {
  const { rows } = await db.query<RunRow>(
    `select id, organization_id, workflow_id, version, status, state, state_version from public.workflow_runs
     where id = $1 and ($2::uuid is null or organization_id = $2)`,
    [runId, organizationId ?? null],
  );
  if (!rows[0]) throw new NotFoundError("Workflow run");
  return rows[0];
}

export class ConcurrentUpdateError extends Error {
  constructor() {
    super("Workflow run was updated concurrently");
    this.name = "ConcurrentUpdateError";
  }
}

/**
 * Advances a run as far as possible (worker job "workflow.advance").
 * The state write is a compare-and-set on state_version; on conflict the job
 * fails and is retried against the fresh state.
 */
export async function advanceWorkflowRun(db: Queryable, runId: string, opts: WorkflowRuntimeOptions = {}) {
  const run = await loadRun(db, runId);
  if (["completed", "failed", "cancelled"].includes(run.status)) return { status: run.status, skipped: true };
  const org = await db.query<{ status: string }>("select status from public.organizations where id = $1", [run.organization_id]);
  if (org.rows[0]?.status !== "active") {
    await db.query("update public.workflow_runs set status = 'failed', error = 'Organization suspended', finished_at = now() where id = $1", [runId]);
    return { status: "failed", skipped: false };
  }
  const graph = parseGraph(await getWorkflowGraph(db, run.organization_id, run.workflow_id, run.version));
  const engine = new WorkflowEngine(graph, engineDeps(db, run.organization_id, runId, graph, opts));
  if (run.status === "queued") await db.query("update public.workflow_runs set status = 'running', started_at = now() where id = $1", [runId]);

  const { state, status, nextWakeAt } = await engine.advance(run.state);
  const failed = Object.entries(state.nodes).find(([, n]) => n.status === "failed");
  const res = await db.query(
    `update public.workflow_runs set state = $3, state_version = state_version + 1, status = $4, output = $5, error = $6,
       next_wake_at = $7, finished_at = case when $4 in ('completed', 'failed') then now() else null end
     where id = $1 and state_version = $2`,
    [runId, run.state_version, state, status, state.output ?? null, failed ? `${failed[0]}: ${failed[1].error ?? "failed"}` : null, nextWakeAt],
  );
  if (!res.rowCount) throw new ConcurrentUpdateError();
  return { status, skipped: false };
}

/** Applies a reviewer decision to a workflow approval, then schedules the run to continue. */
export async function decideApproval(
  db: Queryable,
  organizationId: string,
  approvalId: string,
  decision: { approved: boolean; userId?: string | null; note?: string },
) {
  await assertOrgActive(db, organizationId);
  const { rows } = await db.query<{ workflow_run_id: string; node_id: string }>(
    `update public.approvals set status = $3, decided_by = $4, decided_at = now(), note = $5
     where id = $1 and organization_id = $2 and status = 'pending' and (expires_at is null or expires_at > now())
     returning workflow_run_id, node_id`,
    [approvalId, organizationId, decision.approved ? "approved" : "rejected", decision.userId ?? null, decision.note ?? null],
  );
  const approval = rows[0];
  if (!approval) throw new NotFoundError("Pending approval");
  await applyDecisionToRun(db, organizationId, approval.workflow_run_id, approval.node_id, decision);
}

async function applyDecisionToRun(
  db: Queryable,
  organizationId: string,
  runId: string,
  nodeId: string,
  decision: { approved: boolean; userId?: string | null; note?: string },
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const run = await loadRun(db, runId, organizationId);
    const graph = parseGraph(await getWorkflowGraph(db, organizationId, run.workflow_id, run.version));
    const next = new WorkflowEngine(graph, { runAgent: async () => Promise.reject(new Error("unused")), runTool: async () => null }).decide(run.state, {
      nodeId,
      approved: decision.approved,
      by: decision.userId ?? undefined,
      note: decision.note,
    });
    const res = await db.query("update public.workflow_runs set state = $3, state_version = state_version + 1 where id = $1 and state_version = $2", [
      runId,
      run.state_version,
      next,
    ]);
    if (res.rowCount) {
      await enqueueJob(db, { type: "workflow.advance", organizationId, payload: { runId }, dedupeKey: `workflow.advance:${runId}` });
      return;
    }
  }
  throw new ConcurrentUpdateError();
}

/** Scheduler tick: wakes runs whose delay elapsed and expires stale approvals. */
export async function wakeDueRuns(db: Queryable): Promise<number> {
  const expired = await db.query<{ id: string; organization_id: string; workflow_run_id: string; node_id: string }>(
    `update public.approvals set status = 'expired', decided_at = now()
     where status = 'pending' and expires_at is not null and expires_at <= now()
     returning id, organization_id, workflow_run_id, node_id`,
  );
  for (const a of expired.rows) {
    await applyDecisionToRun(db, a.organization_id, a.workflow_run_id, a.node_id, { approved: false, note: "Approval expired" }).catch(() => undefined);
  }
  const { rows } = await db.query<{ id: string; organization_id: string }>(
    "select id, organization_id from public.workflow_runs where status = 'waiting' and next_wake_at is not null and next_wake_at <= now() limit 500",
  );
  for (const r of rows) {
    await enqueueJob(db, { type: "workflow.advance", organizationId: r.organization_id, payload: { runId: r.id }, dedupeKey: `workflow.advance:${r.id}` });
  }
  return rows.length + expired.rows.length;
}

export async function cancelWorkflowRun(db: Queryable, organizationId: string, runId: string) {
  const res = await db.query(
    "update public.workflow_runs set status = 'cancelled', finished_at = now(), state_version = state_version + 1 where id = $1 and organization_id = $2 and status in ('queued', 'running', 'waiting')",
    [runId, organizationId],
  );
  if (!res.rowCount) throw new NotFoundError("Active workflow run");
  await db.query("update public.approvals set status = 'expired' where workflow_run_id = $1 and status = 'pending'", [runId]);
}
