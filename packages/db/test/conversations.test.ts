import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { FakeProvider } from "@dtn/core/testing/fake-llm";
import { as, createTestDb, createUser, TEST_DATABASE_URL, type TestDb, type TestUser } from "./harness";
import {
  createAgent,
  createChannel,
  ESCALATED_REPLY,
  FALLBACK_REPLY,
  getOrCreateConversation,
  getWebChannelByKey,
  handleIncomingMessage,
  humanReply,
  NotFoundError,
  publicThread,
  type ChannelRow,
} from "../src";

describe.skipIf(!TEST_DATABASE_URL)("conversations / customer support", () => {
  let db: TestDb;
  let pool: pg.Pool;
  let org: string;
  let otherOrg: string;
  let agentId: string;
  let channel: ChannelRow;
  let owner: TestUser;
  let outsider: TestUser;
  const llm = new FakeProvider("openai");
  const runtime = { providers: { openai: llm } };
  const schema = { type: "object", properties: { answer: { type: "string" }, confidence: { type: "number" }, needs_human: { type: "boolean" }, reason: { type: "string" } } };

  beforeAll(async () => {
    db = await createTestDb();
    pool = new pg.Pool({ connectionString: db.url });
    org = (await db.admin.query("insert into public.organizations (name, slug) values ('Clínica', 'clinica') returning id")).rows[0].id;
    otherOrg = (await db.admin.query("insert into public.organizations (name, slug) values ('Otra', 'otra') returning id")).rows[0].id;
    owner = await createUser(db, "owner@clinica.test");
    outsider = await createUser(db, "x@otra.test");
    await db.admin.query("insert into public.memberships values ($1, $2, 'owner'), ($3, $4, 'owner')", [org, owner.id, otherOrg, outsider.id]);
    await db.admin.query("insert into public.llm_models (provider, model, input_per_mtok, output_per_mtok) values ('openai', 'm', 1000, 1000)");
    agentId = (
      await createAgent(pool, org, {
        name: "Soporte",
        status: "active",
        config: { model: "openai:m", outputSchema: schema, humanApproval: { confidenceThreshold: 0.6 } },
      })
    ).id;
    channel = await createChannel(pool, org, { type: "web", name: "Web", agentId, allowedOrigins: ["https://clinica.example"] });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.close();
  });

  const conv = (visitorId: string, conversationId?: string) =>
    getOrCreateConversation(pool, { organizationId: org, agentId, channelId: channel.id, channelType: "web", visitorId, conversationId });

  it("issues a public web-chat key and resolves it only while active", async () => {
    expect(channel.public_key).toMatch(/^wc_/);
    expect(channel.allowed_origins).toEqual(["https://clinica.example"]);
    expect((await getWebChannelByKey(pool, channel.public_key!))?.id).toBe(channel.id);
    expect(await getWebChannelByKey(pool, "wc_doesnotexistdoesnotexist")).toBeNull();
  });

  it("answers, stores both messages with model, tokens and cost", async () => {
    llm.push({ content: JSON.stringify({ answer: "Abrimos de 9 a 14h.", confidence: 0.95, needs_human: false }), usage: { inputTokens: 100, outputTokens: 20 } });
    const c = await conv("visitor-1");
    const res = await handleIncomingMessage(pool, { organizationId: org, conversation: c, text: "¿Horario?", runtime });
    expect(res).toMatchObject({ reply: "Abrimos de 9 a 14h.", escalated: false, status: "open" });
    const { rows } = await pool.query("select role, content, model, input_tokens, cost_usd::float cost from public.messages where conversation_id = $1 order by id", [c.id]);
    expect(rows).toEqual([
      { role: "user", content: "¿Horario?", model: null, input_tokens: 0, cost: 0 },
      { role: "assistant", content: "Abrimos de 9 a 14h.", model: "openai:m", input_tokens: 100, cost: 0.12 },
    ]);
    const { rows: c2 } = await pool.query("select message_count, total_tokens, total_cost_usd::float cost from public.conversations where id = $1", [c.id]);
    expect(c2[0]).toEqual({ message_count: 2, total_tokens: 120, cost: 0.12 });
  });

  it("sends previous turns as history on follow-up questions", async () => {
    llm.push({ content: JSON.stringify({ answer: "Sí, también los sábados no.", confidence: 0.9, needs_human: false }) });
    const c = await conv("visitor-1", (await pool.query("select id from public.conversations where visitor_id = 'visitor-1'")).rows[0].id);
    await handleIncomingMessage(pool, { organizationId: org, conversation: c, text: "¿Y los sábados?", runtime });
    const sent = llm.requests.at(-1)!.messages.map((m) => m.content);
    expect(sent).toContain("¿Horario?");
    expect(sent).toContain("Abrimos de 9 a 14h.");
  });

  it("escalates on low confidence and then the AI stays silent", async () => {
    llm.push({ content: JSON.stringify({ answer: "Creo que sí…", confidence: 0.3, needs_human: false, reason: "No aparece en la documentación" }) });
    const c = await conv("visitor-2");
    const first = await handleIncomingMessage(pool, { organizationId: org, conversation: c, text: "¿Cubre el seguro X mi implante?", runtime });
    expect(first).toMatchObject({ escalated: true, status: "escalated" });
    const { rows } = await pool.query("select status, escalation_reason from public.conversations where id = $1", [c.id]);
    expect(rows[0]).toEqual({ status: "escalated", escalation_reason: "No aparece en la documentación" });

    const calls = llm.requests.length;
    const again = await conv("visitor-2", c.id);
    const second = await handleIncomingMessage(pool, { organizationId: org, conversation: again, text: "¿Hola?", runtime });
    expect(second.reply).toBeNull();
    expect(llm.requests.length).toBe(calls); // no LLM call while humans own it
  });

  it("a human reply takes over the thread and is visible to the visitor", async () => {
    const id = (await pool.query("select id from public.conversations where visitor_id = 'visitor-2'")).rows[0].id;
    await humanReply(pool, org, id, owner.id, "Hola, soy Marta. Sí, está cubierto.");
    const thread = await publicThread(pool, org, id, "visitor-2", channel.id);
    expect(thread.status).toBe("human");
    expect(thread.messages.at(-1)).toMatchObject({ role: "agent", human: true, content: "Hola, soy Marta. Sí, está cubierto." });
    await expect(humanReply(pool, otherOrg, id, outsider.id, "hack")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("falls back to a human when the LLM fails", async () => {
    llm.push(new Error("provider down"));
    const c = await conv("visitor-3");
    const res = await handleIncomingMessage(pool, { organizationId: org, conversation: c, text: "Hola", runtime });
    expect(res).toMatchObject({ reply: FALLBACK_REPLY, escalated: true });
    const { rows } = await pool.query("select status, error from public.messages where conversation_id = $1 and role = 'assistant'", [c.id]);
    expect(rows[0].status).toBe("failed");
    expect(ESCALATED_REPLY).toMatch(/persona/);
  });

  it("visitors cannot read or continue someone else's conversation", async () => {
    const id = (await pool.query("select id from public.conversations where visitor_id = 'visitor-1'")).rows[0].id;
    await expect(publicThread(pool, org, id, "visitor-evil", channel.id)).rejects.toBeInstanceOf(NotFoundError);
    const hijack = await conv("visitor-evil", id);
    expect(hijack.id).not.toBe(id); // a new conversation is created instead
  });

  it("RLS: members see their org's inbox, cannot forge messages or metrics; others see nothing", async () => {
    const mine = await as(db, owner, async (c) => (await c.query("select count(*)::int n from public.conversations")).rows[0].n);
    expect(mine).toBeGreaterThan(0);
    expect(await as(db, outsider, async (c) => (await c.query("select count(*)::int n from public.messages")).rows[0].n)).toBe(0);
    await expect(
      as(db, owner, (c) => c.query("insert into public.messages (organization_id, conversation_id, role, content) select organization_id, id, 'assistant', 'fake' from public.conversations limit 1")),
    ).rejects.toThrow(/row-level security|permission denied/);
    await expect(as(db, owner, (c) => c.query("update public.conversations set total_cost_usd = 0"))).rejects.toThrow(/permission denied/);
    const triage = await as(db, owner, (c) => c.query("update public.conversations set priority = 'urgent', status = 'closed' where visitor_id = 'visitor-3'"));
    expect(triage.rowCount).toBe(1);
    expect((await as(db, outsider, (c) => c.query("update public.conversations set status = 'closed'"))).rowCount).toBe(0);
  });
});
