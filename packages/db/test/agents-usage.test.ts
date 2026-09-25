import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { parseAgentConfig } from "@dtn/core";
import { FakeProvider, toolCall } from "@dtn/core/testing/fake-llm";
import { as, createTestDb, createUser, TEST_DATABASE_URL, type TestDb, type TestUser } from "./harness";
import { BudgetGuard, createAgentRuntime, OrganizationSuspendedError } from "../src";

describe.skipIf(!TEST_DATABASE_URL)("agents, usage and budgets", () => {
  let db: TestDb;
  let pool: pg.Pool;
  let owner: TestUser;
  let viewer: TestUser;
  let other: TestUser;
  let org: string;
  let otherOrg: string;
  const config = parseAgentConfig({ name: "Soporte", model: "openai:test-model", tools: ["current_datetime"] });

  beforeAll(async () => {
    db = await createTestDb();
    pool = new pg.Pool({ connectionString: db.url });
    owner = await createUser(db, "owner@a.test");
    viewer = await createUser(db, "viewer@a.test");
    other = await createUser(db, "other@b.test");
    const q = (sql: string, p: unknown[]) => db.admin.query(sql, p);
    org = (await q("insert into public.organizations (name, slug, limits) values ('A', 'a', $1) returning id", [{ monthly_llm_cost_usd: 1 }])).rows[0].id;
    otherOrg = (await q("insert into public.organizations (name, slug) values ('B', 'b') returning id", [])).rows[0].id;
    await q("insert into public.memberships values ($1, $2, 'owner'), ($1, $3, 'viewer'), ($4, $5, 'owner')", [org, owner.id, viewer.id, otherOrg, other.id]);
    await q("insert into public.llm_models (provider, model, input_per_mtok, output_per_mtok) values ('openai', 'test-model', 1000, 1000)", []);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.close();
  });

  it("versions agent configs automatically", async () => {
    const id = await as(
      db,
      owner,
      async (c) => {
        const { rows } = await c.query("insert into public.agents (organization_id, name, config) values ($1, 'Soporte', $2) returning id", [org, config]);
        await c.query("update public.agents set config = $2 where id = $1", [rows[0].id, { ...config, temperature: 0.9 }]);
        await c.query("update public.agents set name = 'Soporte 2' where id = $1", [rows[0].id]); // no config change → same version
        return rows[0].id as string;
      },
      { commit: true },
    );
    const { rows } = await db.admin.query("select version from public.agent_versions where agent_id = $1 order by version", [id]);
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    const agent = (await db.admin.query("select version from public.agents where id = $1", [id])).rows[0];
    expect(agent.version).toBe(2);
  });

  it("viewers cannot create agents; other tenants cannot see them", async () => {
    await expect(
      as(db, viewer, (c) => c.query("insert into public.agents (organization_id, name, config) values ($1, 'x', $2)", [org, config])),
    ).rejects.toThrow(/row-level security/);
    const n = await as(db, other, async (c) => (await c.query("select count(*)::int n from public.agents")).rows[0].n);
    expect(n).toBe(0);
  });

  it("records usage and tool invocations, attributed to the tenant", async () => {
    const provider = new FakeProvider("openai", [
      { toolCalls: [toolCall("current_datetime")], usage: { inputTokens: 100, outputTokens: 10 } },
      { content: "Son las 10:00", usage: { inputTokens: 120, outputTokens: 5 } },
    ]);
    const { runtime } = await createAgentRuntime({ db: pool, providers: { openai: provider } });
    const res = await runtime.run({ organizationId: org, config, message: "¿Qué hora es?" });
    expect(res.status).toBe("completed");

    const usage = await db.admin.query("select provider, model, input_tokens, cost_usd::float as cost from public.usage_events where organization_id = $1 order by id", [org]);
    expect(usage.rows).toHaveLength(2);
    expect(usage.rows[0]).toMatchObject({ provider: "openai", model: "test-model", input_tokens: 100 });
    expect(usage.rows[0].cost).toBeCloseTo(0.11); // (100 + 10) * 1000 / 1e6
    const tools = await db.admin.query("select tool_name, status from public.tool_invocations where organization_id = $1", [org]);
    expect(tools.rows).toEqual([{ tool_name: "current_datetime", status: "success" }]);
  });

  it("tenants can read their usage but never write or see others'", async () => {
    await expect(
      as(db, owner, (c) =>
        c.query("insert into public.usage_events (organization_id, provider, model, cost_usd) values ($1, 'openai', 'x', -100)", [org]),
      ),
    ).rejects.toThrow(/row-level security|permission denied/);
    const mine = await as(db, owner, async (c) => (await c.query("select count(*)::int n from public.usage_daily")).rows[0].n);
    const theirs = await as(db, other, async (c) => (await c.query("select count(*)::int n from public.usage_daily")).rows[0].n);
    expect(mine).toBeGreaterThan(0);
    expect(theirs).toBe(0);
  });

  it("blocks LLM calls once the monthly budget is exhausted", async () => {
    await db.admin.query("insert into public.usage_events (organization_id, provider, model, cost_usd) values ($1, 'openai', 'test-model', 5)", [org]);
    const provider = new FakeProvider("openai", [{ content: "should not be called" }]);
    const { runtime } = await createAgentRuntime({ db: pool, providers: { openai: provider } });
    const res = await runtime.run({ organizationId: org, config, message: "hola" });
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/Limit exceeded: monthly_llm_cost_usd/);
    expect(provider.requests).toHaveLength(0);
  });

  it("enforces per-agent monthly budgets", async () => {
    const agentId = (
      await db.admin.query("insert into public.agents (organization_id, name, config) values ($1, 'b', $2) returning id", [
        otherOrg,
        { ...config, limits: { ...config.limits, monthlyCostUsd: 0.5 } },
      ])
    ).rows[0].id;
    await db.admin.query("insert into public.usage_events (organization_id, agent_id, provider, model, cost_usd) values ($1, $2, 'openai', 'm', 0.6)", [otherOrg, agentId]);
    await expect(new BudgetGuard(pool).check({ organizationId: otherOrg, agentId })).rejects.toThrow(/Limit exceeded/);
    await expect(new BudgetGuard(pool).check({ organizationId: otherOrg })).resolves.toBeUndefined();
  });

  it("suspended organizations cannot spend", async () => {
    await db.admin.query("update public.organizations set status = 'suspended' where id = $1", [otherOrg]);
    await expect(new BudgetGuard(pool).check({ organizationId: otherOrg })).rejects.toBeInstanceOf(OrganizationSuspendedError);
    await db.admin.query("update public.organizations set status = 'active' where id = $1", [otherOrg]);
  });
});
