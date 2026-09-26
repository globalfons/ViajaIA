-- Public website: contact requests and the optional live demo channel.

-- Web chat key (wc_…) of a channel the agency set up for public demos. When
-- null, /demo runs a clearly labelled scripted DEMO mode instead.
alter table public.platform_settings add column demo_channel_key text check (demo_channel_key is null or demo_channel_key ~ '^wc_[A-Za-z0-9_-]{20,40}$');

create table public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  email text not null check (length(email) between 3 and 320),
  company text,
  phone text,
  interest text,
  message text not null check (length(message) between 1 and 4000),
  -- GDPR: acceptance of the privacy policy is mandatory; marketing is opt-in.
  privacy_accepted boolean not null check (privacy_accepted),
  marketing_consent boolean not null default false,
  source_path text,
  ip_hash text,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed', 'spam')),
  handled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contact_requests_created_idx on public.contact_requests(created_at desc);
-- Service-only: written by the public form action, read by the platform admin through the server.
alter table public.contact_requests enable row level security;
revoke all on public.contact_requests from anon, authenticated;
create trigger contact_requests_touch before update on public.contact_requests for each row execute function app.touch_updated_at();
