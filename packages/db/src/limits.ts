import { LimitExceededError, type LimitKey } from "@dtn/core";
import type { Queryable } from "./pool";

/**
 * Limit enforcement shared by LLM calls (cost, tokens) and executions
 * (workflow runs). Honors the organization's policy:
 *  - block: throw LimitExceededError.
 *  - require_approval: raise one pending request per limit and month and
 *    throw LimitApprovalRequiredError until the platform admin grants extra headroom.
 */
export class LimitApprovalRequiredError extends LimitExceededError {
  constructor(key: LimitKey, limit: number, used: number) {
    super(key, limit, used);
    this.name = "LimitApprovalRequiredError";
    this.message = `Limit reached: ${key} (${used}/${limit}). Waiting for administrator approval.`;
  }
}

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
};

export async function enforceLimit(db: Queryable, organizationId: string, key: LimitKey, limit: number | null | undefined, used: number, increment = 0): Promise<void> {
  if (limit === null || limit === undefined) return;
  const { rows } = await db.query<{ policy: string; extra: string }>(
    `select o.limit_policy as policy, coalesce((select sum(extra) from public.limit_approvals a
       where a.organization_id = o.id and a.limit_key = $2 and a.period_start = $3 and a.status = 'approved'), 0) as extra
     from public.organizations o where o.id = $1`,
    [organizationId, key, monthStart()],
  );
  const policy = rows[0]?.policy ?? "block";
  const effective = limit + (policy === "require_approval" ? Number(rows[0]?.extra ?? 0) : 0);
  if (used + increment <= effective && !(increment === 0 && used >= effective)) return;
  if (policy !== "require_approval") throw new LimitExceededError(key, limit, used);
  await db.query(
    `insert into public.limit_approvals (organization_id, limit_key, period_start, limit_value, used_value)
     values ($1, $2, $3, $4, $5) on conflict (organization_id, limit_key, period_start) where status = 'pending' do update set used_value = excluded.used_value`,
    [organizationId, key, monthStart(), effective, used],
  );
  throw new LimitApprovalRequiredError(key, effective, used);
}

export async function decideLimitApproval(db: Queryable, approvalId: string, decision: { approved: boolean; extra?: number; userId?: string | null; note?: string }) {
  const res = await db.query(
    `update public.limit_approvals set status = $2, extra = $3, decided_by = $4, decided_at = now(), note = $5
     where id = $1 and status = 'pending' returning organization_id`,
    [approvalId, decision.approved ? "approved" : "rejected", decision.approved ? Math.max(0, decision.extra ?? 0) : 0, decision.userId ?? null, decision.note ?? null],
  );
  if (!res.rowCount) throw new Error("No pending approval");
  return (res.rows[0] as { organization_id: string }).organization_id;
}
