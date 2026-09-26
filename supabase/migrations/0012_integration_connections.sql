-- OAuth-based integrations (Google Calendar today). Tokens live in public.secrets
-- (encrypted); this table only holds non-secret connection metadata and settings.
create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('google_calendar')),
  status text not null default 'connected' check (status in ('connected', 'error')),
  account text,
  settings jsonb not null default '{}'::jsonb,
  last_error text,
  connected_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);
-- Members can see the connection; only the server (after RBAC checks) writes it.
call app.apply_tenant_policies('public.integration_connections', '{}', true);
