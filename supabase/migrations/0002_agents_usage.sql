-- =============================================================================
-- 0002 · Agents, model catalog (prices are admin-managed data), usage and
-- tool invocation logs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Model catalog. Prices are nullable: an unpriced model is reported as such
-- in dashboards instead of silently costing 0. Managed by the platform admin.
-- ---------------------------------------------------------------------------
create table public.llm_models (
  provider text not null check (provider in ('openai', 'anthropic', 'gemini', 'xai', 'deepseek', 'openrouter')),
  model text not null check (length(model) between 1 and 200),
  display_name text,
  kind text not null default 'chat' check (kind in ('chat', 'embedding')),
  enabled boolean not null default true,
  input_per_mtok numeric(12, 6) check (input_per_mtok >= 0),
  output_per_mtok numeric(12, 6) check (output_per_mtok >= 0),
  embedding_dimensions int,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (provider, model)
);
alter table public.llm_models enable row level security;
revoke all on public.llm_models from anon;
revoke insert, update, delete on public.llm_models from authenticated;
create policy llm_models_select on public.llm_models for select to authenticated using (true);
create trigger llm_models_touch before update on public.llm_models for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Agents
-- ---------------------------------------------------------------------------
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  name text not null check (length(name) between 1 and 120),
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  template_key text,
  -- Validated by @dtn/core agentConfigSchema on every write path.
  config jsonb not null,
  version int not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agents_org_idx on public.agents(organization_id, status);

create table public.agent_versions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  version int not null,
  config jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (agent_id, version)
);

-- Every config change bumps the version and snapshots it (rollback / audit).
create or replace function app.snapshot_agent_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.config is not distinct from old.config then return new; end if;
    new.version := old.version + 1;
  end if;
  insert into public.agent_versions (organization_id, agent_id, version, config, created_by)
  values (new.organization_id, new.id, new.version, new.config, auth.uid());
  return new;
end $$;
create trigger agents_version_update before update on public.agents
  for each row execute function app.snapshot_agent_version();
create or replace function app.snapshot_agent_version_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.agent_versions (organization_id, agent_id, version, config, created_by)
  values (new.organization_id, new.id, new.version, new.config, auth.uid());
  return new;
end $$;
create trigger agents_version_insert after insert on public.agents
  for each row execute function app.snapshot_agent_version_insert();

call app.apply_tenant_policies('public.agents', '{owner,admin,member}', true);
call app.apply_tenant_policies('public.agent_versions', '{}');

-- ---------------------------------------------------------------------------
-- Usage events: one row per LLM call (including failed ones). Written only by
-- trusted server code (service role) so tenants cannot forge or erase usage.
-- ---------------------------------------------------------------------------
create table public.usage_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid,
  workflow_id uuid,
  workflow_run_id uuid,
  conversation_id uuid,
  purpose text not null default 'chat',
  provider text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(14, 8) not null default 0,
  priced boolean not null default true,
  latency_ms int,
  success boolean not null default true,
  error_code text,
  request_id text,
  created_at timestamptz not null default now()
);
create index usage_events_org_created_idx on public.usage_events(organization_id, created_at desc);
create index usage_events_agent_idx on public.usage_events(agent_id, created_at desc) where agent_id is not null;
call app.apply_tenant_policies('public.usage_events', '{}');

create table public.tool_invocations (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid,
  conversation_id uuid,
  workflow_run_id uuid,
  tool_call_id text,
  tool_name text not null,
  status text not null check (status in ('success', 'error', 'denied', 'not_allowed')),
  -- Stored already redacted (secrets + PII) by the runtime.
  args jsonb,
  result jsonb,
  error text,
  duration_ms int,
  created_at timestamptz not null default now()
);
create index tool_invocations_org_created_idx on public.tool_invocations(organization_id, created_at desc);
call app.apply_tenant_policies('public.tool_invocations', '{}');

-- ---------------------------------------------------------------------------
-- Reporting views (security_invoker => RLS of the caller applies).
-- ---------------------------------------------------------------------------
create view public.usage_daily with (security_invoker = true) as
select
  organization_id,
  (created_at at time zone 'UTC')::date as day,
  provider,
  model,
  agent_id,
  count(*) as calls,
  count(*) filter (where not success) as errors,
  sum(input_tokens)::bigint as input_tokens,
  sum(output_tokens)::bigint as output_tokens,
  sum(cost_usd) as cost_usd,
  bool_and(priced) as all_priced,
  avg(latency_ms)::int as avg_latency_ms
from public.usage_events
group by 1, 2, 3, 4, 5;

revoke all on public.usage_daily from anon;

-- Month-to-date totals for budget checks (service role; explicit org filter).
create or replace function app.month_usage(org uuid)
returns table (cost_usd numeric, tokens bigint, calls bigint)
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(u.cost_usd), 0), coalesce(sum(u.input_tokens + u.output_tokens), 0)::bigint, count(*)
  from public.usage_events u
  where u.organization_id = org and u.created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
$$;
revoke all on function app.month_usage(uuid) from public, authenticated;
