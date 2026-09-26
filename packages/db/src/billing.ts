import {
  createCheckoutSession,
  createPortalSession,
  createStripeCustomer,
  getStripePrice,
  type StripeEvent,
  type StripeOptions,
} from "@dtn/core";
import { NotFoundError } from "./agents";
import type { Queryable } from "./pool";

/**
 * Stripe billing. Stripe is the source of truth for prices, subscriptions and
 * invoices; this module mirrors them (via signed webhooks) so the app can show
 * plan, status and invoices and apply the plan's limits.
 */

export class BillingError extends Error {
  readonly status = 400;
}

export function stripeOptionsFromEnv(env: Record<string, string | undefined> = process.env): StripeOptions | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  return { secretKey: env.STRIPE_SECRET_KEY, baseUrl: env.STRIPE_API_BASE || undefined };
}

export async function addPlanPrice(db: Queryable, stripe: StripeOptions, planCode: string, priceId: string) {
  const plan = await db.query("select 1 from public.plans where code = $1", [planCode]);
  if (!plan.rowCount) throw new NotFoundError("Plan");
  const price = await getStripePrice(stripe, priceId);
  if (!price.active) throw new BillingError("The Stripe price is archived");
  if (!price.recurring) throw new BillingError("The Stripe price must be recurring");
  if (price.unit_amount == null) throw new BillingError("Metered/tiered prices are not supported");
  await db.query(
    `insert into public.plan_prices (stripe_price_id, plan_code, currency, unit_amount, interval, active) values ($1, $2, $3, $4, $5, true)
     on conflict (stripe_price_id) do update set plan_code = excluded.plan_code, currency = excluded.currency, unit_amount = excluded.unit_amount, interval = excluded.interval, active = true`,
    [price.id, planCode, price.currency, price.unit_amount, price.recurring.interval],
  );
  return price;
}

export async function deactivatePlanPrice(db: Queryable, priceId: string) {
  await db.query("update public.plan_prices set active = false where stripe_price_id = $1", [priceId]);
}

const LIVE = ["active", "trialing", "past_due", "unpaid"];

export async function currentSubscription(db: Queryable, organizationId: string) {
  const { rows } = await db.query<{ stripe_subscription_id: string; status: string; plan_code: string | null; current_period_end: string | null; cancel_at_period_end: boolean }>(
    `select stripe_subscription_id, status, plan_code, current_period_end, cancel_at_period_end from public.subscriptions
     where organization_id = $1 and status = any($2) order by updated_at desc limit 1`,
    [organizationId, LIVE],
  );
  return rows[0] ?? null;
}

async function ensureCustomer(db: Queryable, stripe: StripeOptions, organizationId: string, email: string | null): Promise<string> {
  const { rows } = await db.query<{ name: string; stripe_customer_id: string | null; status: string }>("select name, stripe_customer_id, status from public.organizations where id = $1", [organizationId]);
  const org = rows[0];
  if (!org) throw new NotFoundError("Organization");
  if (org.stripe_customer_id) return org.stripe_customer_id;
  // Idempotency key per org: concurrent clicks create a single customer in Stripe.
  const customer = await createStripeCustomer(stripe, { organizationId, name: org.name, email });
  const upd = await db.query<{ stripe_customer_id: string }>(
    "update public.organizations set stripe_customer_id = coalesce(stripe_customer_id, $2) where id = $1 returning stripe_customer_id",
    [organizationId, customer.id],
  );
  return upd.rows[0]!.stripe_customer_id;
}

export async function startCheckout(
  db: Queryable,
  stripe: StripeOptions,
  organizationId: string,
  p: { priceId: string; email: string | null; appUrl: string },
): Promise<string> {
  const { rows } = await db.query<{ plan_code: string }>("select plan_code from public.plan_prices where stripe_price_id = $1 and active", [p.priceId]);
  if (!rows[0]) throw new BillingError("This price is not available");
  if (await currentSubscription(db, organizationId)) throw new BillingError("The organization already has a subscription: use the billing portal to change it");
  const customerId = await ensureCustomer(db, stripe, organizationId, p.email);
  const session = await createCheckoutSession(stripe, {
    customerId,
    priceId: p.priceId,
    organizationId,
    planCode: rows[0].plan_code,
    successUrl: `${p.appUrl}/billing?ok=checkout`,
    cancelUrl: `${p.appUrl}/billing?ok=checkout_canceled`,
  });
  return session.url;
}

export async function openBillingPortal(db: Queryable, stripe: StripeOptions, organizationId: string, returnUrl: string): Promise<string> {
  const { rows } = await db.query<{ stripe_customer_id: string | null }>("select stripe_customer_id from public.organizations where id = $1", [organizationId]);
  if (!rows[0]?.stripe_customer_id) throw new BillingError("No billing account yet");
  return (await createPortalSession(stripe, { customerId: rows[0].stripe_customer_id, returnUrl })).url;
}

// ---------------------------------------------------------------------------
// Webhook processing
// ---------------------------------------------------------------------------

const ts = (v: unknown) => (typeof v === "number" && v > 0 ? new Date(v * 1000).toISOString() : null);
const str = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null);

async function orgForCustomer(db: Queryable, customerId: string | null, metadataOrg: unknown): Promise<string | null> {
  if (customerId) {
    const { rows } = await db.query<{ id: string }>("select id from public.organizations where stripe_customer_id = $1", [customerId]);
    if (rows[0]) return rows[0].id;
  }
  // First events can arrive before our customer id was stored: fall back to the
  // metadata our server set, but only link an org that has no other customer.
  if (typeof metadataOrg === "string" && /^[0-9a-f-]{36}$/.test(metadataOrg) && customerId) {
    const { rows } = await db.query<{ id: string }>(
      "update public.organizations set stripe_customer_id = $2 where id = $1 and stripe_customer_id is null returning id",
      [metadataOrg, customerId],
    );
    return rows[0]?.id ?? null;
  }
  return null;
}

async function syncSubscription(db: Queryable, sub: Record<string, unknown>, deleted: boolean) {
  const customerId = str(sub.customer);
  const orgId = await orgForCustomer(db, customerId, (sub.metadata as Record<string, unknown> | undefined)?.organization_id);
  if (!orgId) return null;
  const item = ((sub.items as { data?: Record<string, unknown>[] } | undefined)?.data ?? [])[0];
  const priceId = str(item?.price);
  const plan = priceId ? (await db.query<{ plan_code: string }>("select plan_code from public.plan_prices where stripe_price_id = $1", [priceId])).rows[0]?.plan_code ?? null : null;
  const status = deleted ? "canceled" : String(sub.status ?? "incomplete");
  await db.query(
    `insert into public.subscriptions (organization_id, stripe_subscription_id, stripe_customer_id, stripe_price_id, plan_code, status, current_period_start, current_period_end, cancel_at_period_end, canceled_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (stripe_subscription_id) do update set stripe_price_id = excluded.stripe_price_id, plan_code = excluded.plan_code, status = excluded.status,
       current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end, canceled_at = excluded.canceled_at`,
    [
      orgId,
      String(sub.id),
      customerId,
      priceId,
      plan,
      status,
      ts(sub.current_period_start ?? item?.current_period_start),
      ts(sub.current_period_end ?? item?.current_period_end),
      Boolean(sub.cancel_at_period_end),
      ts(sub.canceled_at),
    ],
  );
  if ((status === "active" || status === "trialing") && plan) {
    await db.query("update public.organizations set plan_code = $2 where id = $1", [orgId, plan]);
  } else if (["canceled", "incomplete_expired"].includes(status) && !(await currentSubscription(db, orgId))) {
    // No paid subscription left: back to the platform's default plan.
    await db.query("update public.organizations set plan_code = (select default_plan_code from public.platform_settings where id) where id = $1", [orgId]);
  }
  return orgId;
}

async function syncInvoice(db: Queryable, inv: Record<string, unknown>) {
  const orgId = await orgForCustomer(db, str(inv.customer), undefined);
  if (!orgId) return null;
  const transitions = (inv.status_transitions ?? {}) as Record<string, unknown>;
  await db.query(
    `insert into public.invoices (organization_id, stripe_invoice_id, stripe_subscription_id, number, status, currency, amount_due, amount_paid, hosted_invoice_url, invoice_pdf, period_start, period_end, paid_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (stripe_invoice_id) do update set status = excluded.status, number = excluded.number, amount_due = excluded.amount_due, amount_paid = excluded.amount_paid,
       hosted_invoice_url = excluded.hosted_invoice_url, invoice_pdf = excluded.invoice_pdf, paid_at = excluded.paid_at, updated_at = now()`,
    [
      orgId,
      String(inv.id),
      str(inv.subscription) ?? str((inv.parent as { subscription_details?: { subscription?: unknown } } | undefined)?.subscription_details?.subscription),
      typeof inv.number === "string" ? inv.number : null,
      String(inv.status ?? "open"),
      String(inv.currency ?? "eur"),
      Number(inv.amount_due ?? 0),
      Number(inv.amount_paid ?? 0),
      typeof inv.hosted_invoice_url === "string" ? inv.hosted_invoice_url : null,
      typeof inv.invoice_pdf === "string" ? inv.invoice_pdf : null,
      ts(inv.period_start),
      ts(inv.period_end),
      ts(transitions.paid_at),
    ],
  );
  return orgId;
}

/** Applies one verified Stripe event exactly once. Throws on failure so Stripe retries. */
export async function handleStripeEvent(db: Queryable, event: StripeEvent): Promise<"processed" | "duplicate" | "ignored"> {
  const { rows } = await db.query<{ processed_at: string | null }>(
    `insert into public.stripe_events (id, type) values ($1, $2)
     on conflict (id) do update set type = excluded.type returning processed_at`,
    [event.id, event.type],
  );
  if (rows[0]?.processed_at) return "duplicate";
  const obj = event.data.object;
  let orgId: string | null = null;
  let handled = true;
  try {
    switch (event.type) {
      case "checkout.session.completed":
        orgId = await orgForCustomer(db, str(obj.customer), obj.client_reference_id);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        orgId = await syncSubscription(db, obj, event.type === "customer.subscription.deleted");
        break;
      case "invoice.created":
      case "invoice.finalized":
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.voided":
      case "invoice.marked_uncollectible":
        orgId = await syncInvoice(db, obj);
        break;
      default:
        handled = false;
    }
  } catch (e) {
    await db.query("update public.stripe_events set error = $2 where id = $1", [event.id, (e as Error).message.slice(0, 500)]);
    throw e;
  }
  await db.query("update public.stripe_events set processed_at = now(), organization_id = $2, error = null where id = $1", [event.id, orgId]);
  return handled ? "processed" : "ignored";
}
