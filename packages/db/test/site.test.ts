import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { as, createTestDb, createUser, TEST_DATABASE_URL, type TestDb, type TestUser } from "./harness";
import { ContactRateLimitError, createAgent, createChannel, createContactRequest, getDemoChannelKey, listContactRequests, publicPlans, setContactRequestStatus, setDemoChannelKey } from "../src";

describe.skipIf(!TEST_DATABASE_URL)("public website data", () => {
  let db: TestDb;
  let pool: pg.Pool;
  let user: TestUser;
  const base = { name: "Ana", email: "Ana@Example.com", message: "Quiero información", privacyAccepted: true, marketingConsent: false };

  beforeAll(async () => {
    db = await createTestDb();
    pool = new pg.Pool({ connectionString: db.url });
    user = await createUser(db, "u@x.test");
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    await db?.close();
  });

  it("stores contact requests with consent, hashes the IP and rate-limits per IP", async () => {
    const id = await createContactRequest(pool, { ...base, company: "Clínica" }, "203.0.113.7");
    const row = (await pool.query("select email, privacy_accepted, ip_hash from public.contact_requests where id = $1", [id])).rows[0];
    expect(row.email).toBe("ana@example.com");
    expect(row.privacy_accepted).toBe(true);
    expect(row.ip_hash).not.toContain("203.0.113.7");
    await expect(createContactRequest(pool, { ...base, privacyAccepted: false }, "203.0.113.8")).rejects.toThrow(/Privacy/);
    for (let i = 0; i < 4; i++) await createContactRequest(pool, base, "203.0.113.7");
    await expect(createContactRequest(pool, base, "203.0.113.7")).rejects.toBeInstanceOf(ContactRateLimitError);
    expect((await listContactRequests(pool)).length).toBe(5);
    expect(await setContactRequestStatus(pool, id, "contacted", user.id)).toBe(true);
    expect((await listContactRequests(pool, "contacted")).map((r) => r.id)).toEqual([id]);
  });

  it("contact requests are invisible to every signed-in user (service-only)", async () => {
    await expect(as(db, user, (c) => c.query("select * from public.contact_requests"))).rejects.toThrow();
  });

  it("demo channel key must point to an active web chat", async () => {
    await expect(setDemoChannelKey(pool, "wc_doesnotexistdoesnotexist")).rejects.toThrow();
    const org = (await db.admin.query("insert into public.organizations (name, slug) values ('Agencia', 'agencia') returning id")).rows[0].id;
    await db.admin.query("insert into public.llm_models (provider, model) values ('openai', 'm')");
    const agent = await createAgent(pool, org, { name: "Demo", status: "active", config: { model: "openai:m" } });
    const ch = await createChannel(pool, org, { type: "web", name: "Demo", agentId: agent.id });
    await setDemoChannelKey(pool, ch.public_key);
    expect(await getDemoChannelKey(pool)).toBe(ch.public_key);
    await pool.query("update public.channels set status = 'paused' where id = $1", [ch.id]);
    expect(await getDemoChannelKey(pool)).toBeNull();
    await setDemoChannelKey(pool, null);
  });

  it("public plan list shows only active plans and only prices that exist", async () => {
    const plans = await publicPlans(pool);
    expect(plans.map((p) => p.code)).toEqual(["STARTER", "PRO", "BUSINESS", "ENTERPRISE"]);
    expect(plans.every((p) => p.prices === null)).toBe(true);
  });
});
