import { createHash, randomBytes } from "node:crypto";
import {
  agentConfigSchema,
  checkLimit,
  effectiveLimits,
  LimitExceededError,
  type AgentConfig,
  type AgentRunResult,
  type AgentRunState,
  type ChatMessage,
} from "@dtn/core";
import type { Queryable } from "./pool";
import { createAgentRuntime, type RuntimeFactoryOptions } from "./runtime-factory";
import { OrganizationSuspendedError } from "./usage";

/**
 * Agent service for trusted server code (API routes, worker, playground).
 * Uses the service role, so EVERY query filters by organization_id.
 */

export interface AgentRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  name: string;
  description: string;
  status: "draft" | "active" | "paused" | "archived";
  template_key: string | null;
  config: AgentConfig;
  version: number;
  created_at: string;
  updated_at: string;
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

const AGENT_COLS = "id, organization_id, project_id, name, description, status, template_key, config, version, created_at, updated_at";

export async function assertOrgActive(db: Queryable, organizationId: string) {
  const { rows } = await db.query<{ status: string }>("select status from public.organizations where id = $1", [organizationId]);
  if (!rows[0]) throw new NotFoundError("Organization");
  if (rows[0].status !== "active") throw new OrganizationSuspendedError();
}

export async function listAgents(db: Queryable, organizationId: string): Promise<AgentRow[]> {
  const { rows } = await db.query<AgentRow>(
    `select ${AGENT_COLS} from public.agents where organization_id = $1 and status <> 'archived' order by created_at desc`,
    [organizationId],
  );
  return rows;
}

export async function getAgent(db: Queryable, organizationId: string, id: string): Promise<AgentRow> {
  const { rows } = await db.query<AgentRow>(`select ${AGENT_COLS} from public.agents where id = $1 and organization_id = $2`, [id, organizationId]);
  if (!rows[0]) throw new NotFoundError("Agent");
  return rows[0];
}

async function orgLimits(db: Queryable, organizationId: string) {
  const { rows } = await db.query<{ limits: unknown; plan_limits: unknown }>(
    `select o.limits, p.limits as plan_limits from public.organizations o left join public.plans p on p.code = o.plan_code where o.id = $1`,
    [organizationId],
  );
  return effectiveLimits(rows[0]?.plan_limits, rows[0]?.limits);
}

export async function createAgent(
  db: Queryable,
  organizationId: string,
  input: { name: string; description?: string; status?: AgentRow["status"]; templateKey?: string | null; config: unknown; projectId?: string | null },
  userId?: string | null,
): Promise<AgentRow> {
  await assertOrgActive(db, organizationId);
  const config = agentConfigSchema.parse({ ...(input.config as object), name: input.name });
  const { rows: count } = await db.query<{ n: number }>(
    "select count(*)::int n from public.agents where organization_id = $1 and status <> 'archived'",
    [organizationId],
  );
  const limit = checkLimit(await orgLimits(db, organizationId), "max_agents", count[0]!.n);
  if (!limit.allowed) throw new LimitExceededError("max_agents", limit.limit!, limit.used);
  const { rows } = await db.query<AgentRow>(
    `insert into public.agents (organization_id, project_id, name, description, status, template_key, config, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${AGENT_COLS}`,
    [organizationId, input.projectId ?? null, config.name, input.description ?? config.description, input.status ?? "draft", input.templateKey ?? null, config, userId ?? null],
  );
  return rows[0]!;
}

export async function updateAgent(
  db: Queryable,
  organizationId: string,
  id: string,
  patch: { name?: string; description?: string; status?: AgentRow["status"]; config?: unknown },
): Promise<AgentRow> {
  const current = await getAgent(db, organizationId, id);
  const config = patch.config !== undefined || patch.name !== undefined
    ? agentConfigSchema.parse({ ...(patch.config ?? current.config) as object, name: patch.name ?? current.name })
    : current.config;
  const { rows } = await db.query<AgentRow>(
    `update public.agents set name = $3, description = $4, status = $5, config = $6
     where id = $1 and organization_id = $2 returning ${AGENT_COLS}`,
    [id, organizationId, config.name, patch.description ?? current.description, patch.status ?? current.status, config],
  );
  return rows[0]!;
}

export async function archiveAgent(db: Queryable, organizationId: string, id: string): Promise<void> {
  const res = await db.query("update public.agents set status = 'archived' where id = $1 and organization_id = $2", [id, organizationId]);
  if (!res.rowCount) throw new NotFoundError("Agent");
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface RunAgentParams {
  db: Queryable;
  organizationId: string;
  agentId: string;
  message: string;
  history?: ChatMessage[];
  source: "playground" | "api" | "channel" | "workflow";
  userId?: string | null;
  conversationId?: string | null;
  variables?: Record<string, string>;
  runtime?: Omit<RuntimeFactoryOptions, "db">;
  /** Playground may run draft agents; channels/API only active ones. */
  allowInactive?: boolean;
}

export interface StoredRun {
  runId: string;
  result: AgentRunResult;
}

async function orgVariables(db: Queryable, organizationId: string): Promise<Record<string, string>> {
  const { rows } = await db.query<{ name: string; settings: Record<string, unknown> }>(
    "select name, settings from public.organizations where id = $1",
    [organizationId],
  );
  const vars: Record<string, string> = { company_name: rows[0]?.name ?? "" };
  const custom = rows[0]?.settings?.variables;
  if (custom && typeof custom === "object") {
    for (const [k, v] of Object.entries(custom)) if (typeof v === "string" && /^[a-zA-Z0-9_]{1,40}$/.test(k)) vars[k] = v.slice(0, 500);
  }
  return vars;
}

async function persistRun(db: Queryable, runId: string | null, p: { organizationId: string; agentId: string; version: number; source: string; input: string | null; userId?: string | null; conversationId?: string | null }, r: AgentRunResult) {
  const values = [
    r.status,
    r.output,
    r.structured ? JSON.stringify(r.structured) : null,
    r.state ? JSON.stringify(r.state) : null,
    r.pendingApproval ? JSON.stringify(r.pendingApproval) : null,
    JSON.stringify(r.sources.map((s) => ({ id: s.id, documentId: s.documentId, title: s.title, score: s.score }))),
    JSON.stringify(r.toolInvocations),
    JSON.stringify(r.usage),
    JSON.stringify(r.flags),
    r.error ?? null,
    r.model ?? null,
  ];
  if (runId) {
    await db.query(
      `update public.agent_runs set status=$3, output=$4, structured=$5, state=$6, pending_approval=$7, sources=$8,
         tool_invocations=$9, usage=$10, flags=$11, error=$12, model=$13 where id=$1 and organization_id=$2`,
      [runId, p.organizationId, ...values],
    );
    return runId;
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into public.agent_runs (organization_id, agent_id, agent_version, source, input, created_by, conversation_id,
       status, output, structured, state, pending_approval, sources, tool_invocations, usage, flags, error, model)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
    [p.organizationId, p.agentId, p.version, p.source, p.input, p.userId ?? null, p.conversationId ?? null, ...values],
  );
  return rows[0]!.id;
}

export async function runAgent(params: RunAgentParams): Promise<StoredRun> {
  const { db, organizationId } = params;
  await assertOrgActive(db, organizationId);
  const agent = await getAgent(db, organizationId, params.agentId);
  if (agent.status === "archived" || (!params.allowInactive && agent.status !== "active")) {
    throw new NotFoundError("Active agent");
  }
  const config = agentConfigSchema.parse(agent.config);
  const { runtime } = await createAgentRuntime({ db, ...params.runtime });
  const result = await runtime.run({
    organizationId,
    agentId: agent.id,
    conversationId: params.conversationId ?? undefined,
    userId: params.userId ?? undefined,
    config,
    message: params.message,
    history: params.history,
    variables: { ...(await orgVariables(db, organizationId)), ...(params.variables ?? {}) },
  });
  const runId = await persistRun(
    db,
    null,
    { organizationId, agentId: agent.id, version: agent.version, source: params.source, input: params.message, userId: params.userId, conversationId: params.conversationId },
    result,
  );
  return { runId, result };
}

/** Applies a human decision to a paused run and continues it. */
export async function resumeAgentRun(params: {
  db: Queryable;
  organizationId: string;
  runId: string;
  approved: boolean;
  note?: string;
  userId?: string | null;
  runtime?: Omit<RuntimeFactoryOptions, "db">;
}): Promise<StoredRun> {
  const { db, organizationId, runId } = params;
  await assertOrgActive(db, organizationId);
  // Lock the row: two reviewers clicking at once must not execute twice.
  const { rows } = await db.query<{ agent_id: string; state: AgentRunState; pending_approval: { toolCallId: string }; source: string; conversation_id: string | null }>(
    `update public.agent_runs set status = 'running', decided_by = $3, decided_at = now()
     where id = $1 and organization_id = $2 and status = 'needs_approval'
     returning agent_id, state, pending_approval, source, conversation_id`,
    [runId, organizationId, params.userId ?? null],
  );
  const run = rows[0];
  if (!run) throw new NotFoundError("Pending run");
  const agent = await getAgent(db, organizationId, run.agent_id);
  let result: AgentRunResult;
  try {
    const { runtime } = await createAgentRuntime({ db, ...params.runtime });
    result = await runtime.run({
      organizationId,
      agentId: agent.id,
      conversationId: run.conversation_id ?? undefined,
      config: agentConfigSchema.parse(agent.config),
      resume: { state: run.state, decision: { toolCallId: run.pending_approval.toolCallId, approved: params.approved, note: params.note } },
    });
  } catch (e) {
    // Never leave a run stuck in "running".
    await db.query("update public.agent_runs set status = 'failed', error = $3, state = null where id = $1 and organization_id = $2", [
      runId,
      organizationId,
      (e as Error).message.slice(0, 500),
    ]);
    throw e;
  }
  await persistRun(db, runId, { organizationId, agentId: agent.id, version: agent.version, source: run.source, input: null }, result);
  return { runId, result };
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export const API_SCOPES = [
  "agents:read",
  "agents:write",
  "agents:run",
  "workflows:read",
  "workflows:write",
  "workflows:run",
  "conversations:read",
  "conversations:write",
  "knowledge:read",
  "knowledge:write",
  "leads:read",
  "leads:write",
  "tasks:read",
  "tasks:write",
  "integrations:read",
  "usage:read",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = `dtn_${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export interface ApiPrincipal {
  keyId: string;
  organizationId: string;
  scopes: ApiScope[];
}

export async function verifyApiKey(db: Queryable, key: string): Promise<ApiPrincipal | null> {
  if (!/^dtn_[A-Za-z0-9_-]{43}$/.test(key)) return null;
  const { rows } = await db.query<{ id: string; organization_id: string; scopes: ApiScope[] }>(
    `update public.api_keys k set last_used_at = now()
     from public.organizations o
     where k.key_hash = $1 and o.id = k.organization_id and o.status = 'active'
       and k.revoked_at is null and (k.expires_at is null or k.expires_at > now())
     returning k.id, k.organization_id, k.scopes`,
    [hashApiKey(key)],
  );
  const r = rows[0];
  return r ? { keyId: r.id, organizationId: r.organization_id, scopes: r.scopes } : null;
}

export async function rateLimitHit(db: Queryable, key: string, windowSeconds: number, max: number): Promise<boolean> {
  const { rows } = await db.query<{ allowed: boolean }>("select app.rate_limit_hit($1, $2, $3) as allowed", [key, windowSeconds, max]);
  return rows[0]!.allowed;
}
