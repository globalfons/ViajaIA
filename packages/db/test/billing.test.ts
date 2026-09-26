import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { parseStripeEvent, signStripePayload, verifyStripeSignature } from "@dtn/core";
import { as, createTestDb, createUser, TEST_DATABASE_URL, type TestDb, type TestUser } from "./harness";
import { addPlanPrice, BillingError, handleStripeEvent, openBillingPortal, platformClients, platformOverview, startCheckout } from "../src";

/** Test double for the Stripe REST API. */
function stripeDouble() {
  const calls: { method: string; path: string; body: URLSearchParams | null; idem: string | null }[] = [];
  const prices: Record<string, unknown> = {
    price_pro: { id: "price_pro", active: true, currency: "eur", unit_amount: 9900, recurring: { interval: "month", interval_count: 1 }, product: "prod_1" },
    price_old: { id: "price_old", active: false, currency: "eur", unit_amount: 100, recurring: { interval: "month", interval_count: 1 }, product: "prod_1" },
    price_once: { id: "price_once", active: true, currency: "eur", unit_amount: 100, recurring: null, product: "prod_1" },
  };
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const path = u.pathname.replace(/^\/v1/, "");
    const headers = new Headers(init?.headers);
    calls.push({ method: init?.method ?? "GET", path, body: init?.body ? new URLSearchParams(String(init.body)) : null, idem: headers.get("idempotency-key") });
    if (path.startsWith("/prices/")) {
      const p = prices[path.slice(8)];
      return p ? new Response(JSON.stringify(p)) : new Response(JSON.stringify({ error: { message: "No such price" } }), { status: 404 });
    }
    if (path === "/customers") return new Response(JSON.stringify({ id: "cus_A" }));
    if (path === "/checkout/sessions") return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" }));
    if (path === "/billing_portal/sessions") return new Response(JSON.stringify({ id: "bps_1", url: "https://billing.stripe.test/p" }));
    return new Response("{}", { status: 404 });
  });
  return { stripe: { secretKey: "sk_test_x", baseUrl: "http://stripe.test/v1", fetch: f as unknown as typeof fetch }, calls };
}

const ev = (id: string, type: string, object: Record<string, unknown>) => ({ id, type, created: 1, data: { object } });

describe.skipIf(!TEST_DATABASE_URL)("Stripe billing", () => {
  let db: TestDb;
  let pool: pg.Pool;
  let org: string;
  let other: string;
  let owner: TestUser;
  let outsider: TestUser;
  const { stripe, calls } = stripeDouble();

  beforeAll(async () => {
    db = await createTestDb();
    pool = new pg.Pool({ connectionString: db.url });
    org = (await db.admin.query("insert into public.organizations (name, slug) values ('Academia', 'academia') returning id")).rows[0].id;
    other = (await db.admin.query("insert into public.organizations (name, slug) values ('Otra', 'otra') returning id")).rows[0].id;
    owner = await createUser(db, "o@academia.test");
    outsider = await createUser(db, "x@otra.test");
    await db.admin.query("insert into public.memberships values ($1, $2, 'owner'), ($3, $4, 'owner')", [org, owner.id, other, outsider.id]);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.close();
  });

  it("verifies Stripe signatures with replay tolerance", () => {
    const payload = JSON.stringify(ev("evt_1", "x", {}));
    const header = signStripePayload(payload, "whsec_test");
    expect(verifyStripeSignature(payload, header, "whsec_test")).toBe(true);
    expect(verifyStripeSignature(payload + " ", header, "whsec_test")).toBe(false);
    expect(verifyStripeSignature(payload, header, "whsec_other")).toBe(false);
    expect(verifyStripeSignature(payload, signStripePayload(payload, "whsec_test", Math.floor(Date.now() / 1000) - 3600), "whsec_test")).toBe(false);
    expect(parseStripeEvent("{}")).toBeNull();
  });

  it("maps plans to real Stripe prices only (amount comes from Stripe)", async () => {
    await expect(addPlanPrice(pool, stripe, "PRO", "price_old")).rejects.toBeInstanceOf(BillingError);
    await expect(addPlanPrice(pool, stripe, "PRO", "price_once")).rejects.toThrow(/recurring/);
    await expect(addPlanPrice(pool, stripe, "PRO", "price_missing")).rejects.toThrow(/404/);
    await addPlanPrice(pool, stripe, "PRO", "price_pro");
    expect((await pool.query("select plan_code, currency, unit_amount, interval from public.plan_prices")).rows).toEqual([{ plan_code: "PRO", currency: "eur", unit_amount: "9900", interval: "month" }]);
    // Clients can read prices but never write them.
    expect(await as(db, owner, async (c) => (await c.query("select stripe_price_id from public.plan_prices")).rowCount)).toBe(1);
    await expect(as(db, owner, (c) => c.query("update public.plan_prices set unit_amount = 1"))).rejects.toThrow();
  });

  it("starts checkout with an idempotent customer bound to the organization", async () => {
    const url = await startCheckout(pool, stripe, org, { priceId: "price_pro", email: "o@academia.test", appUrl: "https://app.test" });
    expect(url).toBe("https://checkout.stripe.test/cs_1");
    const customer = calls.find((c) => c.path === "/customers")!;
    expect(customer.idem).toBe(`customer-${org}`);
    expect(customer.body!.get("metadata[organization_id]")).toBe(org);
    const session = calls.find((c) => c.path === "/checkout/sessions")!;
    expect(Object.fromEntries(session.body!)).toMatchObject({ mode: "subscription", customer: "cus_A", client_reference_id: org, "line_items[0][price]": "price_pro", success_url: "https://app.test/billing?ok=checkout" });
    await expect(startCheckout(pool, stripe, org, { priceId: "price_unknown", email: null, appUrl: "x" })).rejects.toThrow(/not available/);
    expect(await openBillingPortal(pool, stripe, org, "https://app.test/billing")).toBe("https://billing.stripe.test/p");
    await expect(openBillingPortal(pool, stripe, other, "x")).rejects.toThrow(/No billing account/);
  });

  it("webhooks: subscription activates the plan, invoices are mirrored, events apply once", async () => {
    const sub = { id: "sub_1", customer: "cus_A", status: "active", items: { data: [{ price: { id: "price_pro" }, current_period_start: 1767225600, current_period_end: 1769904000 }] }, cancel_at_period_end: false, metadata: { organization_id: org } };
    expect(await handleStripeEvent(pool, ev("evt_s1", "customer.subscription.created", sub))).toBe("processed");
    expect(await handleStripeEvent(pool, ev("evt_s1", "customer.subscription.created", sub))).toBe("duplicate");
    expect((await pool.query("select plan_code from public.organizations where id = $1", [org])).rows[0].plan_code).toBe("PRO");
    await expect(startCheckout(pool, stripe, org, { priceId: "price_pro", email: null, appUrl: "x" })).rejects.toThrow(/already has a subscription/);

    const paidAt = Math.floor(Date.now() / 1000);
    await handleStripeEvent(pool, ev("evt_i1", "invoice.paid", { id: "in_1", customer: "cus_A", subscription: "sub_1", number: "A-0001", status: "paid", currency: "eur", amount_due: 9900, amount_paid: 9900, hosted_invoice_url: "https://invoice.stripe.test/1", status_transitions: { paid_at: paidAt } }));
    expect((await pool.query("select number, status, amount_paid from public.invoices where organization_id = $1", [org])).rows).toEqual([{ number: "A-0001", status: "paid", amount_paid: "9900" }]);
    // Unknown customers are ignored (no cross-tenant attribution).
    await handleStripeEvent(pool, ev("evt_i2", "invoice.paid", { id: "in_x", customer: "cus_unknown", status: "paid", currency: "eur", amount_paid: 5 }));
    expect((await pool.query("select count(*)::int n from public.invoices")).rows[0].n).toBe(1);

    await handleStripeEvent(pool, ev("evt_s2", "customer.subscription.deleted", { ...sub, status: "canceled" }));
    expect((await pool.query("select plan_code from public.organizations where id = $1", [org])).rows[0].plan_code).toBe("STARTER");
    expect((await pool.query("select status from public.subscriptions where stripe_subscription_id = 'sub_1'")).rows[0].status).toBe("canceled");
    expect(await handleStripeEvent(pool, ev("evt_other", "customer.created", {}))).toBe("ignored");
  });

  it("tenant isolation for subscriptions and invoices; stripe_events is service-only", async () => {
    const seen = await as(db, outsider, async (c) => ({
      subs: (await c.query("select 1 from public.subscriptions")).rowCount,
      inv: (await c.query("select 1 from public.invoices")).rowCount,
    }));
    expect(seen).toEqual({ subs: 0, inv: 0 });
    expect(await as(db, owner, async (c) => (await c.query("select 1 from public.invoices")).rowCount)).toBe(1);
    await expect(as(db, owner, (c) => c.query("select * from public.stripe_events"))).rejects.toThrow();
  });

  it("platform overview reports real revenue from paid invoices only", async () => {
    const o = await platformOverview(pool);
    expect(o.clients).toEqual({ active: 2, suspended: 0 });
    expect(o.monthlyRevenue).toEqual([{ currency: "eur", amount: 9900 }]);
    expect(o.runs.errorRate).toBeNull(); // no runs yet: no invented rate
    const clients = await platformClients(pool);
    expect(clients.find((c) => c.id === org)).toMatchObject({ members: 1, subscription_status: "canceled" });
  });
});
