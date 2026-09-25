// Seeds the E2E stack: a platform admin (via the real Auth API) and a client org.
// Uses only local E2E keys from docker/e2e/.env.e2e. Idempotent.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(new URL("../docker/e2e/.env.e2e", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const url = process.env.E2E_SUPABASE_URL ?? "http://localhost:54321";
const email = process.env.E2E_ADMIN_EMAIL ?? "admin@agency.test";
const password = process.env.E2E_ADMIN_PASSWORD ?? "Passw0rd!123";

const res = await fetch(`${url}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: env.SERVICE_ROLE_KEY, authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, "content-type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
if (!res.ok && res.status !== 422) throw new Error(`create admin: ${res.status} ${await res.text()}`);

const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? `postgresql://postgres:${env.POSTGRES_PASSWORD}@127.0.0.1:54322/postgres` });
await db.connect();
await db.query("update public.profiles set is_platform_admin = true where email = $1", [email]);
await db.query("insert into public.organizations (name, slug) values ('E2E Cliente A', 'e2e-cliente-a') on conflict (slug) do nothing");
await db.end();
console.log(`seeded ${email} (platform admin) and org e2e-cliente-a`);
