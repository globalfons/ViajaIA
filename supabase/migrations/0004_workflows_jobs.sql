-- =============================================================================
-- 0004 · Workflows (versioned graphs), runs, step logs, human approvals and
-- the Postgres job queue used by the worker.
-- =============================================================================

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  name text not null check (length(name) between 1 and 120),
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  latest_version int not null default 0,
  published_version int,
  template_key text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workflows_org_idx on public.workflows(organization_id, status);
call app.apply_tenant_policies('public.workflows', '{owner,admin,member}', true);

-- Immutable snapshots: every save is a new version; runs pin the version.
create table public.workflow_versions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  version int not null,
  graph jsonb not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (workflow_id, version)
);
call app.apply_tenant_policies('public.workflow_versions', '{}');

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  version int not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled')),
  trigger text not null default 'manual' check (trigger in ('manual', 'api', 'webhook', 'schedule', 'event')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  -- Engine state (node statuses/outputs). Never contains secrets.
  state jsonb,
  -- Optimistic concurrency: every state write bumps it (compare-and-set).
  state_version int not null default 0,
  error text,
  next_wake_at timestamptz,
  created_by uuid,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workflow_runs_org_created_idx on public.workflow_runs(organization_id, created_at desc);
create index workflow_runs_workflow_idx on public.workflow_runs(workflow_id, created_at desc);
call app.apply_tenant_policies('public.workflow_runs', '{}');

create table public.workflow_step_runs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.workflow_runs(id) on delete cascade,
  node_id text not null,
  node_type text not null,
  status text not null,
  attempts int not null default 0,
  output jsonb,
  error text,
  logs text[] not null default '{}',
  started_at timestamptz,
  finished_at timestamptz,
  unique (run_id, node_id)
);
call app.apply_tenant_policies('public.workflow_step_runs', '{}');

-- Link agent runs started by a workflow node back to the run.
alter table public.agent_runs add column workflow_run_id uuid references public.workflow_runs(id) on delete set null;
alter table public.agent_runs add column workflow_node_id text;
grant select (workflow_run_id, workflow_node_id) on public.agent_runs to authenticated;

-- ---------------------------------------------------------------------------
-- Human approvals requested by workflow approval nodes.
-- (Agent tool approvals live on agent_runs.status = 'needs_approval'.)
-- ---------------------------------------------------------------------------
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  approval_key text not null unique,
  workflow_run_id uuid references public.workflow_runs(id) on delete cascade,
  node_id text,
  title text not null,
  instructions text not null default '',
  payload jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  decided_by uuid,
  decided_at timestamptz,
  note text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index approvals_pending_idx on public.approvals(organization_id, created_at desc) where status = 'pending';
call app.apply_tenant_policies('public.approvals', '{}', true);

-- ---------------------------------------------------------------------------
-- Job queue (worker). Service role only.
-- ---------------------------------------------------------------------------
create table public.jobs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 5,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_ready_idx on public.jobs(run_at) where status = 'queued';
-- At most one queued/running job per dedupe key (e.g. "workflow.advance:<run>").
create unique index jobs_dedupe_idx on public.jobs(dedupe_key) where dedupe_key is not null and status in ('queued', 'running');
alter table public.jobs enable row level security;
revoke all on public.jobs from anon, authenticated;
