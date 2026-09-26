// E2E: Google Calendar OAuth + appointment booking by the agent. Google and the
// LLM are replaced by e2e/fake-providers.mjs (TEST DOUBLE): the consent screen
// auto-approves and the fake model drives calendar_find_slots → create_appointment.
import { mkdirSync } from "node:fs";
import { createHarness } from "./lib.mjs";

mkdirSync("e2e/.artifacts", { recursive: true });
const h = await createHarness("calendar");
const { B, admin, step, ctx, browser } = h;
const DOUBLE = process.env.E2E_PROVIDERS_URL ?? "http://127.0.0.1:4010";
const outbox = async () => (await fetch(`${DOUBLE}/_outbox`)).json();

await step(1, "Cliente con AI Appointment Agent", async () => {
  await h.login(admin, h.ADMIN);
  ctx.org = await h.createClient(`Fisio Norte ${h.RUN}`);
  await admin.getByRole("button", { name: "Abrir panel del cliente" }).click();
  await admin.waitForURL(/dashboard/);
  await h.ensureModels();
  await admin.goto(B + "/solutions/appointment_agent");
  await admin.getByText(/Google Calendar conectado \(Integrations\)/).waitFor();
  await admin.selectOption("#s-model", "openai:support-model");
  await admin.selectOption("#s-emb", "openai:support-embeddings");
  await admin.fill("#cfg-business_description", "Fisio Norte, fisioterapia deportiva.");
  await admin.getByRole("button", { name: "Activar solución" }).click();
  await admin.getByText(/activada/).first().waitFor();
});
await step(2, "Sin calendario, la tool responde con honestidad (no inventa huecos)", async () => {
  await admin.goto(B + "/integrations");
  ctx.chat = await admin.getByRole("link", { name: "Probar chat" }).first().getAttribute("href");
  const v = await (await browser.newContext()).newPage();
  await v.goto(B + ctx.chat);
  await v.fill("input[aria-label=Mensaje]", "Quiero una cita para una revisión");
  await v.getByRole("button", { name: "Enviar" }).click();
  await v.getByText(/No he podido reservar: No calendar is connected/).waitFor({ timeout: 20000 });
  await v.close();
});
await step(3, "Conectar Google Calendar por OAuth", async () => {
  await fetch(`${DOUBLE}/_outbox`, { method: "DELETE" });
  await admin.goto(B + "/integrations");
  await admin.getByRole("link", { name: "Conectar con Google" }).click();
  await admin.waitForURL(/integrations\?ok=calendar/);
  await admin.getByText("Google Calendar conectado.").waitFor();
  await admin.getByText("agenda@negocio.test").waitFor();
  if ((await admin.content()).includes("e2e-refresh")) throw new Error("refresh token rendered");
});
await step(4, "Un callback con state falso se rechaza", async () => {
  await admin.goto(B + "/api/integrations/google/callback?code=e2e-google-code&state=forged");
  await admin.getByText(/caducó/).waitFor();
});
await step(5, "Horario de citas: todos los días, sin antelación mínima", async () => {
  await admin.goto(B + "/integrations");
  for (let i = 0; i < 7; i++) await admin.locator(`input[name=days][value="${i}"]`).check();
  await admin.fill("#cal-start", "00:00");
  await admin.fill("#cal-end", "23:30");
  await admin.fill("#cal-notice", "0");
  await admin.getByRole("button", { name: "Guardar horario" }).click();
  await admin.getByText("Cambios guardados.").first().waitFor();
});
await step(6, "El visitante pide cita y el agente la reserva en su calendario", async () => {
  const v = await (await browser.newContext()).newPage();
  h.watch(v);
  await v.goto(B + ctx.chat);
  await v.fill("input[aria-label=Mensaje]", "Hola, soy Ana. Quiero una cita de revisión, resérvame el primer hueco libre.");
  await v.getByRole("button", { name: "Enviar" }).click();
  await v.getByText(/Cita reservada:/).waitFor({ timeout: 20000 }).catch(async (e) => {
    throw new Error(`${e.message.split("\n")[0]} · chat: ${(await v.locator("main, body").first().innerText()).slice(-300)}`);
  });
  const ev = (await outbox()).find((m) => m.kind === "calendar");
  if (!ev || ev.summary !== "Revisión · Ana" || ev.sendUpdates !== "none" || ev.timeZone !== "Europe/Madrid") throw new Error("event " + JSON.stringify(ev));
  await v.close();
});
await step(7, "Trazabilidad: las tools aparecen en la conversación", async () => {
  await admin.goto(B + "/conversations");
  await admin.locator("table a[href^='/conversations/']").first().click();
  await admin.getByText(/calendar_find_slots \(success\), calendar_create_appointment \(success\)/).waitFor();
});
await step(8, "Desconectar revoca el acceso en Google", async () => {
  await admin.goto(B + "/integrations");
  await admin.getByRole("button", { name: "Desconectar" }).click();
  await admin.getByText("Google Calendar desconectado y acceso revocado.").waitFor();
  if (!(await outbox()).some((m) => m.kind === "google_revoke")) throw new Error("token not revoked");
  await admin.getByRole("link", { name: "Conectar con Google" }).waitFor();
});

await h.finish();
