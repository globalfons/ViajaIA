import type { Queryable } from "./pool";

/**
 * Cross-organization read models for the Platform Admin. Only called after
 * requirePlatformAdmin(); every figure comes from recorded data (usage events,
 * runs, Stripe invoices) — nothing is estimated or invented.
 */

const MONTH = "date_trunc('month', now())";

export interface PlatformOverview {
  clients: { active: number; suspended: number };
  activeAgents: number;
  monthlyAiCostUsd: number;
  /** Paid Stripe invoices this month per currency (minor units). Empty when there is no billing data. */
  monthlyRevenue: { currency: string; amount: number }[];
  activeConversations: number;
  runs: { total: number; failed: number; errorRate: number | null };
  pendingLimitApprovals: number;
}

export async function platformOverview(db: Queryable): Promise<PlatformOverview> {
  const [clients, agents, cost, revenue, conv, runs, pending] = await Promise.all([
    db.query<{ active: number; suspended: number }>("select count(*) filter (where status = 'active')::int active, count(*) filter (where status = 'suspended')::int suspended from public.organizations"),
    db.query<{ n: number }>("select count(*)::int n from public.agents a join public.organizations o on o.id = a.organization_id where a.status = 'active' and o.status = 'active'"),
    db.query<{ usd: string }>(`select coalesce(sum(cost_usd), 0) usd from public.usage_events where created_at >= ${MONTH}`),
    db.query<{ currency: string; amount: string }>(`select currency, sum(amount_paid) amount from public.invoices where status = 'paid' and paid_at >= ${MONTH} group by currency order by currency`),
    db.query<{ n: number }>("select count(*)::int n from public.conversations where status <> 'closed' and last_message_at > now() - interval '7 days'"),
    db.query<{ total: number; failed: number }>(
      `select (select count(*) from public.agent_runs where created_at >= ${MONTH})::int + (select count(*) from public.workflow_runs where created_at >= ${MONTH})::int total,
              (select count(*) from public.agent_runs where created_at >= ${MONTH} and status = 'failed')::int + (select count(*) from public.workflow_runs where created_at >= ${MONTH} and status = 'failed')::int failed`,
    ),
    db.query<{ n: number }>("select count(*)::int n from public.limit_approvals where status = 'pending'"),
  ]);
  const r = runs.rows[0]!;
  return {
    clients: clients.rows[0]!,
    activeAgents: agents.rows[0]!.n,
    monthlyAiCostUsd: Number(cost.rows[0]!.usd),
    monthlyRevenue: revenue.rows.map((x) => ({ currency: x.currency, amount: Number(x.amount) })),
    activeConversations: conv.rows[0]!.n,
    runs: { total: r.total, failed: r.failed, errorRate: r.total ? r.failed / r.total : null },
    pendingLimitApprovals: pending.rows[0]!.n,
  };
}

export interface ClientRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_code: string | null;
  members: number;
  active_agents: number;
  conversations_month: number;
  leads: number;
  ai_cost_month: string;
  runs_month: number;
  failed_month: number;
  subscription_status: string | null;
  created_at: string;
}

export async function platformClients(db: Queryable): Promise<ClientRow[]> {
  const { rows } = await db.query<ClientRow>(
    `select o.id, o.name, o.slug, o.status, o.plan_code, o.created_at,
       (select count(*) from public.memberships m where m.organization_id = o.id)::int members,
       (select count(*) from public.agents a where a.organization_id = o.id and a.status = 'active')::int active_agents,
       (select count(*) from public.conversations c where c.organization_id = o.id and c.created_at >= ${MONTH})::int conversations_month,
       (select count(*) from public.leads l where l.organization_id = o.id)::int leads,
       (select coalesce(sum(u.cost_usd), 0) from public.usage_events u where u.organization_id = o.id and u.created_at >= ${MONTH}) ai_cost_month,
       (select count(*) from public.agent_runs r where r.organization_id = o.id and r.created_at >= ${MONTH})::int
         + (select count(*) from public.workflow_runs w where w.organization_id = o.id and w.created_at >= ${MONTH})::int runs_month,
       (select count(*) from public.agent_runs r where r.organization_id = o.id and r.created_at >= ${MONTH} and r.status = 'failed')::int
         + (select count(*) from public.workflow_runs w where w.organization_id = o.id and w.created_at >= ${MONTH} and w.status = 'failed')::int failed_month,
       (select s.status from public.subscriptions s where s.organization_id = o.id order by s.updated_at desc limit 1) subscription_status
     from public.organizations o order by o.created_at desc limit 500`,
  );
  return rows;
}

export async function platformUsers(db: Queryable, q?: string) {
  const { rows } = await db.query<{ id: string; email: string | null; full_name: string | null; is_platform_admin: boolean; created_at: string; orgs: { name: string; role: string }[] | null }>(
    `select p.id, p.email, p.full_name, p.is_platform_admin, p.created_at,
       (select json_agg(json_build_object('name', o.name, 'role', m.role) order by o.name) from public.memberships m join public.organizations o on o.id = m.organization_id where m.user_id = p.id) orgs
     from public.profiles p
     where ($1::text is null or p.email ilike '%' || $1 || '%' or p.full_name ilike '%' || $1 || '%')
     order by p.created_at desc limit 200`,
    [q?.trim() || null],
  );
  return rows;
}

export async function platformAgents(db: Queryable) {
  const { rows } = await db.query<{ id: string; name: string; status: string; organization: string; model: string | null; runs_month: number; cost_month: string; updated_at: string }>(
    `select a.id, a.name, a.status, o.name organization, a.config->>'model' model, a.updated_at,
       (select count(*) from public.agent_runs r where r.agent_id = a.id and r.created_at >= ${MONTH})::int runs_month,
       (select coalesce(sum(u.cost_usd), 0) from public.usage_events u where u.agent_id = a.id and u.created_at >= ${MONTH}) cost_month
     from public.agents a join public.organizations o on o.id = a.organization_id
     where a.status <> 'archived' order by a.updated_at desc limit 300`,
  );
  return rows;
}

export async function platformWorkflowRuns(db: Queryable) {
  const { rows } = await db.query<{ id: string; workflow: string; organization: string; status: string; error: string | null; created_at: string; finished_at: string | null }>(
    `select r.id, w.name workflow, o.name organization, r.status, r.error, r.created_at, r.finished_at
     from public.workflow_runs r join public.workflows w on w.id = r.workflow_id join public.organizations o on o.id = r.organization_id
     order by r.created_at desc limit 200`,
  );
  return rows;
}

export async function platformConversations(db: Queryable) {
  const { rows } = await db.query<{ id: string; organization: string; channel_type: string; status: string; escalation_reason: string | null; message_count: number; total_cost_usd: string; last_message_at: string | null }>(
    `select c.id, o.name organization, c.channel_type, c.status, c.escalation_reason, c.message_count, c.total_cost_usd, c.last_message_at
     from public.conversations c join public.organizations o on o.id = c.organization_id
     order by c.last_message_at desc nulls last limit 200`,
  );
  return rows;
}

export async function platformLeads(db: Queryable) {
  const { rows } = await db.query<{ id: string; title: string; organization: string; stage: string; score: number | null; source: string; created_at: string }>(
    `select l.id, l.title, o.name organization, l.stage, l.score, l.source, l.created_at
     from public.leads l join public.organizations o on o.id = l.organization_id order by l.created_at desc limit 200`,
  );
  return rows;
}

export async function platformErrors(db: Queryable) {
  const { rows } = await db.query<{ kind: string; id: string; organization: string | null; error: string | null; created_at: string }>(
    `(select 'agent_run' kind, r.id::text, o.name organization, r.error, r.created_at from public.agent_runs r join public.organizations o on o.id = r.organization_id where r.status = 'failed' order by r.created_at desc limit 100)
     union all
     (select 'workflow_run', r.id::text, o.name, r.error, r.created_at from public.workflow_runs r join public.organizations o on o.id = r.organization_id where r.status = 'failed' order by r.created_at desc limit 100)
     union all
     (select 'job:' || j.type, j.id::text, o.name, j.last_error, j.created_at from public.jobs j left join public.organizations o on o.id = j.organization_id where j.status = 'failed' order by j.created_at desc limit 100)
     union all
     (select 'delivery', m.id::text, o.name, m.delivery_error, m.created_at from public.messages m join public.organizations o on o.id = m.organization_id where m.delivery_status = 'failed' order by m.created_at desc limit 100)
     order by created_at desc limit 200`,
  );
  return rows;
}

export async function platformAudit(db: Queryable, filter: { action?: string; organizationId?: string } = {}) {
  const { rows } = await db.query<{ id: number; organization: string | null; actor: string | null; actor_type: string; action: string; target_type: string | null; target_id: string | null; created_at: string }>(
    `select a.id, o.name organization, p.email actor, a.actor_type, a.action, a.target_type, a.target_id, a.created_at
     from public.audit_logs a left join public.organizations o on o.id = a.organization_id left join public.profiles p on p.id = a.actor_id
     where ($1::text is null or a.action ilike $1 || '%') and ($2::uuid is null or a.organization_id = $2)
     order by a.id desc limit 200`,
    [filter.action?.trim() || null, filter.organizationId ?? null],
  );
  return rows;
}

export async function platformBilling(db: Queryable) {
  const [subs, invoices] = await Promise.all([
    db.query<{ organization: string; status: string; plan_code: string | null; current_period_end: string | null; cancel_at_period_end: boolean }>(
      `select o.name organization, s.status, s.plan_code, s.current_period_end, s.cancel_at_period_end
       from public.subscriptions s join public.organizations o on o.id = s.organization_id order by s.updated_at desc limit 200`,
    ),
    db.query<{ organization: string; number: string | null; status: string; currency: string; amount_due: string; amount_paid: string; paid_at: string | null; hosted_invoice_url: string | null; created_at: string }>(
      `select o.name organization, i.number, i.status, i.currency, i.amount_due, i.amount_paid, i.paid_at, i.hosted_invoice_url, i.created_at
       from public.invoices i join public.organizations o on o.id = i.organization_id order by i.created_at desc limit 200`,
    ),
  ]);
  return { subscriptions: subs.rows, invoices: invoices.rows };
}

export async function platformTemplates(db: Queryable) {
  const { rows } = await db.query<{ id: string; name: string; kind: string; category: string | null; organization: string | null; created_at: string }>(
    `select t.id, t.name, t.kind, t.category, o.name organization, t.created_at
     from public.templates t left join public.organizations o on o.id = t.organization_id order by t.created_at desc limit 200`,
  );
  return rows;
}
