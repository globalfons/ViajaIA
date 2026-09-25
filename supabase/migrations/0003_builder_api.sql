-- =============================================================================
-- 0003 · Templates, agent runs (execution log + paused state), API keys and
-- Postgres-backed rate limiting.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Custom templates. Built-in templates live in code (@dtn/core templates);
-- these are saved by the agency (organization_id null = platform-wide, only
-- platform admins) or by a client for its own reuse.
-- ---------------------------------------------------------------------------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('agent', 'workflow')),
  name text not null check (length(name) between 1 and 120),
  description text not null default '',
  category text,
  config jsonb not null,
  source_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index templates_org_kind_idx on public.templates(organization_id, kind);
alter table public.templates enable row level security;
revoke all on public.templates from anon;
create policy templates_select on public.templates for select to authenticated
  using (organization_id is null or app.can_access(organization_id));
create policy templates_insert on public.templates for insert to authenticated
  with check (case when organization_id is null then app.is_platform_admin() else app.has_role(organization_id, '{owner,admin,member}') end);
create policy templates_update on public.templates for update to authenticated
  using (case when organization_id is null then app.is_platform_admin() else app.has_role(organization_id, '{owner,admin,member}') end)
  with check (case when organization_id is null then app.is_platform_admin() else app.has_role(organization_id, '{owner,admin,member}') end);
create policy templates_delete on public.templates for delete to authenticated
  using (case when organization_id is null then app.is_platform_admin() else app.has_role(organization_id, '{owner,admin}') end);
create trigger templates_touch before update on public.templates for each row execute function app.touch_updated_at();
create trigger templates_org_immutable before update on public.templates for each row execute function app.prevent_org_change();

-- ---------------------------------------------------------------------------
-- Agent runs: every execution (playground, API, channels, workflows). Paused
-- runs keep their serialized state server-side so clients cannot tamper
-- with it before approving.
-- ---------------------------------------------------------------------------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  agent_version int,
  conversation_id uuid,
  source text not null check (source in ('playground', 'api', 'channel', 'workflow')),
  status text not null check (status in ('running', 'completed', 'needs_approval', 'escalated', 'blocked', 'failed')),
  input text,
  output text,
  structured jsonb,
  state jsonb,
  pending_approval jsonb,
  sources jsonb,
  tool_invocations jsonb,
  usage jsonb,
  flags jsonb,
  error text,
  model text,
  created_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_runs_org_created_idx on public.agent_runs(organization_id, created_at desc);
create index agent_runs_agent_idx on public.agent_runs(agent_id, created_at desc);
create index agent_runs_pending_idx on public.agent_runs(organization_id) where status = 'needs_approval';
call app.apply_tenant_policies('public.agent_runs', '{}');
-- The paused state is internal: members see the run but not the raw state.
revoke select on public.agent_runs from authenticated;
grant select (id, organization_id, agent_id, agent_version, conversation_id, source, status, input, output, structured,
  pending_approval, sources, tool_invocations, usage, flags, error, model, created_by, decided_by, decided_at, created_at, updated_at)
  on public.agent_runs to authenticated;

-- ---------------------------------------------------------------------------
-- API keys (hashed). The plaintext key is shown once at creation time.
-- ---------------------------------------------------------------------------
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  prefix text not null,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index api_keys_org_idx on public.api_keys(organization_id);
alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon;
create policy api_keys_select on public.api_keys for select to authenticated using (app.has_role(organization_id, '{owner,admin}'));
create policy api_keys_insert on public.api_keys for insert to authenticated with check (app.has_role(organization_id, '{owner,admin}'));
create policy api_keys_update on public.api_keys for update to authenticated
  using (app.has_role(organization_id, '{owner,admin}')) with check (app.has_role(organization_id, '{owner,admin}'));
create policy api_keys_delete on public.api_keys for delete to authenticated using (app.has_role(organization_id, '{owner,admin}'));
create trigger api_keys_org_immutable before update on public.api_keys for each row execute function app.prevent_org_change();
create trigger api_keys_audit after insert or update or delete on public.api_keys for each row execute function app.audit_row();
-- Only revocation may change after creation.
revoke update on public.api_keys from authenticated;
grant update (revoked_at, name) on public.api_keys to authenticated;

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window). Returns true when the request is allowed.
-- ---------------------------------------------------------------------------
create unlogged table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

create or replace function app.rate_limit_hit(p_key text, p_window_seconds int, p_max int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n int;
begin
  insert into public.rate_limits as r (key, window_start, count) values (p_key, w, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into n;
  -- Opportunistic cleanup of old windows.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 hour';
  end if;
  return n <= p_max;
end $$;
revoke all on function app.rate_limit_hit(text, int, int) from public, authenticated;
