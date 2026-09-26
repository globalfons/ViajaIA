import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { FakeProvider } from "@dtn/core/testing/fake-llm";
import { as, createTestDb, createUser, TEST_DATABASE_URL, type TestDb, type TestUser } from "./harness";
import {
  authenticateEmailChannel,
  ChannelError,
  createAgent,
  createEmailChannel,
  createWhatsAppChannel,
  deliverMessage,
  discardDraft,
  getWhatsAppChannelByNumber,
  humanReply,
  NotFoundError,
  processInbound,
  RetryableDeliveryError,
  sendDraft,
  setEmailAutoSend,
  setSecret,
  type ChannelRow,
} from "../src";

/** Test double for the Meta Graph API and Resend: records requests, never leaves the process. */
function providerDouble() {
  const calls: { url: string; body: unknown; auth: string | null }[] = [];
  let failWith: number | null = null;
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get("authorization") });
    if (failWith) return new Response(JSON.stringify({ error: { message: "boom" }, message: "boom" }), { status: failWith });
    if (u.endsWith("/messages")) return new Response(JSON.stringify({ messages: [{ id: `wamid.out.${calls.length}` }] }), { status: 200 });
    if (u.endsWith("/emails")) return new Response(JSON.stringify({ id: `re_${calls.length}` }), { status: 200 });
    if (u.includes("fields=display_phone_number")) {
      if (u.includes("/999999?")) return new Response(JSON.stringify({ error: { message: "Unsupported get request" } }), { status: 400 });
      return new Response(JSON.stringify({ display_phone_number: "+34 910 000 000", verified_name: "Clínica" }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  return { fetch: f as unknown as typeof fetch, calls, fail: (s: number | null) => (failWith = s) };
}

describe.skipIf(!TEST_DATABASE_URL)("external channels: WhatsApp + email", () => {
  let db: TestDb;
  let pool: pg.Pool;
  let org: string;
  let otherOrg: string;
  let agentId: string;
  let otherAgent: string;
  let owner: TestUser;
  let outsider: TestUser;
  let wa: ChannelRow;
  let em: ChannelRow;
  let emToken: string;
  const llm = new FakeProvider("openai");
  const runtime = { providers: { openai: llm } };
  const p = providerDouble();
  const opts = { fetch: p.fetch, whatsappBaseUrl: "http://graph.test/v21.0", resendBaseUrl: "http://mail.test", runtime };
  const schema = { type: "object", properties: { answer: { type: "string" }, confidence: { type: "number" }, needs_human: { type: "boolean" } } };
  const env = process.env.SECRETS_ENCRYPTION_KEYS;
  const answer = (text: string) => llm.push({ content: JSON.stringify({ answer: text, confidence: 0.95, needs_human: false }), usage: { inputTokens: 10, outputTokens: 5 } });
  const jobs = async (type: string) => (await pool.query("select payload from public.jobs where type = $1 and status = 'queued' order by id", [type])).rows.map((r) => r.payload);
  const clearJobs = () => pool.query("delete from public.jobs");

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEYS = `v1:${randomBytes(32).toString("base64")}`;
    db = await createTestDb();
    pool = new pg.Pool({ connectionString: db.url });
    org = (await db.admin.query("insert into public.organizations (name, slug) values ('Clínica', 'clinica') returning id")).rows[0].id;
    otherOrg = (await db.admin.query("insert into public.organizations (name, slug) values ('Otra', 'otra') returning id")).rows[0].id;
    owner = await createUser(db, "owner@clinica.test");
    outsider = await createUser(db, "x@otra.test");
    await db.admin.query("insert into public.memberships values ($1, $2, 'owner'), ($3, $4, 'owner')", [org, owner.id, otherOrg, outsider.id]);
    await db.admin.query("insert into public.llm_models (provider, model, input_per_mtok, output_per_mtok) values ('openai', 'm', 1, 1)");
    agentId = (await createAgent(pool, org, { name: "Soporte", status: "active", config: { model: "openai:m", outputSchema: schema, humanApproval: { confidenceThreshold: 0.6 } } })).id;
    otherAgent = (await createAgent(pool, otherOrg, { name: "Otro", status: "active", config: { model: "openai:m" } })).id;
  }, 60_000);

  afterAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEYS = env;
    await pool?.end();
    await db?.close();
  });

  it("links a WhatsApp number only with a stored token that Meta accepts; one org per number", async () => {
    const input = { name: "WhatsApp", agentId, phoneNumberId: "1098765", tokenSecret: "WHATSAPP_ACCESS_TOKEN" };
    await expect(createWhatsAppChannel(pool, org, input, owner.id, opts)).rejects.toThrow(/Save the credential/);
    await setSecret(pool, org, "WHATSAPP_ACCESS_TOKEN", "EAAG-test-token-org-a");
    await expect(createWhatsAppChannel(pool, org, { ...input, phoneNumberId: "999999" }, owner.id, opts)).rejects.toThrow(/Meta rejected/);
    wa = await createWhatsAppChannel(pool, org, input, owner.id, opts);
    expect(wa.config).toMatchObject({ phone_number_id: "1098765", display_phone_number: "+34 910 000 000", token_secret: "WHATSAPP_ACCESS_TOKEN" });
    expect(JSON.stringify(wa.config)).not.toContain("EAAG");
    // Another tenant cannot hijack the same number.
    await setSecret(pool, otherOrg, "WHATSAPP_ACCESS_TOKEN", "EAAG-other");
    await expect(createWhatsAppChannel(pool, otherOrg, { ...input, agentId: otherAgent }, outsider.id, opts)).rejects.toThrow(ChannelError);
    expect((await getWhatsAppChannelByNumber(pool, "1098765"))?.organization_id).toBe(org);
    expect(await getWhatsAppChannelByNumber(pool, "000")).toBeNull();
  });

  it("processes an inbound WhatsApp message once, answers with the agent and delivers via Graph API", async () => {
    await clearJobs();
    answer("Abrimos de 9 a 14h.");
    const message = { phoneNumberId: "1098765", from: "34600111222", name: "Ana", messageId: "wamid.in.1", type: "text", text: "¿Horario?", supported: true, timestamp: null };
    const res = (await processInbound(pool, org, { kind: "whatsapp", channelId: wa.id, message }, opts)) as { reply: string; replyMessageId: number; conversationId: string };
    expect(res.reply).toBe("Abrimos de 9 a 14h.");
    expect(await processInbound(pool, org, { kind: "whatsapp", channelId: wa.id, message }, opts)).toEqual({ skipped: "duplicate" });
    const [job] = await jobs("channel.deliver");
    expect(job).toEqual({ messageId: res.replyMessageId });
    const contact = (await pool.query("select c.name, c.phone, c.external_ids from public.contacts c join public.conversations v on v.contact_id = c.id where v.id = $1", [res.conversationId])).rows[0];
    expect(contact).toMatchObject({ name: "Ana", phone: "+34600111222", external_ids: { whatsapp: "34600111222" } });

    await deliverMessage(pool, org, res.replyMessageId, opts);
    const sent = p.calls.find((c) => c.url.endsWith("/1098765/messages"))!;
    expect(sent.auth).toBe("Bearer EAAG-test-token-org-a");
    expect(sent.body).toMatchObject({ to: "34600111222", text: { body: "Abrimos de 9 a 14h." } });
    const msg = (await pool.query("select delivery_status, external_id from public.messages where id = $1", [res.replyMessageId])).rows[0];
    expect(msg).toMatchObject({ delivery_status: "delivered" });
    expect(msg.external_id).toMatch(/^wamid\.out/);
    // Second message continues the same conversation.
    answer("De nada.");
    const res2 = (await processInbound(pool, org, { kind: "whatsapp", channelId: wa.id, message: { ...message, messageId: "wamid.in.2", text: "Gracias" } }, opts)) as { conversationId: string };
    expect(res2.conversationId).toBe(res.conversationId);
  });

  it("hands unsupported media to a person without calling the AI; human replies are delivered", async () => {
    await clearJobs();
    const before = llm.requests.length;
    const message = { phoneNumberId: "1098765", from: "34600999888", name: null, messageId: "wamid.img", type: "image", text: "[Imagen]", supported: false, timestamp: null };
    const res = (await processInbound(pool, org, { kind: "whatsapp", channelId: wa.id, message }, opts)) as { escalated: boolean; conversationId: string };
    expect(res.escalated).toBe(true);
    expect(llm.requests.length).toBe(before);
    const human = await humanReply(pool, org, res.conversationId, owner.id, "Hola, ¿nos lo puedes describir por texto?");
    expect(await jobs("channel.deliver")).toEqual([{ messageId: human.id }]);
    await deliverMessage(pool, org, human.id, opts);
    expect((await pool.query("select delivery_status from public.messages where id = $1", [human.id])).rows[0].delivery_status).toBe("delivered");
  });

  it("never sends outside WhatsApp's 24h window; retries only transient provider errors", async () => {
    const conv = (await pool.query("select id from public.conversations where visitor_id = '34600999888'")).rows[0].id;
    await pool.query("update public.messages set created_at = now() - interval '25 hours' where conversation_id = $1 and role = 'user'", [conv]);
    const late = await humanReply(pool, org, conv, owner.id, "¿Sigues ahí?");
    expect(await deliverMessage(pool, org, late.id, opts)).toMatchObject({ failed: true, reason: expect.stringMatching(/24h/) });
    await pool.query("update public.messages set created_at = now() where conversation_id = $1 and role = 'user'", [conv]);

    const m = await humanReply(pool, org, conv, owner.id, "Reintento");
    p.fail(503);
    await expect(deliverMessage(pool, org, m.id, opts, false)).rejects.toBeInstanceOf(RetryableDeliveryError);
    p.fail(400);
    expect(await deliverMessage(pool, org, m.id, opts, false)).toMatchObject({ failed: true });
    p.fail(null);
    expect((await pool.query("select delivery_status, delivery_error from public.messages where id = $1", [m.id])).rows[0]).toMatchObject({ delivery_status: "failed" });
  });

  it("email: token-authenticated inbound; AI replies are drafts until a person sends them", async () => {
    await clearJobs();
    const created = await createEmailChannel(pool, org, { name: "Email", agentId, fromAddress: "Clínica <hola@clinica.es>", apiKeySecret: "RESEND_API_KEY", autoSend: false }, owner.id);
    em = created.channel;
    emToken = created.inboundToken;
    expect(em.public_key).toMatch(/^em_/);
    expect(JSON.stringify(em.config)).not.toContain(emToken);
    expect((await authenticateEmailChannel(pool, em.public_key!, emToken))?.id).toBe(em.id);
    expect(await authenticateEmailChannel(pool, em.public_key!, emToken + "x")).toBeNull();
    expect(await authenticateEmailChannel(pool, em.public_key!, null)).toBeNull();
    await setSecret(pool, org, "RESEND_API_KEY", "re_test_key_org_a");

    answer("Abrimos el sábado de 10 a 13h.");
    const email = { fromEmail: "ana@example.com", fromName: "Ana", subject: "Horario", text: "¿Abrís el sábado?", messageId: "<m1@example.com>", inReplyTo: null, automated: false };
    const res = (await processInbound(pool, org, { kind: "email", channelId: em.id, email }, opts)) as { replyMessageId: number; replyStatus: string; conversationId: string };
    expect(res.replyStatus).toBe("draft");
    expect(await jobs("channel.deliver")).toEqual([]);
    expect((await pool.query("select subject, visitor_id from public.conversations where id = $1", [res.conversationId])).rows[0]).toEqual({ subject: "Horario", visitor_id: "ana@example.com" });

    await sendDraft(pool, org, res.replyMessageId, owner.id, "Abrimos el sábado de 10 a 13h. ¡Te esperamos!");
    await expect(sendDraft(pool, org, res.replyMessageId, owner.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await jobs("channel.deliver")).toEqual([{ messageId: res.replyMessageId }]);
    await deliverMessage(pool, org, res.replyMessageId, opts);
    const mail = p.calls.find((c) => c.url === "http://mail.test/emails")!;
    expect(mail.auth).toBe("Bearer re_test_key_org_a");
    expect(mail.body).toMatchObject({ from: "Clínica <hola@clinica.es>", to: ["ana@example.com"], subject: "Re: Horario", text: "Abrimos el sábado de 10 a 13h. ¡Te esperamos!", headers: { "In-Reply-To": "<m1@example.com>" } });
  });

  it("email: automated mail is never auto-answered; explicit auto-send is capped per hour", async () => {
    await clearJobs();
    const before = llm.requests.length;
    const auto = { fromEmail: "bob@example.com", fromName: null, subject: "Fuera de la oficina", text: "Vuelvo el lunes", messageId: "<ooo@x>", inReplyTo: null, automated: true };
    const r1 = (await processInbound(pool, org, { kind: "email", channelId: em.id, email: auto }, opts)) as { escalated: boolean };
    expect(r1.escalated).toBe(true);
    expect(llm.requests.length).toBe(before);
    expect(await processInbound(pool, org, { kind: "email", channelId: em.id, email: { ...auto, fromEmail: "hola@clinica.es", messageId: "<own@x>", automated: false } }, opts)).toEqual({ skipped: "own address" });

    await setEmailAutoSend(pool, org, em.id, true);
    for (let i = 0; i < 6; i++) answer(`Respuesta ${i}`);
    const statuses: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = (await processInbound(pool, org, { kind: "email", channelId: em.id, email: { fromEmail: "loop@example.com", fromName: null, subject: "x", text: `msg ${i}`, messageId: `<loop${i}@x>`, inReplyTo: null, automated: false } }, opts)) as { replyStatus: string };
      statuses.push(r.replyStatus);
    }
    expect(statuses).toEqual(["sent", "sent", "sent", "sent", "sent", "draft"]);
    expect((await jobs("channel.deliver")).length).toBe(5);
    const draft = (await pool.query("select id from public.messages where status = 'draft' and organization_id = $1 order by id desc limit 1", [org])).rows[0].id;
    await discardDraft(pool, org, draft);
    expect((await pool.query("select status, delivery_status from public.messages where id = $1", [draft])).rows[0]).toEqual({ status: "failed", delivery_status: "not_sent" });
  });

  it("tenant isolation: other orgs cannot see or act on these channels and messages", async () => {
    const outsiderView = await as(db, outsider, async (c) => ({
      channels: (await c.query("select id from public.channels where organization_id = $1", [org])).rowCount,
      messages: (await c.query("select id from public.messages where organization_id = $1", [org])).rowCount,
      contacts: (await c.query("select id from public.contacts where organization_id = $1", [org])).rowCount,
    }));
    expect(outsiderView).toEqual({ channels: 0, messages: 0, contacts: 0 });
    const someMsg = (await pool.query("select id from public.messages where organization_id = $1 and role = 'assistant' limit 1", [org])).rows[0].id;
    await expect(sendDraft(pool, otherOrg, someMsg, outsider.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await deliverMessage(pool, otherOrg, someMsg, opts)).toEqual({ skipped: true });
    await expect(setEmailAutoSend(pool, otherOrg, em.id, false)).rejects.toBeInstanceOf(NotFoundError);
    // A job for another org cannot load this org's channel.
    expect(await processInbound(pool, otherOrg, { kind: "whatsapp", channelId: wa.id, message: {} }, opts)).toEqual({ skipped: "channel inactive" });
    // Members cannot write messages directly (service-only).
    const direct = await as(db, owner, (c) => c.query("update public.messages set delivery_status = 'delivered' where organization_id = $1", [org]).then((r) => r.rowCount).catch(() => 0));
    expect(direct).toBe(0);
  });
});
