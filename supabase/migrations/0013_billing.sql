-- Stripe billing. Prices are never invented: the platform admin maps each plan
-- to a Stripe Price ID and amount/currency/interval are read from Stripe.

create table public.plan_prices (
  stripe_price_id text primary key check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  plan_code text not null references public.plans(code) on delete cascade,
  currency text not null,
  unit_amount bigint not null check (unit_amount >= 0),
  interval text not null check (interval in ('day', 'week', 'month', 'year')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index plan_prices_plan_idx on public.plan_prices(plan_code);
alter table public.plan_prices enable row level security;
revoke all on public.plan_prices from anon;
revoke insert, update, delete on public.plan_prices from authenticated;
-- Any signed-in user can see the public price list; only the server writes it.
create policy plan_prices_select on public.plan_prices for select to authenticated using (true);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  stripe_price_id text,
  plan_code text references public.plans(code),
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_org_idx on public.subscriptions(organization_id);
call app.apply_tenant_policies('public.subscriptions', '{}', true);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stripe_invoice_id text not null unique,
  stripe_subscription_id text,
  number text,
  status text not null,
  currency text not null,
  amount_due bigint not null default 0,
  amount_paid bigint not null default 0,
  hosted_invoice_url text,
  invoice_pdf text,
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_org_idx on public.invoices(organization_id, created_at desc);
create index invoices_paid_idx on public.invoices(paid_at) where status = 'paid';
call app.apply_tenant_policies('public.invoices', '{}');

-- Webhook idempotency (service only; no tenant access).
create table public.stripe_events (
  id text primary key,
  type text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;
