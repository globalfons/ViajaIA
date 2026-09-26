import { createHash } from "node:crypto";
import type { Queryable } from "./pool";
import { rateLimitHit } from "./agents";

/** Public website: contact requests (service-only table) and public plan catalog. */

export class ContactRateLimitError extends Error {}

export interface ContactInput {
  name: string;
  email: string;
  company?: string | null;
  phone?: string | null;
  interest?: string | null;
  message: string;
  privacyAccepted: boolean;
  marketingConsent: boolean;
  sourcePath?: string | null;
}

export async function createContactRequest(db: Queryable, input: ContactInput, ip: string | null): Promise<string> {
  if (!input.privacyAccepted) throw new Error("Privacy policy must be accepted");
  // Only a salted hash of the IP is kept, for abuse control.
  const ipHash = ip ? createHash("sha256").update(`${process.env.SECRETS_ENCRYPTION_KEYS ?? ""}:${ip}`).digest("hex").slice(0, 32) : null;
  if (ipHash && !(await rateLimitHit(db, `contact:${ipHash}`, 3600, 5))) throw new ContactRateLimitError("Too many requests");
  if (!(await rateLimitHit(db, "contact:global", 60, 30))) throw new ContactRateLimitError("Too many requests");
  const { rows } = await db.query<{ id: string }>(
    `insert into public.contact_requests (name, email, company, phone, interest, message, privacy_accepted, marketing_consent, source_path, ip_hash)
     values ($1, lower($2), $3, $4, $5, $6, true, $7, $8, $9) returning id`,
    [input.name, input.email, input.company || null, input.phone || null, input.interest || null, input.message, input.marketingConsent, input.sourcePath ?? null, ipHash],
  );
  return rows[0]!.id;
}

export async function listContactRequests(db: Queryable, status?: string) {
  const { rows } = await db.query<{ id: string; name: string; email: string; company: string | null; phone: string | null; interest: string | null; message: string; marketing_consent: boolean; status: string; created_at: string }>(
    `select id, name, email, company, phone, interest, message, marketing_consent, status, created_at from public.contact_requests
     where ($1::text is null or status = $1) order by created_at desc limit 200`,
    [status ?? null],
  );
  return rows;
}

export async function setContactRequestStatus(db: Queryable, id: string, status: "new" | "contacted" | "closed" | "spam", userId: string) {
  const res = await db.query("update public.contact_requests set status = $2, handled_by = $3 where id = $1", [id, status, userId]);
  return (res.rowCount ?? 0) > 0;
}

export async function publicPlans(db: Queryable) {
  const { rows } = await db.query<{ code: string; name: string; description: string | null; limits: Record<string, number | null>; prices: { currency: string; unit_amount: number; interval: string }[] | null }>(
    `select p.code, p.name, p.description, p.limits,
       (select json_agg(json_build_object('currency', x.currency, 'unit_amount', x.unit_amount, 'interval', x.interval) order by x.unit_amount)
          from public.plan_prices x where x.plan_code = p.code and x.active) prices
     from public.plans p where p.active order by p.sort_order`,
  );
  return rows;
}

export async function getDemoChannelKey(db: Queryable): Promise<string | null> {
  const { rows } = await db.query<{ key: string | null }>(
    `select s.demo_channel_key key from public.platform_settings s
     where s.id and exists (select 1 from public.channels c join public.organizations o on o.id = c.organization_id
       where c.public_key = s.demo_channel_key and c.type = 'web' and c.status = 'active' and o.status = 'active')`,
  );
  return rows[0]?.key ?? null;
}

export async function setDemoChannelKey(db: Queryable, key: string | null) {
  if (key) {
    const { rowCount } = await db.query("select 1 from public.channels where public_key = $1 and type = 'web'", [key]);
    if (!rowCount) throw new Error("Unknown web chat key");
  }
  await db.query("update public.platform_settings set demo_channel_key = $1 where id", [key]);
}
