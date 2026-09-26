import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { HubSpotSync } from "@dtn/core";
import { FakeProvider, mockFetch, toolCall } from "@dtn/core/testing/fake-llm";
import { as, createTestDb, createUser, TEST_DATABASE_URL, type TestDb, type TestUser } from "./harness";
import { createAgent, createLeadManually, CrmError, getOrCreateConversation, handleIncomingMessage, moveLeadStage, NotFoundError, pipelineSummary } from "../src";

describe.skipIf(!TEST_DATABASE_URL)("CRM", () => {
  let db: TestDb;
  let pool: pg.Pool;
  let org: string;
  let other: string;
  let outsider: TestUser;
  const llm = new FakeProvider("openai");
  const runtime = { providers: { openai: llm } };

  beforeAll(async () => {
    db = await createTestDb();
    pool = new pg.Pool({ connectionString: db.url });
    org = (await db.admin.query("insert into public.organizations (name, slug) values ('Academia', 'academia') returning id")).rows[0].id;
    other = (await db.admin.query("insert into public.organizations (name, slug) values ('Otra', 'otra') returning id")).rows[0].id;
    outsider = await createUser(db, "x@otra.test");
    await db.admin.query("insert into public.memberships values ($1, $2, 'owner')", [other, outsider.id]);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.close();
  });

  it("an agent captures an inbound lead with the tool and links it to the conversation", async () => {
    const agent = await createAgent(pool, org, { name: "Ventas", status: "active", config: { model: "openai:m", tools: ["crm_capture_lead", "crm_create_task"] } });
    const conv = await getOrCreateConversation(pool, { organizationId: org, agentId: agent.id, channelType: "web", visitorId: "v1234567890123456" });
    llm.push(
      { toolCalls: [toolCall("crm_capture_lead", { name: "Laura Pérez", email: "Laura@Empresa.es", need: "Curso de inglés para 12 empleados", score: 80 })] },
      { toolCalls: [toolCall("crm_create_task", { title: "Llamar a Laura mañana" }, "c2")] },
      { content: "Perfecto, Laura. Un asesor te llamará mañana." },
    );
    await handleIncomingMessage(pool, { organizationId: org, conversation: conv, text: "Soy Laura (laura@empresa.es), queremos un curso para 12 personas", runtime });
    const lead = (await pool.query("select l.*, c.email, c.name from public.leads l join public.contacts c on c.id = l.contact_id where l.conversation_id = $1", [conv.id])).rows[0];
    expect(lead).toMatchObject({ title: "Laura Pérez", score: 80, stage: "NEW", source: "agent", lawful_basis: "inbound_request", marketing_consent: false, email: "laura@empresa.es" });
    const tasks = await pool.query("select title, source, lead_id from public.tasks where organization_id = $1", [org]);
    expect(tasks.rows[0]).toMatchObject({ title: "Llamar a Laura mañana", source: "agent", lead_id: lead.id });
    const conversation = (await pool.query("select contact_id from public.conversations where id = $1", [conv.id])).rows[0];
    expect(conversation.contact_id).toBe(lead.contact_id);
  });

  it("qualification agents keep the lead updated from their structured output (no duplicates)", async () => {
    const schema = { type: "object", properties: { reply: { type: "string" }, score: { type: "integer" }, stage: { type: "string" } } };
    const agent = await createAgent(pool, org, { name: "Cualificación", status: "active", config: { model: "openai:m", outputSchema: schema } });
    const conv = await getOrCreateConversation(pool, { organizationId: org, agentId: agent.id, channelType: "web", visitorId: "v2234567890123456" });
    llm.push({ content: JSON.stringify({ reply: "¿Qué presupuesto tenéis?", score: 40, stage: "cualificando", need: "Formación" }) });
    await handleIncomingMessage(pool, { organizationId: org, conversation: conv, text: "Hola, quiero información", runtime });
    llm.push({ content: JSON.stringify({ reply: "Genial, os paso con un asesor", score: 85, stage: "handoff", budget: "5.000 €" }) });
    await handleIncomingMessage(pool, { organizationId: org, conversation: conv, text: "Tenemos 5.000 € y decide el director", runtime });
    const { rows } = await pool.query("select score, stage, qualification from public.leads where conversation_id = $1", [conv.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ score: 85, stage: "QUALIFIED", qualification: { budget: "5.000 €" } });
  });

  it("manual leads require a lawful basis and some identification", async () => {
    await expect(createLeadManually(pool, org, { lawfulBasis: "whatever" as never, name: "X" })).rejects.toBeInstanceOf(CrmError);
    await expect(createLeadManually(pool, org, { lawfulBasis: "consent" })).rejects.toBeInstanceOf(CrmError);
    const r = await createLeadManually(pool, org, { lawfulBasis: "consent", marketingConsent: true, name: "Pedro", company: "Talleres Pedro", value: 1200 });
    expect(r.created).toBe(true);
    const lead = (await pool.query("select consent_at, marketing_consent, value from public.leads where id = $1", [r.leadId])).rows[0];
    expect(lead.marketing_consent).toBe(true);
    expect(lead.consent_at).not.toBeNull();
  });

  it("moves through the pipeline with a history and syncs the opportunity", async () => {
    const { leadId } = await createLeadManually(pool, org, { lawfulBasis: "inbound_request", name: "Ana" });
    await pool.query("insert into public.opportunities (organization_id, lead_id, name, amount) values ($1, $2, 'Curso Ana', 900)", [org, leadId]);
    for (const s of ["QUALIFIED", "CONTACTED", "MEETING", "PROPOSAL", "WON"] as const) await moveLeadStage(pool, org, leadId, s);
    const acts = await pool.query("select content from public.activities where lead_id = $1 and type = 'stage_change' order by id", [leadId]);
    expect(acts.rows.map((a) => a.content)).toEqual(["NEW → QUALIFIED", "QUALIFIED → CONTACTED", "CONTACTED → MEETING", "MEETING → PROPOSAL", "PROPOSAL → WON"]);
    expect((await pool.query("select status from public.opportunities where lead_id = $1", [leadId])).rows[0].status).toBe("won");
    await expect(moveLeadStage(pool, other, leadId, "LOST")).rejects.toBeInstanceOf(NotFoundError);
    const summary = await pipelineSummary(pool, org);
    expect(summary.WON.count).toBe(1);
    expect(summary.QUALIFIED.count).toBeGreaterThanOrEqual(1);
  });

  it("RLS: another organization sees no CRM data and cannot write into it", async () => {
    for (const t of ["leads", "contacts", "activities", "tasks", "opportunities", "companies"]) {
      expect(await as(db, outsider, async (c) => (await c.query(`select count(*)::int n from public.${t}`)).rows[0].n), t).toBe(0);
    }
    await expect(as(db, outsider, (c) => c.query("insert into public.leads (organization_id, title) values ($1, 'x')", [org]))).rejects.toThrow(/row-level security/);
  });

  it("HubSpot adapter upserts contacts through the v3 API", async () => {
    const f = mockFetch((url) => (url.endsWith("/search") ? { body: { results: [{ id: "501" }] } } : { body: { id: "501" } }));
    const r = await new HubSpotSync("hs-token", { fetchImpl: f }).upsertContact({ name: "Laura Pérez", email: "laura@empresa.es", company: "Empresa" });
    expect(r.externalId).toBe("501");
    expect(f.calls[1]!.url).toBe("https://api.hubapi.com/crm/v3/objects/contacts/501");
    expect(f.calls[1]!.init.method).toBe("PATCH");
    expect(f.calls[1]!.json.properties).toEqual({ email: "laura@empresa.es", firstname: "Laura", lastname: "Pérez", company: "Empresa" });
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer hs-token");
  });
});
