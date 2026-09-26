import {
  effectiveLimits,
  LimitExceededError,
  PricingCatalog,
  type ModelPrice,
  type ProviderId,
  type ToolInvocationRecord,
  type UsageContext,
  type UsageRecord,
} from "@dtn/core";
import type { Queryable } from "./pool";
import { enforceLimit } from "./limits";

/** Persists one row per LLM call. Used as LLMRouter.onUsage. */
export function pgUsageSink(db: Queryable, requestId?: string) {
  return async (r: UsageRecord) => {
    await db.query(
      `insert into public.usage_events
        (organization_id, agent_id, workflow_id, workflow_run_id, conversation_id, purpose, provider, model,
         input_tokens, output_tokens, cost_usd, priced, latency_ms, success, error_code, request_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        r.organizationId,
        r.agentId ?? null,
        r.workflowId ?? null,
        r.workflowRunId ?? null,
        r.conversationId ?? null,
        r.purpose ?? "chat",
        r.provider,
        r.model,
        r.inputTokens,
        r.outputTokens,
        r.costUsd,
        r.priced,
        r.latencyMs,
        r.success,
        r.errorCode ?? null,
        requestId ?? null,
      ],
    );
  };
}

export async function recordToolInvocation(
  db: Queryable,
  ctx: { organizationId: string; agentId?: string; conversationId?: string; workflowRunId?: string },
  rec: ToolInvocationRecord,
) {
  await db.query(
    `insert into public.tool_invocations
      (organization_id, agent_id, conversation_id, workflow_run_id, tool_call_id, tool_name, status, args, result, error, duration_ms)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      ctx.organizationId,
      ctx.agentId ?? null,
      ctx.conversationId ?? null,
      ctx.workflowRunId ?? null,
      rec.toolCallId,
      rec.name,
      rec.status,
      JSON.stringify(rec.args ?? null),
      rec.result === undefined ? null : JSON.stringify(rec.result),
      rec.error ?? null,
      rec.durationMs,
    ],
  );
}

export async function loadPricing(db: Queryable): Promise<PricingCatalog> {
  const { rows } = await db.query<{ provider: ProviderId; model: string; input_per_mtok: string; output_per_mtok: string }>(
    `select provider, model, input_per_mtok, output_per_mtok from public.llm_models
     where input_per_mtok is not null and output_per_mtok is not null`,
  );
  return new PricingCatalog(
    rows.map<ModelPrice>((r) => ({
      provider: r.provider,
      model: r.model,
      inputPerMTok: Number(r.input_per_mtok),
      outputPerMTok: Number(r.output_per_mtok),
    })),
  );
}

export class OrganizationSuspendedError extends Error {
  readonly status = 403;
  constructor() {
    super("Organization is suspended");
    this.name = "OrganizationSuspendedError";
  }
}

export class BudgetExceededError extends LimitExceededError {}

/**
 * Pre-call gate (LLMRouter.beforeCall): blocks suspended tenants and enforces
 * monthly cost/token limits (plan limits + per-client overrides) and per-agent
 * monthly budgets. Totals are cached briefly to avoid a query per call.
 */
export class BudgetGuard {
  private cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private readonly db: Queryable,
    private readonly ttlMs = 15_000,
  ) {}

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  invalidate(organizationId?: string) {
    if (!organizationId) this.cache.clear();
    else for (const k of this.cache.keys()) if (k.includes(organizationId)) this.cache.delete(k);
  }

  check = async (ctx: UsageContext): Promise<void> => {
    const org = await this.cached(`org:${ctx.organizationId}`, async () => {
      const { rows } = await this.db.query<{ status: string; limits: unknown; plan_limits: unknown }>(
        `select o.status, o.limits, p.limits as plan_limits
         from public.organizations o left join public.plans p on p.code = o.plan_code where o.id = $1`,
        [ctx.organizationId],
      );
      return rows[0] ?? null;
    });
    if (!org) throw new Error("Unknown organization");
    if (org.status !== "active") throw new OrganizationSuspendedError();

    const limits = effectiveLimits(org.plan_limits, org.limits);
    if (limits.monthly_llm_cost_usd != null || limits.monthly_tokens != null) {
      const usage = await this.cached(`usage:${ctx.organizationId}`, async () => {
        const { rows } = await this.db.query<{ cost_usd: string; tokens: string }>("select * from app.month_usage($1)", [ctx.organizationId]);
        return { cost: Number(rows[0]?.cost_usd ?? 0), tokens: Number(rows[0]?.tokens ?? 0) };
      });
      // Honors the org policy: block, or raise an approval request for the admin.
      await enforceLimit(this.db, ctx.organizationId, "monthly_llm_cost_usd", limits.monthly_llm_cost_usd, usage.cost);
      await enforceLimit(this.db, ctx.organizationId, "monthly_tokens", limits.monthly_tokens, usage.tokens);
    }

    if (ctx.agentId) {
      const agent = await this.cached(`agent:${ctx.organizationId}:${ctx.agentId}`, async () => {
        const { rows } = await this.db.query<{ budget: string | null; status: string; spent: string }>(
          `select (a.config->'limits'->>'monthlyCostUsd') as budget, a.status,
             coalesce((select sum(u.cost_usd) from public.usage_events u
               where u.agent_id = a.id and u.organization_id = a.organization_id
                 and u.created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'), 0) as spent
           from public.agents a where a.id = $1 and a.organization_id = $2`,
          [ctx.agentId, ctx.organizationId],
        );
        return rows[0] ?? null;
      });
      if (agent?.budget != null && Number(agent.spent) >= Number(agent.budget)) {
        throw new BudgetExceededError("monthly_llm_cost_usd", Number(agent.budget), Number(agent.spent));
      }
    }
  };
}
