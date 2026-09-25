-- =============================================================================
-- 0001 · Multi-tenancy core: organizations, users, memberships, projects,
-- plans, audit log and the reusable RLS toolkit used by every later migration.
--
-- Isolation model
--   * Every business table carries organization_id and RLS.
--   * Members read their organizations' data; writes need a role.
--   * Suspended organizations are locked for their members (data kept).
--   * Platform admins (profiles.is_platform_admin) can see every tenant.
--   * The service role (worker/webhooks) bypasses RLS and MUST filter by
--     organization_id in code.
-- =============================================================================

create extension if not exists pgcrypto;
create schema if not exists extensions;
create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Plans (prices are NOT stored here: they live in Stripe; see migration 0010)
-- ---------------------------------------------------------------------------
create table public.plans (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  name text not null,
  description text,
  -- Limits: null or missing key = unlimited. Keys documented in docs/BILLING.md
  limits jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.plans (code, name, sort_order) values
  ('STARTER', 'Starter', 10),
  ('PRO', 'Pro', 20),
  ('BUSINESS', 'Business', 30),
  ('ENTERPRISE', 'Enterprise', 40)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Platform settings (single row)
-- ---------------------------------------------------------------------------
create table public.platform_settings (
  id boolean primary key default true check (id),
  allow_self_signup boolean not null default false,
  default_plan_code text references public.plans(code),
  branding jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id, default_plan_code) values (true, 'STARTER') on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Organizations (= clients / tenants)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  suspended_reason text,
  plan_code text references public.plans(code) default 'STARTER',
  -- Per-client overrides of plan limits (same keys as plans.limits).
  limits jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  -- White-label: { name, logo_url, favicon_url, colors: {primary, accent}, custom_domain, email_from }
  branding jsonb not null default '{}'::jsonb,
  white_label_enabled boolean not null default false,
  custom_domain text unique,
  stripe_customer_id text unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role text not null check (role in ('admin', 'member', 'viewer')),
  invited_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_org_idx on public.projects(organization_id);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  -- No FK on purpose: the audit trail must outlive deleted organizations.
  organization_id uuid,
  actor_id uuid,
  actor_type text not null default 'user' check (actor_type in ('user', 'system', 'agent', 'platform_admin')),
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs(organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so policies never recurse into RLS)
-- ---------------------------------------------------------------------------
create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false)
$$;

-- Raw membership, regardless of org status (used to show "suspended" state).
create or replace function app.has_membership(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.organization_id = org and m.user_id = auth.uid())
$$;

-- Read access to tenant data: active membership, or platform admin.
create or replace function app.can_access(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_platform_admin() or exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = org and m.user_id = auth.uid() and o.status = 'active'
  )
$$;

-- Write access: one of the given roles in an active org, or platform admin.
create or replace function app.has_role(org uuid, roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_platform_admin() or exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = org and m.user_id = auth.uid() and o.status = 'active' and m.role = any(roles)
  )
$$;

create or replace function app.shares_org_with(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships a join public.memberships b on a.organization_id = b.organization_id
    where a.user_id = auth.uid() and b.user_id = other
  )
$$;

grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- A row can never be moved to another tenant.
create or replace function app.prevent_org_change() returns trigger language plpgsql as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable' using errcode = '42501';
  end if;
  return new;
end $$;

-- Automatic audit trail for sensitive tables. Row contents are NOT copied
-- (they may hold personal data or secrets); only identifiers.
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
  org uuid := coalesce((rec ->> 'organization_id')::uuid, case when tg_table_name = 'organizations' then (rec ->> 'id')::uuid end);
begin
  insert into public.audit_logs (organization_id, actor_id, actor_type, action, target_type, target_id, metadata)
  values (
    org,
    auth.uid(),
    case when auth.uid() is null then 'system' when app.is_platform_admin() then 'platform_admin' else 'user' end,
    lower(tg_op),
    tg_table_name,
    coalesce(rec ->> 'id', rec ->> 'user_id'),
    case when tg_op = 'UPDATE'
      then jsonb_build_object('changed', (
        select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(to_jsonb(new)) k
        where to_jsonb(new) -> k is distinct from to_jsonb(old) -> k and k <> 'updated_at'))
      else '{}'::jsonb end
  );
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- RLS toolkit: one call per tenant table gives consistent policies.
--   writer_roles: roles allowed to insert/update/delete ('{}' = read-only for
--   clients; writes only through the service role).
-- ---------------------------------------------------------------------------
create or replace procedure app.apply_tenant_policies(
  tbl regclass,
  writer_roles text[] default '{owner,admin,member}',
  audit boolean default false
) language plpgsql as $$
declare
  t text := tbl::text;
  n text := replace(tbl::text, 'public.', '');
begin
  execute format('alter table %s enable row level security', t);
  execute format('revoke all on %s from anon', t);
  execute format('create policy %I on %s for select to authenticated using (app.can_access(organization_id))', n || '_select', t);
  if cardinality(writer_roles) > 0 then
    execute format('create policy %I on %s for insert to authenticated with check (app.has_role(organization_id, %L))', n || '_insert', t, writer_roles);
    execute format('create policy %I on %s for update to authenticated using (app.has_role(organization_id, %L)) with check (app.has_role(organization_id, %L))', n || '_update', t, writer_roles, writer_roles);
    execute format('create policy %I on %s for delete to authenticated using (app.has_role(organization_id, %L))', n || '_delete', t, writer_roles);
  end if;
  execute format('create trigger %I before update on %s for each row execute function app.prevent_org_change()', n || '_org_immutable', t);
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = n and column_name = 'updated_at') then
    execute format('create trigger %I before update on %s for each row execute function app.touch_updated_at()', n || '_touch', t);
  end if;
  if audit then
    execute format('create trigger %I after insert or update or delete on %s for each row execute function app.audit_row()', n || '_audit', t);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Policies: organizations / profiles / memberships / invitations / plans
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
revoke all on public.organizations from anon;
-- Clients may only edit cosmetic/configuration columns. Status, plan and
-- limits are changed by the platform admin through the server API.
revoke insert, update, delete on public.organizations from authenticated;
grant update (name, settings, branding) on public.organizations to authenticated;
create policy organizations_select on public.organizations for select to authenticated
  using (app.has_membership(id) or app.is_platform_admin());
create policy organizations_update on public.organizations for update to authenticated
  using (app.has_role(id, '{owner,admin}')) with check (app.has_role(id, '{owner,admin}'));
create trigger organizations_touch before update on public.organizations for each row execute function app.touch_updated_at();
create trigger organizations_audit after insert or update or delete on public.organizations for each row execute function app.audit_row();

alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or app.shares_org_with(id) or app.is_platform_admin());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

alter table public.memberships enable row level security;
revoke all on public.memberships from anon;
create policy memberships_select on public.memberships for select to authenticated
  using (app.has_membership(organization_id) or app.is_platform_admin());
-- Only owners may grant/revoke the owner role; admins manage other roles.
create policy memberships_insert on public.memberships for insert to authenticated
  with check (app.has_role(organization_id, case when role = 'owner' then '{owner}'::text[] else '{owner,admin}'::text[] end));
create policy memberships_update on public.memberships for update to authenticated
  using (app.has_role(organization_id, case when role = 'owner' then '{owner}'::text[] else '{owner,admin}'::text[] end))
  with check (app.has_role(organization_id, case when role = 'owner' then '{owner}'::text[] else '{owner,admin}'::text[] end));
create policy memberships_delete on public.memberships for delete to authenticated
  using (
    user_id = auth.uid() -- anyone can leave
    or app.has_role(organization_id, case when role = 'owner' then '{owner}'::text[] else '{owner,admin}'::text[] end)
  );
create trigger memberships_org_immutable before update on public.memberships for each row execute function app.prevent_org_change();
create trigger memberships_audit after insert or update or delete on public.memberships for each row execute function app.audit_row();

-- An organization must always keep at least one owner.
create or replace function app.keep_one_owner() returns trigger language plpgsql as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner')
     and exists (select 1 from public.organizations o where o.id = old.organization_id)
     and not exists (
       select 1 from public.memberships m
       where m.organization_id = old.organization_id and m.role = 'owner' and m.user_id <> old.user_id
     ) then
    raise exception 'An organization needs at least one owner' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
create trigger memberships_keep_owner before update or delete on public.memberships
  for each row execute function app.keep_one_owner();

call app.apply_tenant_policies('public.invitations', '{owner,admin}', true);
call app.apply_tenant_policies('public.projects', '{owner,admin,member}', true);

alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon;
revoke insert, update, delete on public.audit_logs from authenticated; -- append-only via triggers/service role
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (app.has_role(organization_id, '{owner,admin}') or app.is_platform_admin());

alter table public.plans enable row level security;
revoke all on public.plans from anon;
revoke insert, update, delete on public.plans from authenticated;
create policy plans_select on public.plans for select to authenticated using (active or app.is_platform_admin());
create trigger plans_touch before update on public.plans for each row execute function app.touch_updated_at();

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon;
revoke insert, update, delete on public.platform_settings from authenticated;
create policy platform_settings_select on public.platform_settings for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Profile row for every new auth user.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function app.handle_new_user();

-- Creates a client organization and makes the caller (or `owner_id`) its owner.
-- Allowed for platform admins, or for anyone when self-signup is enabled.
create or replace function public.create_organization(p_name text, p_slug text, p_plan_code text default null)
returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare
  org public.organizations;
  uid uuid := auth.uid();
  is_admin boolean := app.is_platform_admin();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not is_admin and not coalesce((select allow_self_signup from public.platform_settings), false) then
    raise exception 'only platform admins can create organizations' using errcode = '42501';
  end if;
  if p_plan_code is not null and not is_admin then
    raise exception 'only platform admins can choose a plan' using errcode = '42501';
  end if;
  insert into public.organizations (name, slug, plan_code, created_by)
  values (
    trim(p_name),
    lower(trim(p_slug)),
    coalesce(p_plan_code, (select default_plan_code from public.platform_settings), 'STARTER'),
    uid
  )
  returning * into org;
  insert into public.memberships (organization_id, user_id, role) values (org.id, uid, 'owner');
  return org;
end $$;
revoke all on function public.create_organization(text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text) to authenticated;

-- Accepts every pending, unexpired invitation addressed to the caller's
-- (verified) email. Called after login.
create or replace function public.accept_pending_invitations() returns int
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  mail text := lower(auth.jwt() ->> 'email');
  n int := 0;
  inv record;
begin
  if uid is null or mail is null then return 0; end if;
  for inv in
    select * from public.invitations
    where email = mail and accepted_at is null and expires_at > now()
    for update
  loop
    insert into public.memberships (organization_id, user_id, role)
    values (inv.organization_id, uid, inv.role)
    on conflict (organization_id, user_id) do nothing;
    update public.invitations set accepted_at = now() where id = inv.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.accept_pending_invitations() from public, anon;
grant execute on function public.accept_pending_invitations() to authenticated;
