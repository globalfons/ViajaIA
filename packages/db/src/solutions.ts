import { getSolution, parseAgentConfig, getAgentTemplate, type SolutionDefinition } from "@dtn/core";
import pg from "pg";
import { assertOrgActive, createAgent } from "./agents";
import { createChannel } from "./conversations";
import { createKnowledgeBase } from "./knowledge";
import type { Queryable } from "./pool";
import { createWorkflow, publishWorkflow } from "./workflows";

export class SolutionError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "SolutionError";
  }
}

export interface ActivateInput {
  solutionKey: string;
  model: string;
  embeddingModel?: string | null;
  config: Record<string, string>;
  name?: string;
  createChannel?: boolean;
  allowedOrigins?: string[];
}

export interface ActivationResult {
  instanceId: string;
  agentIds: string[];
  knowledgeBaseId: string | null;
  workflowId: string | null;
  channelId: string | null;
  channelKey: string | null;
}

/** Requirement check shown before activation (models available, required fields). */
export async function checkSolutionRequirements(db: Queryable, solution: SolutionDefinition, input: Pick<ActivateInput, "model" | "embeddingModel" | "config">) {
  const problems: string[] = [];
  const models = await db.query<{ ref: string; kind: string }>("select provider || ':' || model as ref, kind from public.llm_models where enabled");
  const chat = new Set(models.rows.filter((m) => m.kind === "chat").map((m) => m.ref));
  const emb = new Set(models.rows.filter((m) => m.kind === "embedding").map((m) => m.ref));
  if (!chat.has(input.model)) problems.push("El modelo de chat no está activo en la plataforma");
  if (solution.knowledgeBase && !(input.embeddingModel && emb.has(input.embeddingModel))) problems.push("Falta un modelo de embeddings activo");
  for (const f of solution.config) if (f.required && !input.config[f.key]?.trim()) problems.push(`Falta «${f.label}»`);
  return problems;
}

/** Context block added to the agent prompt; values resolve at runtime from organization variables. */
function contextBlock(solution: SolutionDefinition): string {
  const lines = solution.config.map((f) => `- ${f.label}: {{${f.key}}}`);
  return lines.length ? `\n\n## Sobre el negocio\n${lines.join("\n")}` : "";
}

/**
 * Provisions a solution for an organization in ONE transaction:
 * variables → knowledge base → agents → workflow (published) → channel → instance.
 */
export async function activateSolution(pool: pg.Pool, organizationId: string, input: ActivateInput, userId?: string | null): Promise<ActivationResult> {
  const solution = getSolution(input.solutionKey);
  if (!solution) throw new SolutionError("Unknown solution");
  const config = Object.fromEntries(
    solution.config.map((f) => [f.key, String(input.config[f.key] ?? "").trim().slice(0, f.type === "textarea" ? 2000 : 300)]),
  );
  const client = await pool.connect();
  try {
    await client.query("begin");
    await assertOrgActive(client, organizationId);
    const problems = await checkSolutionRequirements(client, solution, { ...input, config });
    if (problems.length) throw new SolutionError(problems.join(" · "));

    // Per-client customization lives in organization variables (used as {{key}} in prompts).
    const nonEmpty = Object.fromEntries(Object.entries(config).filter(([, v]) => v));
    await client.query(
      `update public.organizations set settings = jsonb_set(settings, '{variables}', coalesce(settings->'variables', '{}'::jsonb) || $2::jsonb) where id = $1`,
      [organizationId, JSON.stringify(nonEmpty)],
    );

    const label = input.name?.trim().slice(0, 100) || solution.name;
    const kb = solution.knowledgeBase
      ? await createKnowledgeBase(client, organizationId, { name: `${label} · Documentación`, embeddingModel: input.embeddingModel!, description: solution.tagline }, userId)
      : null;

    const agentIds: Record<string, string> = {};
    for (const a of solution.agents) {
      const tpl = getAgentTemplate(a.templateKey)!;
      const cfg = parseAgentConfig({
        ...tpl.config,
        name: `${a.name} · ${label}`.slice(0, 120),
        model: input.model,
        systemPrompt: `${tpl.config.systemPrompt ?? ""}${contextBlock(solution)}`,
        knowledgeBaseIds: kb ? [kb.id] : [],
        tools: solution.tools.length ? solution.tools : tpl.config.tools,
      });
      const agent = await createAgent(client, organizationId, { name: cfg.name, status: "active", templateKey: tpl.key, config: cfg }, userId);
      agentIds[a.role] = agent.id;
    }

    let workflowId: string | null = null;
    if (solution.workflow) {
      const wf = await createWorkflow(client, organizationId, { name: `${solution.workflow.name} · ${label}`.slice(0, 120), description: solution.workflow.description, graph: solution.workflow.build(agentIds), templateKey: solution.templateId }, userId);
      await publishWorkflow(client, organizationId, wf.id);
      workflowId = wf.id;
    }

    let channel: { id: string; public_key: string | null } | null = null;
    if (solution.provisionChannel === "web" && input.createChannel !== false) {
      channel = await createChannel(client, organizationId, { type: "web", name: `Chat web · ${label}`.slice(0, 120), agentId: Object.values(agentIds)[0]!, allowedOrigins: input.allowedOrigins ?? [] }, userId);
    }

    const { rows } = await client.query<{ id: string }>(
      `insert into public.solution_instances (organization_id, solution_key, template_id, version, name, config, agent_ids, knowledge_base_id, workflow_id, channel_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [organizationId, solution.key, solution.templateId, solution.version, label, config, Object.values(agentIds), kb?.id ?? null, workflowId, channel?.id ?? null, userId ?? null],
    );
    await client.query("commit");
    return { instanceId: rows[0]!.id, agentIds: Object.values(agentIds), knowledgeBaseId: kb?.id ?? null, workflowId, channelId: channel?.id ?? null, channelKey: channel?.public_key ?? null };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
