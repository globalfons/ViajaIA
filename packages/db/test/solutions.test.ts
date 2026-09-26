import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { FakeProvider } from "@dtn/core/testing/fake-llm";
import { as, createTestDb, createUser, TEST_DATABASE_URL, type TestDb, type TestUser } from "./harness";
import { activateSolution, getOrCreateConversation, handleIncomingMessage, SolutionError } from "../src";

describe.skipIf(!TEST_DATABASE_URL)("solution activation", () => {
  let db: TestDb;
  let pool: pg.Pool;
  const orgs: string[] = [];
  let userB: TestUser;
  const count = async (table: string, org: string) => (await pool.query(`select count(*)::int n from public.${table} where organization_id = $1`, [org])).rows[0].n;
  const input = { model: "openai:chat", embeddingModel: "openai:emb", config: { business_description: "Clínica dental en Valencia especializada en implantes.", business_hours: "L-V 9-14h" } };

  beforeAll(async () => {
    db = await createTestDb();
    pool = new pg.Pool({ connectionString: db.url });
    for (const slug of ["clinica-a", "clinica-b", "clinica-c"]) orgs.push((await db.admin.query("insert into public.organizations (name, slug) values ($1, $1) returning id", [slug])).rows[0].id);
    userB = await createUser(db, "b@b.test");
    await db.admin.query("insert into public.memberships values ($1, $2, 'owner')", [orgs[1], userB.id]);
    await db.admin.query("insert into public.llm_models (provider, model, kind) values ('openai', 'chat', 'chat'), ('openai', 'emb', 'embedding')");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.close();
  });

  it("provisions agent, knowledge base, published workflow and web channel in one go", async () => {
    const r = await activateSolution(pool, orgs[0]!, { ...input, solutionKey: "customer_support" });
    expect(r.agentIds).toHaveLength(1);
    expect(r.knowledgeBaseId && r.workflowId && r.channelId && r.channelKey).toBeTruthy();
    const agent = (await pool.query("select status, config from public.agents where id = $1", [r.agentIds[0]])).rows[0];
    expect(agent.status).toBe("active");
    expect(agent.config.knowledgeBaseIds).toEqual([r.knowledgeBaseId]);
    expect(agent.config.systemPrompt).toContain("{{business_description}}");
    const wf = (await pool.query("select status, published_version from public.workflows where id = $1", [r.workflowId])).rows[0];
    expect(wf).toEqual({ status: "active", published_version: 1 });
    const inst = (await pool.query("select solution_key, template_id, config from public.solution_instances where id = $1", [r.instanceId])).rows[0];
    expect(inst).toMatchObject({ solution_key: "customer_support", template_id: "SOL-CUSTOMER-SUPPORT-v1" });
  });

  it("client configuration reaches the agent prompt at runtime", async () => {
    const llm = new FakeProvider("openai", [{ content: JSON.stringify({ answer: "Hola", confidence: 0.9, needs_human: false }) }]);
    const agentId = (await pool.query("select agent_ids[1] id from public.solution_instances where organization_id = $1", [orgs[0]])).rows[0].id;
    const conv = await getOrCreateConversation(pool, { organizationId: orgs[0]!, agentId, channelType: "api" });
    await handleIncomingMessage(pool, { organizationId: orgs[0]!, conversation: conv, text: "hola", runtime: { providers: { openai: llm } } });
    const system = llm.requests[0]!.messages[0]!.content;
    expect(system).toContain("Clínica dental en Valencia especializada en implantes.");
    expect(system).toContain("L-V 9-14h");
  });

  it("is reusable: the same solution for many organizations, fully isolated", async () => {
    await activateSolution(pool, orgs[1]!, { ...input, solutionKey: "customer_support" });
    await activateSolution(pool, orgs[1]!, { ...input, solutionKey: "sales_agent", config: { ...input.config, ideal_customer: "Pymes" } });
    expect(await count("agents", orgs[1]!)).toBe(2);
    const seen = await as(db, userB, async (c) => (await c.query("select organization_id from public.solution_instances")).rows);
    expect(new Set(seen.map((r) => r.organization_id))).toEqual(new Set([orgs[1]]));
  });

  it("rolls back everything when a requirement is missing (no half-provisioned client)", async () => {
    await expect(activateSolution(pool, orgs[2]!, { ...input, solutionKey: "customer_support", embeddingModel: null })).rejects.toThrow(/embeddings/);
    await expect(activateSolution(pool, orgs[2]!, { ...input, solutionKey: "lead_qualification", config: {} })).rejects.toBeInstanceOf(SolutionError);
    await expect(activateSolution(pool, orgs[2]!, { ...input, solutionKey: "nope" })).rejects.toThrow(/Unknown solution/);
    for (const t of ["agents", "knowledge_bases", "workflows", "channels", "solution_instances"]) expect(await count(t, orgs[2]!), t).toBe(0);
  });

  it("respects plan limits inside the transaction", async () => {
    await db.admin.query("update public.organizations set limits = '{\"max_agents\": 0}' where id = $1", [orgs[2]]);
    await expect(activateSolution(pool, orgs[2]!, { ...input, solutionKey: "customer_support" })).rejects.toThrow(/max_agents/);
    expect(await count("knowledge_bases", orgs[2]!)).toBe(0);
  });
});
