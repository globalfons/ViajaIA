-- =============================================================================
-- 0006 · Channels, contacts, conversations and messages (inbox).
-- Messages are written only by trusted server code (service role) so the
-- history, token counts and costs cannot be forged by clients.
-- =============================================================================

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type text not null check (type in ('web', 'whatsapp', 'email', 'api')),
  name text not null check (length(name) between 1 and 120),
  agent_id uuid references public.agents(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'paused')),
  -- Web widget: public, non-secret identifier embedded in the client's site.
  public_key text unique,
  allowed_origins text[] not null default '{}',
  -- Non-secret settings (welcome message, colors, WhatsApp phone_number_id…).
  config jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index channels_org_idx on public.channels(organization_id);
call app.apply_tenant_policies('public.channels', '{owner,admin}', true);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text,
  email text,
  phone text,
  company text,
  -- Identifiers per channel: {"web": "<visitor id>", "whatsapp": "+34…"}
  external_ids jsonb not null default '{}'::jsonb,
  -- GDPR/LSSI: lawful basis and marketing consent (see CRM phase).
  consent jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_org_idx on public.contacts(organization_id);
create index contacts_org_email_idx on public.contacts(organization_id, lower(email)) where email is not null;
call app.apply_tenant_policies('public.contacts', '{owner,admin,member}', true);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  channel_id uuid references public.channels(id) on delete set null,
  channel_type text not null check (channel_type in ('web', 'whatsapp', 'email', 'api', 'playground')),
  contact_id uuid references public.contacts(id) on delete set null,
  visitor_id text,
  external_thread_id text,
  -- open: AI answers · escalated: waiting for a human · human: a person took over · closed
  status text not null default 'open' check (status in ('open', 'escalated', 'human', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  subject text,
  escalation_reason text,
  assigned_to uuid references public.profiles(id) on delete set null,
  message_count int not null default 0,
  total_tokens int not null default 0,
  total_cost_usd numeric(14, 8) not null default 0,
  last_message_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_org_last_idx on public.conversations(organization_id, last_message_at desc);
create index conversations_org_status_idx on public.conversations(organization_id, status);
create unique index conversations_channel_thread_idx on public.conversations(channel_id, external_thread_id) where external_thread_id is not null;
call app.apply_tenant_policies('public.conversations', '{}');
-- Members may triage (status, priority, assignment) but not rewrite metrics.
revoke insert, update, delete on public.conversations from authenticated;
grant update (status, priority, assigned_to, subject) on public.conversations to authenticated;
create policy conversations_triage on public.conversations for update to authenticated
  using (app.has_role(organization_id, '{owner,admin,member}')) with check (app.has_role(organization_id, '{owner,admin,member}'));

create table public.messages (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'human_agent', 'system')),
  content text not null,
  author_id uuid,
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(14, 8) not null default 0,
  latency_ms int,
  sources jsonb,
  tool_calls jsonb,
  status text not null default 'sent' check (status in ('sent', 'draft', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages(conversation_id, id);
call app.apply_tenant_policies('public.messages', '{}');
