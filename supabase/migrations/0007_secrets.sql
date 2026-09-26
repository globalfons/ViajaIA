-- =============================================================================
-- 0007 · Encrypted integration credentials (AES-256-GCM, see core/security/crypto).
-- Values are written and read ONLY by trusted server code (service role).
-- Owners/admins can see which secrets exist (name, hint, dates), never values.
-- =============================================================================
create table public.secrets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (name ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  ciphertext text not null,
  key_version text not null,
  hint text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
alter table public.secrets enable row level security;
revoke all on public.secrets from anon, authenticated;
grant select (id, organization_id, name, hint, key_version, created_at, updated_at) on public.secrets to authenticated;
create policy secrets_select_meta on public.secrets for select to authenticated using (app.has_role(organization_id, '{owner,admin}'));
create trigger secrets_touch before update on public.secrets for each row execute function app.touch_updated_at();
create trigger secrets_org_immutable before update on public.secrets for each row execute function app.prevent_org_change();
-- Audit: identifiers only (audit_row never copies row contents).
create trigger secrets_audit after insert or update or delete on public.secrets for each row execute function app.audit_row();
