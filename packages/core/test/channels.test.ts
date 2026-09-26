import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  insideServiceWindow,
  parseAddress,
  parseInboundEmail,
  parseWhatsAppWebhook,
  replySubject,
  sendEmailResend,
  sendWhatsAppText,
  stripQuotedReply,
  verifyMetaSignature,
  verifyWhatsAppNumber,
} from "../src";

const waPayload = (messages: unknown[], phoneNumberId = "1098765") => ({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: "34600111222", profile: { name: "Ana" } }], messages } }] }],
});

describe("WhatsApp adapter", () => {
  it("verifies X-Hub-Signature-256 with the app secret (timing safe)", () => {
    const body = JSON.stringify(waPayload([]));
    const sig = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");
    expect(verifyMetaSignature(body, sig, "app-secret")).toBe(true);
    expect(verifyMetaSignature(body + " ", sig, "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, sig, "other")).toBe(false);
    expect(verifyMetaSignature(body, null, "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, "sha256=zz", "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, sig, "")).toBe(false);
  });

  it("parses text, interactive and unsupported messages; ignores statuses and junk", () => {
    const msgs = parseWhatsAppWebhook(
      waPayload([
        { id: "wamid.1", from: "34600111222", type: "text", timestamp: "1700000000", text: { body: "Hola, ¿abrís mañana?" } },
        { id: "wamid.2", from: "34600111222", type: "interactive", interactive: { button_reply: { title: "Sí" } } },
        { id: "wamid.3", from: "34600111222", type: "image" },
        { id: "wamid.4", from: "not-a-number", type: "text", text: { body: "x" } },
      ]),
    );
    expect(msgs.map((m) => [m.messageId, m.text, m.supported])).toEqual([
      ["wamid.1", "Hola, ¿abrís mañana?", true],
      ["wamid.2", "Sí", true],
      ["wamid.3", "[Imagen]", false],
    ]);
    expect(msgs[0]).toMatchObject({ phoneNumberId: "1098765", from: "34600111222", name: "Ana", timestamp: 1700000000 });
    expect(parseWhatsAppWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(parseWhatsAppWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "1" }, statuses: [{}] } }] }] })).toEqual([]);
  });

  it("sends a text reply and verifies number ownership through the Graph API", async () => {
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/messages")) return new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), { status: 200 });
      return new Response(JSON.stringify({ display_phone_number: "+34 600 000 000", verified_name: "Clínica" }), { status: 200 });
    });
    const out = await sendWhatsAppText({ phoneNumberId: "1098765", to: "34600111222", text: "Hola", token: "tok", baseUrl: "http://graph.test/v21.0", fetch: f as typeof fetch });
    expect(out.messageId).toBe("wamid.out");
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("http://graph.test/v21.0/1098765/messages");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init!.body))).toMatchObject({ messaging_product: "whatsapp", to: "34600111222", type: "text", text: { body: "Hola" } });
    await expect(verifyWhatsAppNumber("1098765", { token: "tok", fetch: f as typeof fetch })).resolves.toEqual({ displayPhoneNumber: "+34 600 000 000", verifiedName: "Clínica" });
    await expect(verifyWhatsAppNumber("../me", { token: "tok", fetch: f as typeof fetch })).rejects.toThrow("Invalid phone_number_id");
  });

  it("surfaces API errors without leaking the token", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token" } }), { status: 401 }));
    const err = await sendWhatsAppText({ phoneNumberId: "1", to: "34600111222", text: "x", token: "super-secret-token", fetch: f as unknown as typeof fetch }).catch((e) => e);
    expect(err.status).toBe(401);
    expect(String(err.message)).not.toContain("super-secret-token");
  });

  it("24h customer service window", () => {
    const now = new Date("2026-01-02T12:00:00Z");
    expect(insideServiceWindow("2026-01-02T00:00:00Z", now)).toBe(true);
    expect(insideServiceWindow("2026-01-01T11:00:00Z", now)).toBe(false);
    expect(insideServiceWindow(null, now)).toBe(false);
  });
});

describe("Email adapter", () => {
  it("parses addresses", () => {
    expect(parseAddress('"Ana Pérez" <Ana@Example.com>')).toEqual({ email: "ana@example.com", name: "Ana Pérez" });
    expect(parseAddress("ana@example.com")).toEqual({ email: "ana@example.com", name: null });
    expect(parseAddress("not an email")).toBeNull();
  });

  it("parses the generic format, strips quoted replies and html", () => {
    const e = parseInboundEmail({ from: "Ana <ana@example.com>", subject: "Horario", html: "<p>¿Abrís el sábado?</p><p>Gracias</p>", message_id: "<m1@example.com>" });
    expect(e).toMatchObject({ fromEmail: "ana@example.com", fromName: "Ana", subject: "Horario", text: "¿Abrís el sábado?\nGracias", messageId: "<m1@example.com>", automated: false });
    expect(stripQuotedReply("Perfecto, gracias\n\nEl lun, 1 ene 2026, Clínica escribió:\n> Hola")).toBe("Perfecto, gracias");
    expect(stripQuotedReply("Ok\nOn Mon, Jan 1, 2026 Bob wrote:\n> hi")).toBe("Ok");
  });

  it("parses Postmark inbound and flags automated mail", () => {
    const e = parseInboundEmail({ From: "bob@example.com", FromName: "Bob", Subject: "Out of office", TextBody: "Estoy fuera", Headers: [{ Name: "Auto-Submitted", Value: "auto-replied" }, { Name: "Message-ID", Value: "<pm@x>" }] });
    expect(e).toMatchObject({ fromEmail: "bob@example.com", fromName: "Bob", messageId: "<pm@x>", automated: true });
    expect(parseInboundEmail({ from: "no-reply@shop.com", text: "Pedido" })!.automated).toBe(true);
    expect(parseInboundEmail({ from: "ana@example.com", text: "Hola", headers: { "List-Id": "<news.x>" } })!.automated).toBe(true);
    expect(parseInboundEmail({ from: "ana@example.com", text: "Hola" })!.automated).toBe(false);
    expect(parseInboundEmail({ nothing: true })).toBeNull();
  });

  it("reply subject and Resend sending with threading headers", async () => {
    expect(replySubject("Horario")).toBe("Re: Horario");
    expect(replySubject("RE: Horario")).toBe("RE: Horario");
    expect(replySubject("")).toBe("Re: Tu consulta");
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    const r = await sendEmailResend({ apiKey: "re_x", from: "Clínica <hola@clinica.es>", to: "ana@example.com", subject: "Re: Horario", text: "Abrimos a las 9", inReplyTo: "<m1@example.com>", baseUrl: "http://mail.test", fetch: f as unknown as typeof fetch });
    expect(r.id).toBe("em_1");
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("http://mail.test/emails");
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ["ana@example.com"], headers: { "In-Reply-To": "<m1@example.com>" } });
  });
});
