import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { z } from "zod";
import type { ToolDefinition } from "@dtn/core";
import { FakeProvider, toolCall } from "@dtn/core/testing/fake-llm";
import { as, createTestDb, createUser, TEST_DATABASE_URL, type TestDb, type TestUser } from "./harness";
import {
  archiveAgent,
  createAgent,
  generateApiKey,
  getAgent,
  listAgents,
  NotFoundError,
  rateLimitHit,
  resumeAgentRun,
  runAgent,
  updateAgent,
  verifyApiKey,
} from "../src";

describe.skipIf(!TEST_DATABASE_URL)("agent service, API keys and templates", () => {
  let db: TestDb;
  let pool: pg.Pool;
  let a: string;
  let b: string;
  let alice: TestUser;
  let bob: TestUser;
  let admin: TestUser;
  const baseConfig = { model: "openai:m", tools: ["send_offer"], humanApproval: { tools: ["send_offer"] } };
  const sendOffer = vi.fn(async () => ({ sent: true }));
  const sendOfferTool: ToolDefinition = { name: "send_offer", description: "Send", risk: "external", parameters: z.object({ to: z.string() }), execute: sendOffer };

  beforeAll(async () => {
    db = await createTestDb();
    pool = new pg.Pool({ connectionString: db.url });
    alice = await createUser(db, "alice@a.test");
    bob = await createUser(db, "bob@b.test");
    admin = await createUser(db, "root@agency.test", { platformAdmin: true });
    a = (await db.admin.query("insert into public.organizations (name, slug, limits) values ('Acme', 'acme', '{\"max_agents\": 2}') returning id")).rows[0].id;
    b = (await db.admin.query("insert into public.organizations (name, slug) values ('B', 'b') returning id")).rows[0].id;
    await db.admin.query("insert into public.memberships values ($1, $2, 'owner'), ($3, $4, 'owner')", [a, alice.id, b, bob.id]);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.close();
  });

  it("creates, updates, lists and archives agents within the tenant", async () => {
    const agent = await createAgent(pool, a, { name: "Ventas", config: baseConfig, status: "active" }, alice.id);
    expect(agent.version).toBe(1);
    const updated = await updateAgent(pool, a, agent.id, { config: { ...baseConfig, temperature: 1 } });
    expect(updated.version).toBe(2);
    expect((await listAgents(pool, a)).map((x) => x.id)).toContain(agent.id);
    await expect(getAgent(pool, b, agent.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateAgent(pool, b, agent.id, { name: "hijack" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(archiveAgent(pool, b, agent.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("validates configs and enforces the max_agents limit", async () => {
    await expect(createAgent(pool, a, { name: "x", config: { model: "nope" } })).rejects.toThrow();
    await createAgent(pool, a, { name: "Segundo", config: baseConfig });
    await expect(createAgent(pool, a, { name: "Tercero", config: baseConfig })).rejects.toThrow(/max_agents/);
  });

  it("runs, pauses for approval, and resumes exactly once", async () => {
    const [agent] = await listAgents(pool, a);
    const provider = new FakeProvider("openai", [{ toolCalls: [toolCall("send_offer", { to: "lead@x.test" })] }, { content: "Oferta enviada" }]);
    const runtime = { providers: { openai: provider }, extraTools: [sendOfferTool] };
    const agentId = (await listAgents(pool, a)).find((x) => x.name === "Ventas")!.id;
    expect(agent).toBeDefined();

    const paused = await runAgent({ db: pool, organizationId: a, agentId, message: "Envía la oferta", source: "playground", userId: alice.id, runtime, allowInactive: true });
    expect(paused.result.status).toBe("needs_approval");
    expect(sendOffer).not.toHaveBeenCalled();

    // Another tenant cannot approve it.
    await expect(resumeAgentRun({ db: pool, organizationId: b, runId: paused.runId, approved: true, runtime })).rejects.toBeInstanceOf(NotFoundError);

    const [first, second] = await Promise.allSettled([
      resumeAgentRun({ db: pool, organizationId: a, runId: paused.runId, approved: true, userId: alice.id, runtime }),
      resumeAgentRun({ db: pool, organizationId: a, runId: paused.runId, approved: true, userId: alice.id, runtime }),
    ]);
    const ok = [first, second].filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    expect(sendOffer).toHaveBeenCalledOnce();

    const { rows } = await db.admin.query("select status, state, decided_by from public.agent_runs where id = $1", [paused.runId]);
    expect(rows[0]).toMatchObject({ status: "completed", state: null, decided_by: alice.id });
  });

  it("members can read runs but never the internal paused state", async () => {
    const cols = await as(db, alice, async (c) => (await c.query("select id, status, output from public.agent_runs")).rows);
    expect(cols.length).toBeGreaterThan(0);
    await expect(as(db, alice, (c) => c.query("select state from public.agent_runs"))).rejects.toThrow(/permission denied/);
    const foreign = await as(db, bob, async (c) => (await c.query("select count(*)::int n from public.agent_runs")).rows[0].n);
    expect(foreign).toBe(0);
  });

  it("verifies API keys: valid, revoked, malformed, suspended org", async () => {
    const k = generateApiKey();
    await db.admin.query("insert into public.api_keys (organization_id, name, prefix, key_hash, scopes) values ($1, 'k', $2, $3, '{agents:read}')", [a, k.prefix, k.hash]);
    expect(await verifyApiKey(pool, k.key)).toMatchObject({ organizationId: a, scopes: ["agents:read"] });
    expect(await verifyApiKey(pool, "dtn_short")).toBeNull();
    expect(await verifyApiKey(pool, generateApiKey().key)).toBeNull();

    await db.admin.query("update public.organizations set status = 'suspended' where id = $1", [a]);
    expect(await verifyApiKey(pool, k.key)).toBeNull();
    await db.admin.query("update public.organizations set status = 'active' where id = $1", [a]);

    await db.admin.query("update public.api_keys set revoked_at = now() where key_hash = $1", [k.hash]);
    expect(await verifyApiKey(pool, k.key)).toBeNull();
  });

  it("stores only hashes and lets owners revoke but not alter keys", async () => {
    const { rows } = await db.admin.query("select key_hash from public.api_keys limit 1");
    expect(rows[0].key_hash).toMatch(/^[0-9a-f]{64}$/);
    await expect(as(db, alice, (c) => c.query("update public.api_keys set scopes = '{usage:read}'"))).rejects.toThrow(/permission denied/);
    const r = await as(db, alice, (c) => c.query("update public.api_keys set revoked_at = now() where organization_id = $1", [a]));
    expect(r.rowCount).toBeGreaterThan(0);
  });

  it("rate limits per key and window", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimitHit(pool, "test:key", 60, 3));
    expect(results).toEqual([true, true, true, false]);
    expect(await rateLimitHit(pool, "test:other", 60, 3)).toBe(true);
  });

  it("templates: platform-wide visible to all, org templates private, only admins publish globally", async () => {
    await as(db, admin, (c) => c.query("insert into public.templates (kind, name, config) values ('agent', 'Global', '{}')"), { commit: true });
    await as(db, alice, (c) => c.query("insert into public.templates (organization_id, kind, name, config) values ($1, 'agent', 'Acme only', '{}')", [a]), { commit: true });
    const bobSees = await as(db, bob, async (c) => (await c.query("select name from public.templates order by name")).rows.map((r) => r.name));
    expect(bobSees).toEqual(["Global"]);
    await expect(as(db, alice, (c) => c.query("insert into public.templates (kind, name, config) values ('agent', 'Fake global', '{}')"))).rejects.toThrow(
      /row-level security/,
    );
  });
});
