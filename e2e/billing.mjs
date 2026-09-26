// E2E: Stripe billing and the global Platform Admin. Stripe is replaced by
// e2e/fake-providers.mjs (TEST DOUBLE): its checkout page sends signed
// webhooks to the app and redirects back, exactly like Stripe Checkout.
import { mkdirSync } from "node:fs";
import { createHarness } from "./lib.mjs";

mkdirSync("e2e/.artifacts", { recursive: true });
const h = await createHarness("billing");
const { B, admin, step, ctx } = h;

await step(1, "Platform Admin vincula el plan Pro a un precio real de Stripe", async () => {
  await h.login(admin, h.ADMIN);
  await admin.goto(B + "/admin?tab=settings");
  const bad = admin.getByLabel("Stripe price ID para PRO");
  await bad.fill("price_doesnotexist");
  await admin.locator("form", { has: bad }).getByRole("button", { name: "Vincular" }).click();
  await admin.getByText(/precio no encontrado/).waitFor();
  const input = admin.getByLabel("Stripe price ID para PRO");
  await input.fill("price_e2epro");
  await admin.locator("form", { has: input }).getByRole("button", { name: "Vincular" }).click();
  await admin.getByText(/price_e2epro/).first().waitFor();
  await admin.getByText(/49,00\s€ \/ month/).first().waitFor();
});
await step(2, "El cliente ve el plan con el precio de Stripe y contrata", async () => {
  ctx.org = await h.createClient(`Academia Sur ${h.RUN}`);
  await admin.getByRole("button", { name: "Abrir panel del cliente" }).click();
  await admin.waitForURL(/dashboard/);
  await admin.goto(B + "/billing");
  await admin.getByText("Sin suscripción online.").waitFor();
  await admin.getByRole("button", { name: "Contratar Pro" }).click();
  await admin.waitForURL(/\/billing\?ok=checkout/, { timeout: 30000 });
  await admin.getByText(/Pago completado/).waitFor();
});
await step(3, "Webhooks firmados: plan activo, suscripción y factura reflejadas", async () => {
  await admin.reload();
  await admin.getByText("Activa", { exact: true }).waitFor();
  await admin.getByRole("heading", { name: "Pro" }).or(admin.getByText("Pro", { exact: true })).first().waitFor();
  await admin.getByText("E2E-0001").waitFor();
  await admin.getByText("Pagada").waitFor();
  await h.shot(admin, "client-billing");
});
await step(4, "Webhook con firma falsa rechazado", async () => {
  const forged = await fetch(`${B}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" }, body: JSON.stringify({ id: "evt_x", type: "invoice.paid", data: { object: {} } }) });
  if (forged.status !== 400) throw new Error(`forged webhook got ${forged.status}`);
});
await step(5, "Gestionar suscripción abre el portal de Stripe", async () => {
  await admin.goto(B + "/billing");
  await admin.getByRole("button", { name: "Gestionar suscripción y pago" }).click();
  await admin.getByText("Portal de facturación de pruebas").waitFor();
  await admin.getByRole("link", { name: "Volver" }).click();
  await admin.waitForURL(/\/billing/);
});
await step(6, "Vista global: KPIs reales, ingresos desde facturas y cliente con su suscripción", async () => {
  await admin.goto(B + "/admin");
  for (const k of ["Clientes", "Agentes activos", "Coste IA del mes", "Ingresos del mes", "Conversaciones activas", "Tasa de error"]) await admin.getByText(k, { exact: true }).first().waitFor();
  await admin.getByText("Facturas pagadas en Stripe").waitFor();
  const row = admin.locator("tr", { hasText: `Academia Sur ${h.RUN}` });
  await row.getByText("Activa").waitFor();
  await h.shot(admin, "admin-overview");
});
await step(7, "Pestañas globales: usuarios, facturación, errores, auditoría", async () => {
  await admin.goto(B + "/admin?tab=users&q=admin@agency");
  await admin.getByText("admin@agency.test").first().waitFor();
  await admin.goto(B + "/admin?tab=billing");
  await admin.locator("tr", { hasText: `Academia Sur ${h.RUN}` }).first().waitFor();
  await admin.goto(B + "/admin?tab=errors");
  await admin.getByRole("heading", { name: "Errores" }).or(admin.getByText("Errores", { exact: true })).first().waitFor();
  await admin.goto(B + "/admin?tab=audit&q=billing.");
  await admin.getByText("billing.checkout_started").first().waitFor();
  for (const t of ["agents", "workflows", "conversations", "leads", "templates"]) {
    const r = await admin.goto(`${B}/admin?tab=${t}`);
    if (r.status() !== 200) throw new Error(`tab ${t} → ${r.status()}`);
  }
});
await step(8, "Un usuario de cliente no puede entrar en Platform Admin", async () => {
  const user = { email: `owner.${h.RUN}@academia.test`, password: "Passw0rd!123456" };
  await h.createUser(ctx.org, user, "owner");
  const other = await (await h.browser.newContext()).newPage();
  await h.login(other, user);
  await other.goto(B + "/admin?tab=billing");
  await other.waitForURL(/dashboard\?error=forbidden/);
  await other.close();
});

await h.finish();
