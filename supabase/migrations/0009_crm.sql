-- =============================================================================
-- 0009 · Lightweight CRM: companies, contacts (extended), leads with pipeline,
-- opportunities, activities and tasks. Every lead records its lawful basis
-- (GDPR/LSSI); the platform never sends unsolicited outbound messages.
-- =============================================================================

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  domain text,
  industry text,
  size text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index companies_org_idx on public.companies(organization_id);
call app.apply_tenant_policies('public.companies', '{owner,admin,member}', true);

alter table public.contacts add column company_id uuid references public.companies(id) on delete set null;
alter table public.contacts add column source text;
alter table public.contacts add column tags text[] not null default '{}';
alter table public.contacts add column notes text;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  title text not null check (length(title) between 1 and 200),
  stage text not null default 'NEW' check (stage in ('NEW', 'QUALIFIED', 'CONTACTED', 'MEETING', 'PROPOSAL', 'WON', 'LOST')),
  score int check (score between 0 and 100),
  value numeric(14, 2) check (value >= 0),
  currency text not null default 'EUR',
  source text not null default 'manual' check (source in ('web', 'whatsapp', 'email', 'api', 'manual', 'agent', 'import')),
  owner_id uuid references public.profiles(id) on delete set null,
  qualification jsonb not null default '{}'::jsonb,
  lost_reason text,
  -- GDPR/LSSI: why we may process this person's data and whether they accepted marketing.
  lawful_basis text not null default 'inbound_request' check (lawful_basis in ('inbound_request', 'consent', 'contract', 'legitimate_interest')),
  marketing_consent boolean not null default false,
  consent_at timestamptz,
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_org_stage_idx on public.leads(organization_id, stage);
create index leads_org_created_idx on public.leads(organization_id, created_at desc);
create unique index leads_conversation_idx on public.leads(conversation_id) where conversation_id is not null;
call app.apply_tenant_policies('public.leads', '{owner,admin,member}', true);

create or replace function app.lead_stage_changed() returns trigger language plpgsql as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
  end if;
  return new;
end $$;
create trigger leads_stage_changed before update on public.leads for each row execute function app.lead_stage_changed();

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  name text not null check (length(name) between 1 and 200),
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  currency text not null default 'EUR',
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  close_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index opportunities_org_idx on public.opportunities(organization_id, status);
call app.apply_tenant_policies('public.opportunities', '{owner,admin,member}', true);

create table public.activities (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  type text not null check (type in ('note', 'call', 'email', 'meeting', 'stage_change', 'agent', 'system')),
  content text not null,
  author_id uuid,
  created_at timestamptz not null default now()
);
create index activities_lead_idx on public.activities(lead_id, created_at desc);
call app.apply_tenant_policies('public.activities', '{owner,admin,member}');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  title text not null check (length(title) between 1 and 300),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done')),
  assignee_id uuid references public.profiles(id) on delete set null,
  created_by uuid,
  source text not null default 'manual' check (source in ('manual', 'agent', 'workflow')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_org_status_idx on public.tasks(organization_id, status, due_at);
call app.apply_tenant_policies('public.tasks', '{owner,admin,member}', true);
