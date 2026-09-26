// E2E: public commercial website (anonymous), responsive checks, honest demo
// modes and the contact form through to the Platform Admin.
import { mkdirSync } from "node:fs";
import { createHarness } from "./lib.mjs";

mkdirSync("e2e/.artifacts", { recursive: true });
const h = await createHarness("site");
const { B, admin, step, ctx, browser } = h;
const ROUTES = ["/", "/soluciones", "/soluciones/customer-support", "/soluciones/ventas", "/soluciones/whatsapp", "/soluciones/documentos", "/soluciones/marketing", "/soluciones/automatizacion", "/sectores", "/casos-de-uso", "/precios", "/demo", "/contacto", "/privacidad", "/aviso-legal"];
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, mobile: { width: 390, height: 844 } };

await step(1, "Todas las páginas públicas cargan sin sesión en escritorio, tablet y móvil", async () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const c = await browser.newContext({ viewport });
    const p = await c.newPage();
    h.watch(p);
    for (const r of ROUTES) {
      const res = await p.goto(B + r);
      if (res.status() !== 200) throw new Error(`${name} ${r} → ${res.status()}`);
      if (/\/login/.test(p.url())) throw new Error(`${r} redirected to login`);
      await p.locator("h1").first().waitFor();
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) throw new Error(`${name} ${r} horizontal overflow ${overflow}px`);
    }
    if (name !== "tablet") await p.goto(B + "/").then(() => h.shot(p, `home-${name}`));
    await c.close();
  }
});
await step(2, "Rutas inexistentes dan 404 y el panel sigue protegido", async () => {
  const c = await browser.newContext();
  const p = await c.newPage();
  const r = await p.goto(B + "/soluciones/no-existe");
  if (r.status() !== 404) throw new Error(`expected 404, got ${r.status()}`);
  await p.goto(B + "/dashboard");
  await p.waitForURL(/\/login/);
  const robots = await (await fetch(B + "/robots.txt")).text();
  if (!robots.includes("Disallow: /admin")) throw new Error("robots.txt");
  if (!(await (await fetch(B + "/sitemap.xml")).text()).includes("/soluciones/ventas")) throw new Error("sitemap");
  await c.close();
});
await step(3, "Menú móvil navega", async () => {
  const c = await browser.newContext({ viewport: VIEWPORTS.mobile });
  const p = await c.newPage();
  await p.goto(B + "/");
  await p.getByText("Menú", { exact: true }).click();
  await p.getByRole("navigation", { name: "Menú móvil" }).getByRole("link", { name: "Precios" }).click();
  await p.waitForURL(/\/precios/);
  await p.getByRole("heading", { level: 1 }).waitFor();
  await c.close();
});
await step(4, "Precios: planes reales, sin precios inventados", async () => {
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(B + "/precios");
  for (const n of ["Starter", "Pro", "Business", "Enterprise"]) await p.getByRole("heading", { name: n, exact: true }).waitFor();
  // Only Stripe-linked plans may show an amount; the rest say so explicitly.
  if (!(await p.getByText("Precio según propuesta").count())) throw new Error("expected unpriced plans to say 'Precio según propuesta'");
  await c.close();
});
await step(5, "Demo sin configurar: modo DEMO claramente etiquetado", async () => {
  await h.login(admin, h.ADMIN);
  await admin.goto(B + "/admin?tab=settings");
  await admin.fill("input[name=demoKey]", "");
  await admin.locator("form", { has: admin.locator("input[name=demoKey]") }).getByRole("button", { name: "Guardar" }).click();
  await admin.getByText("Cambios guardados.").first().waitFor();
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(B + "/demo");
  await p.getByText(/MODO DEMO · Conversación de ejemplo predefinida/).waitFor();
  await p.getByRole("tab", { name: "Ventas" }).click();
  for (let i = 0; i < 3; i++) await p.getByRole("button", { name: "Siguiente mensaje" }).click();
  await p.getByRole("button", { name: "Fin del ejemplo" }).waitFor();
  await p.getByText(/puntuación 80/).waitFor();
  if (await p.locator("iframe").count()) throw new Error("live chat shown without configuration");
  await c.close();
});
await step(6, "Contacto: validación, honeypot y envío con consentimiento", async () => {
  const c = await browser.newContext({ viewport: VIEWPORTS.mobile });
  const p = await c.newPage();
  h.watch(p);
  await p.goto(B + "/contacto?interes=ventas");
  if ((await p.locator("#c-interest").inputValue()) !== "ventas") throw new Error("interest not preselected");
  await p.getByRole("button", { name: "Enviar" }).click();
  await p.getByText("Debes aceptar la política de privacidad").waitFor();
  await p.getByText("Indica tu nombre").waitFor();
  await p.fill("#c-name", "Marta Prueba");
  await p.fill("#c-email", `marta.${h.RUN}@example.com`);
  await p.fill("#c-company", "Academia Prueba");
  await p.fill("#c-message", "Queremos atender a los alumnos por WhatsApp y cualificar interesados.");
  await p.locator("input[name=privacy]").check();
  await p.getByRole("button", { name: "Enviar" }).click();
  await p.getByText("Mensaje recibido. Gracias.").waitFor();
  // A bot filling the hidden honeypot gets the same answer but nothing is stored.
  const bot = await c.newPage();
  await bot.goto(B + "/contacto");
  await bot.fill("#c-name", "Bot");
  await bot.fill("#c-email", `bot.${h.RUN}@example.com`);
  await bot.fill("#c-message", "Compra seguidores baratos ahora mismo");
  await bot.locator("input[name=privacy]").check();
  await bot.locator("input[name=website]").fill("http://spam.example", { force: true });
  await bot.getByRole("button", { name: "Enviar" }).click();
  await bot.getByText("Mensaje recibido. Gracias.").waitFor();
  await c.close();
});
await step(7, "La solicitud llega a Platform Admin → Contactos", async () => {
  await admin.goto(B + "/admin?tab=contacts");
  const row = admin.locator("tr", { hasText: `marta.${h.RUN}@example.com` });
  await row.waitFor();
  await row.locator("select[name=status]").selectOption("contacted");
  await row.getByRole("button", { name: "Guardar" }).click();
  await admin.getByText("Cambios guardados.").first().waitFor();
  if (await admin.getByText(`bot.${h.RUN}@example.com`).count()) throw new Error("honeypot submission was stored");
  await admin.goto(B + "/admin?tab=contacts&q=contacted");
  await admin.locator("tr", { hasText: `marta.${h.RUN}@example.com` }).waitFor();
});
await step(8, "Demo en vivo con la IA real cuando la agencia la configura", async () => {
  ctx.org = await h.createClient(`Demo Negocio ${h.RUN}`);
  await admin.getByRole("button", { name: "Abrir panel del cliente" }).click();
  await admin.waitForURL(/dashboard/);
  await h.ensureModels();
  await admin.goto(B + "/solutions/customer_support");
  await admin.selectOption("#s-model", "openai:support-model");
  await admin.selectOption("#s-emb", "openai:support-embeddings");
  await admin.fill("#cfg-business_description", "Negocio ficticio para la demo pública.");
  await admin.getByRole("button", { name: "Activar solución" }).click();
  await admin.getByText(/activada/).first().waitFor();
  await admin.getByRole("link", { name: "Sube la documentación del negocio" }).click();
  await admin.setInputFiles("input[type=file]", "packages/core/test/fixtures/horario.pdf");
  await admin.getByRole("button", { name: "Subir e indexar" }).click();
  await h.waitReady(admin);
  await admin.goto(B + "/integrations");
  const key = (await admin.getByRole("link", { name: "Probar chat" }).first().getAttribute("href")).split("/chat/")[1];
  await admin.goto(B + "/admin?tab=settings");
  await admin.fill("input[name=demoKey]", key);
  await admin.locator("form", { has: admin.locator("input[name=demoKey]") }).getByRole("button", { name: "Guardar" }).click();
  await admin.getByText("Cambios guardados.").first().waitFor();

  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(B + "/demo");
  await p.getByText("Demo en vivo · IA real").waitFor();
  const chat = p.frameLocator("iframe[title='Chat de demostración con un agente de IA']");
  await chat.locator("input[aria-label=Mensaje]").fill("¿Qué horario de apertura tenéis?");
  await chat.getByRole("button", { name: "Enviar" }).click();
  await chat.getByText(/lunes a viernes de 9 a 14h/).waitFor({ timeout: 20000 });
  await h.shot(p, "demo-live");
  await c.close();
  // Leave the platform in the default (scripted) mode for other runs.
  await admin.goto(B + "/admin?tab=settings");
  await admin.fill("input[name=demoKey]", "");
  await admin.locator("form", { has: admin.locator("input[name=demoKey]") }).getByRole("button", { name: "Guardar" }).click();
  await admin.getByText("Cambios guardados.").first().waitFor();
});

await h.finish();
