-- =============================================================================
-- 0010 · What happens when a client reaches a limit: BLOCK, or REQUIRE admin
-- approval (a request is raised; the platform admin grants extra headroom).
-- =============================================================================
alter table public.organizations add column limit_policy text not null default 'block' check (limit_policy in ('block', 'require_approval'));

create table public.limit_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  limit_key text not null,
  period_start date not null,
  limit_value numeric not null,
  used_value numeric not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- Extra headroom granted on approval (same unit as the limit).
  extra numeric not null default 0 check (extra >= 0),
  decided_by uuid,
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
-- One open request per limit and month.
create unique index limit_approvals_pending_idx on public.limit_approvals(organization_id, limit_key, period_start) where status = 'pending';
create index limit_approvals_org_idx on public.limit_approvals(organization_id, period_start);
call app.apply_tenant_policies('public.limit_approvals', '{}', true);
