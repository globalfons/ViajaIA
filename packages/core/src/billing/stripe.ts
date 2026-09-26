import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal Stripe REST client (Checkout, Billing Portal, Prices) and webhook
 * signature verification. No prices are defined in code: plans are mapped to
 * Stripe Price IDs by the platform admin and amounts are read from Stripe.
 */

export const DEFAULT_STRIPE_API_BASE = "https://api.stripe.com/v1";

export class StripeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}

export interface StripeOptions {
  secretKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** Stripe form encoding: nested objects/arrays → a[b][0]=… */
export function stripeForm(params: Record<string, unknown>, prefix = ""): URLSearchParams {
  const out = new URLSearchParams();
  const walk = (value: unknown, key: string) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${key}[${i}]`));
    else if (typeof value === "object") for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, key ? `${key}[${k}]` : k);
    else out.append(key, String(value));
  };
  walk(params, prefix);
  return out;
}

async function stripe<T>(o: StripeOptions, method: "GET" | "POST", path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const base = (o.baseUrl ?? DEFAULT_STRIPE_API_BASE).replace(/\/$/, "");
  const headers: Record<string, string> = { authorization: `Bearer ${o.secretKey}` };
  if (method === "POST") headers["content-type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const res = await (o.fetch ?? fetch)(`${base}${path}`, {
    method,
    headers,
    body: method === "POST" && params ? stripeForm(params).toString() : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string } };
  if (!res.ok) throw new StripeApiError(`Stripe ${res.status}: ${String(body.error?.message ?? "request failed").slice(0, 200)}`, res.status, body.error?.code);
  return body;
}

export interface StripePrice {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  recurring: { interval: "day" | "week" | "month" | "year"; interval_count: number } | null;
  product: string;
}

export const getStripePrice = (o: StripeOptions, priceId: string) => {
  if (!/^price_[A-Za-z0-9]+$/.test(priceId)) throw new StripeApiError("Invalid price id", 400);
  return stripe<StripePrice>(o, "GET", `/prices/${priceId}`);
};

export const createStripeCustomer = (o: StripeOptions, p: { organizationId: string; name: string; email?: string | null }) =>
  stripe<{ id: string }>(o, "POST", "/customers", { name: p.name, email: p.email ?? undefined, metadata: { organization_id: p.organizationId } }, `customer-${p.organizationId}`);

export const createCheckoutSession = (
  o: StripeOptions,
  p: { customerId: string; priceId: string; organizationId: string; planCode: string; successUrl: string; cancelUrl: string },
) =>
  stripe<{ id: string; url: string }>(o, "POST", "/checkout/sessions", {
    mode: "subscription",
    customer: p.customerId,
    client_reference_id: p.organizationId,
    line_items: [{ price: p.priceId, quantity: 1 }],
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
    allow_promotion_codes: true,
    subscription_data: { metadata: { organization_id: p.organizationId, plan_code: p.planCode } },
    metadata: { organization_id: p.organizationId, plan_code: p.planCode },
  });

export const createPortalSession = (o: StripeOptions, p: { customerId: string; returnUrl: string }) =>
  stripe<{ id: string; url: string }>(o, "POST", "/billing_portal/sessions", { customer: p.customerId, return_url: p.returnUrl });

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Verifies the Stripe-Signature header (v1 HMAC-SHA256 of "t.payload"), with replay tolerance. */
export function verifyStripeSignature(payload: string, header: string | null | undefined, secret: string, toleranceSeconds = 300, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest();
  return sigs.some((s) => {
    const given = Buffer.from(s, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Builds a valid Stripe-Signature header (tests and local tooling). */
export function signStripePayload(payload: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;
}

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

export function parseStripeEvent(payload: string): StripeEvent | null {
  try {
    const e = JSON.parse(payload) as StripeEvent;
    if (typeof e?.id !== "string" || !e.id.startsWith("evt_") || typeof e.type !== "string" || !e.data?.object) return null;
    return e;
  } catch {
    return null;
  }
}

/** Money helper: minor units → display string (no invented amounts: input comes from Stripe). */
export function formatMoney(minor: number, currency: string, locale = "es-ES"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(minor / 100);
}
