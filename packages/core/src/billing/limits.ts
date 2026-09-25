import { z } from "zod";

/**
 * Limit keys shared by plans.limits and organizations.limits (per-client
 * override). A missing key or null means "unlimited".
 */
export const LIMIT_KEYS = {
  monthly_llm_cost_usd: "Coste LLM mensual máximo (USD)",
  monthly_tokens: "Tokens mensuales",
  max_agents: "Agentes",
  max_workflows: "Workflows",
  max_workflow_runs_per_month: "Ejecuciones de workflow/mes",
  max_knowledge_bases: "Knowledge bases",
  max_documents: "Documentos",
  max_storage_mb: "Almacenamiento (MB)",
  max_monthly_conversations: "Conversaciones/mes",
  max_members: "Usuarios",
  max_integrations: "Integraciones",
  requests_per_minute: "Peticiones API por minuto",
} as const;

export type LimitKey = keyof typeof LIMIT_KEYS;
export type Limits = Partial<Record<LimitKey, number | null>>;

export const limitsSchema = z
  .object(
    Object.fromEntries(Object.keys(LIMIT_KEYS).map((k) => [k, z.number().nonnegative().nullable().optional()])) as Record<
      LimitKey,
      z.ZodOptional<z.ZodNullable<z.ZodNumber>>
    >,
  )
  .strict();

/** Effective limits: organization overrides win over the plan. */
export function effectiveLimits(planLimits: unknown, orgOverrides: unknown): Limits {
  const plan = limitsSchema.safeParse(planLimits ?? {});
  const org = limitsSchema.safeParse(orgOverrides ?? {});
  return { ...(plan.success ? plan.data : {}), ...(org.success ? org.data : {}) };
}

export interface LimitCheck {
  allowed: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
}

export function checkLimit(limits: Limits, key: LimitKey, used: number, increment = 1): LimitCheck {
  const limit = limits[key];
  if (limit === undefined || limit === null) return { allowed: true, limit: null, used, remaining: null };
  return { allowed: used + increment <= limit, limit, used, remaining: Math.max(0, limit - used) };
}

export class LimitExceededError extends Error {
  readonly status = 402;
  constructor(
    readonly key: LimitKey,
    readonly limit: number,
    readonly used: number,
  ) {
    super(`Limit exceeded: ${key} (${used}/${limit})`);
    this.name = "LimitExceededError";
  }
}
