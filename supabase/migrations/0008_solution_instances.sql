-- =============================================================================
-- 0008 · Solution instances: a catalog solution activated for an organization,
-- with links to everything it provisioned.
-- =============================================================================
create table public.solution_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  solution_key text not null,
  template_id text not null,
  version int not null,
  name text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  config jsonb not null default '{}'::jsonb,
  agent_ids uuid[] not null default '{}',
  knowledge_base_id uuid references public.knowledge_bases(id) on delete set null,
  workflow_id uuid references public.workflows(id) on delete set null,
  channel_id uuid references public.channels(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index solution_instances_org_idx on public.solution_instances(organization_id, created_at desc);
call app.apply_tenant_policies('public.solution_instances', '{}', true);
