// E2E: WhatsApp Cloud API and email channels end to end. Meta and Resend are
// replaced by e2e/fake-providers.mjs (TEST DOUBLE); webhooks are signed exactly
// like Meta does, with the app secret configured for the E2E environment.
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createHarness } from "./lib.mjs";

mkdirSync("e2e/.artifacts", { recursive: true });
const h = await createHarness("channels");
const { B, admin, step, ctx } = h;
const DOUBLE = process.env.E2E_PROVIDERS_URL ?? "http://127.0.0.1:4010";
const APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? "e2e-meta-app-secret";
const VERIFY = process.env.WHATSAPP_VERIFY_TOKEN ?? "e2e-verify-token";
const PHONE_ID = String(Date.now()).slice(-12);
const CUSTOMER = "346" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");

const outbox = async () => (await fetch(`${DOUBLE}/_outbox`)).json();
const waitOutbox = async (pred, label) => {
  for (let i = 0; i < 40; i++) {
    const hit = (await outbox()).find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`nothing sent: ${label}`);
};
const metaPost = (body, secret = APP_SECRET) => {
  const raw = JSON.stringify(body);
  return fetch(`${B}/api/webhooks/whatsapp`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") },
    body: raw,
  });
};
const waMessage = (id, text) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "34910000000", phone_number_id: PHONE_ID }, contacts: [{ wa_id: CUSTOMER, profile: { name: "Lucía" } }], messages: [{ id, from: CUSTOMER, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }] } }] }],
});
const openConversation = async (channel) => {
  await admin.goto(`${B}/conversations?channel=${channel}`);
  await admin.locator("table a[href^='/conversations/']").first().click();
  await admin.waitForURL(/\/conversations\/[0-9a-f-]{36}/);
};

await step(1, "Cliente con AI Customer Support y su documentación", async () => {
  await h.login(admin, h.ADMIN);
  ctx.org = await h.createClient(`Óptica Mar ${h.RUN}`);
  await admin.getByRole("button", { name: "Abrir panel del cliente" }).click();
  await admin.waitForURL(/dashboard/);
  await h.ensureModels();
  await admin.goto(B + "/solutions/customer_support");
  await admin.selectOption("#s-model", "openai:support-model");
  await admin.selectOption("#s-emb", "openai:support-embeddings");
  await admin.fill("#cfg-business_description", "Óptica Mar, graduación y lentes en Cádiz.");
  await admin.getByRole("button", { name: "Activar solución" }).click();
  await admin.getByText(/activada/).first().waitFor();
  await admin.getByRole("link", { name: "Sube la documentación del negocio" }).click();
  await admin.setInputFiles("input[type=file]", "packages/core/test/fixtures/horario.pdf");
  await admin.getByRole("button", { name: "Subir e indexar" }).click();
  await h.waitReady(admin);
});
await step(2, "Credenciales cifradas para WhatsApp y Resend", async () => {
  await admin.goto(B + "/integrations");
  for (const [name, value] of [["WHATSAPP_ACCESS_TOKEN", "EAAG-e2e-token-optica"], ["RESEND_API_KEY", "re_e2e_key_optica"]]) {
    const form = admin.locator("form", { has: admin.locator("input[name=value]") });
    await form.getByLabel("Nombre").fill(name);
    await form.getByLabel("Valor").fill(value);
    await form.getByRole("button", { name: "Guardar" }).click();
    await admin.getByText("Credencial guardada (cifrada).").waitFor();
  }
  if ((await admin.content()).includes("e2e-token-optica")) throw new Error("secret rendered");
});
await step(3, "Conectar un número de WhatsApp (Meta valida número y token)", async () => {
  await admin.fill("#wa-name", "WhatsApp tienda");
  await admin.fill("#wa-number", "999999");
  await admin.getByRole("button", { name: "Conectar número" }).click();
  await admin.getByText(/Meta rechazó el número o el token/).waitFor();
  await admin.fill("#wa-name", "WhatsApp tienda");
  await admin.fill("#wa-number", PHONE_ID);
  await admin.getByRole("button", { name: "Conectar número" }).click();
  await admin.getByText("Canal creado.").waitFor();
  await admin.getByText(`WhatsApp tienda · +34 910 000 000`).waitFor();
});
await step(4, "Webhook de Meta: handshake, firma obligatoria", async () => {
  const ok = await fetch(`${B}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=abc123`);
  if (ok.status !== 200 || (await ok.text()) !== "abc123") throw new Error("handshake failed");
  const bad = await fetch(`${B}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`);
  if (bad.status !== 403) throw new Error("bad verify token accepted");
  const forged = await metaPost(waMessage("wamid.forged", "hola"), "not-the-secret");
  if (forged.status !== 401) throw new Error(`forged signature accepted (${forged.status})`);
});
await step(5, "Un cliente escribe por WhatsApp → el agente responde con la documentación", async () => {
  await fetch(`${DOUBLE}/_outbox`, { method: "DELETE" });
  const r = await metaPost(waMessage(`wamid.${h.RUN}.1`, "¿Qué horario de apertura tenéis?"));
  if (r.status !== 200) throw new Error(`webhook ${r.status}`);
  await metaPost(waMessage(`wamid.${h.RUN}.1`, "¿Qué horario de apertura tenéis?")); // Meta retry: processed once
  const sent = await waitOutbox((m) => m.kind === "whatsapp" && m.to === CUSTOMER, "whatsapp reply");
  if (!/lunes a viernes de 9 a 14h/.test(sent.text)) throw new Error("reply not grounded: " + sent.text);
  if (sent.phoneNumberId !== PHONE_ID) throw new Error("sent from the wrong number");
  await new Promise((r) => setTimeout(r, 1500));
  const replies = (await outbox()).filter((m) => m.kind === "whatsapp" && m.to === CUSTOMER);
  if (replies.length !== 1) throw new Error(`expected 1 reply, got ${replies.length}`);
});
await step(6, "Inbox: conversación de WhatsApp entregada; respuesta humana también sale por WhatsApp", async () => {
  await openConversation("whatsapp");
  await admin.getByText("Lucía").first().waitFor();
  await admin.getByText("· entregado").first().waitFor();
  await admin.getByLabel("Respuesta").fill("Hola Lucía, soy Marta de la tienda. ¿Te reservo cita?");
  await admin.getByRole("button", { name: "Enviar respuesta" }).click();
  await waitOutbox((m) => m.kind === "whatsapp" && /soy Marta/.test(m.text), "human reply");
  await h.shot(admin, "whatsapp-conversation");
});
await step(7, "Canal de email en modo borradores: el token solo se muestra una vez", async () => {
  await admin.goto(B + "/integrations");
  await admin.fill("#em-name", "Correo tienda");
  await admin.fill("#em-from", "Óptica Mar <hola@opticamar.test>");
  await admin.getByRole("button", { name: "Crear canal de email" }).click();
  const url = await admin.locator("#em-url").inputValue();
  const auth = await admin.locator("#em-token").inputValue();
  if (!/\/api\/webhooks\/email\/em_/.test(url) || !/^Bearer eit_/.test(auth)) throw new Error("webhook details missing");
  ctx.emailUrl = url.replace(/^https?:\/\/[^/]+/, B);
  ctx.emailAuth = auth;
  await admin.reload();
  if ((await admin.content()).includes(auth.slice(7))) throw new Error("token shown again");
  await admin.getByText("borradores", { exact: true }).waitFor();
});
await step(8, "Correo entrante → borrador de la IA, sin envío automático", async () => {
  await fetch(`${DOUBLE}/_outbox`, { method: "DELETE" });
  const unauth = await fetch(ctx.emailUrl, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer eit_wrong" }, body: "{}" });
  if (unauth.status !== 401) throw new Error("wrong token accepted");
  const r = await fetch(ctx.emailUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: ctx.emailAuth },
    body: JSON.stringify({ from: "Pedro Gil <pedro@example.com>", subject: "Horario de apertura", text: "Hola, ¿qué horario de apertura tenéis?\n\nEl lun, Pedro escribió:\n> antiguo", message_id: `<in-${h.RUN}@example.com>` }),
  });
  if (r.status !== 202) throw new Error(`inbound ${r.status}`);
  for (let i = 0; i < 20; i++) {
    await admin.goto(`${B}/conversations?channel=email`);
    if (await admin.getByText("Pedro Gil").count()) break;
    await admin.waitForTimeout(1000);
  }
  await openConversation("email");
  await admin.getByText(/Borrador · revísalo/).waitFor({ timeout: 20000 }).catch(async () => {
    await admin.reload();
    await admin.getByText(/Borrador · revísalo/).waitFor();
  });
  if ((await outbox()).length) throw new Error("email sent without approval");
});
await step(9, "Una persona edita y envía el borrador → sale por Resend en el mismo hilo", async () => {
  const draft = admin.getByLabel("Texto del borrador");
  const text = await draft.inputValue();
  if (!/lunes a viernes de 9 a 14h/.test(text)) throw new Error("draft not grounded: " + text);
  await draft.fill(text + "\n\nUn saludo, Óptica Mar");
  await admin.getByRole("button", { name: "Enviar borrador" }).click();
  const mail = await waitOutbox((m) => m.kind === "email", "email");
  if (mail.to !== "pedro@example.com" || mail.subject !== "Re: Horario de apertura" || mail.inReplyTo !== `<in-${h.RUN}@example.com>` || !/Un saludo, Óptica Mar/.test(mail.text)) {
    throw new Error("unexpected email " + JSON.stringify(mail));
  }
  await admin.reload();
  await admin.getByText("· entregado").first().waitFor();
});

await h.finish();
