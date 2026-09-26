// E2E: activate a catalog solution for a new client and use it end to end.
import { mkdirSync } from "node:fs";
import { createHarness } from "./lib.mjs";

mkdirSync("e2e/.artifacts", { recursive: true });
const h = await createHarness("solutions");
const { B, admin, step, ctx, browser } = h;

await step(1, "Login + nuevo cliente + abrir su panel", async () => {
  await h.login(admin, h.ADMIN);
  ctx.org = await h.createClient(`Clinica Sol ${h.RUN}`);
  await admin.getByRole("button", { name: "Abrir panel del cliente" }).click();
  await admin.waitForURL(/dashboard/);
  await h.ensureModels();
});
await step(2, "El catálogo muestra las 10 soluciones y filtra por categoría", async () => {
  await admin.goto(B + "/solutions");
  for (const n of ["AI Customer Support", "AI Sales Agent", "AI WhatsApp Agent", "AI Workflow Automation"]) await admin.getByText(n, { exact: true }).waitFor();
  await admin.getByRole("link", { name: "Ventas", exact: true }).click();
  await admin.waitForURL(/category=SALES/);
  await admin.getByText("AI Lead Qualification", { exact: true }).waitFor();
  if (await admin.getByText("AI Customer Support", { exact: true }).count()) throw new Error("category filter not applied");
});
await step(3, "Activar AI Customer Support con la configuración del cliente", async () => {
  await admin.goto(B + "/solutions/customer_support");
  await admin.getByText("SOL-CUSTOMER-SUPPORT-v1").waitFor();
  await admin.selectOption("#s-model", "openai:support-model");
  await admin.selectOption("#s-emb", "openai:support-embeddings");
  await admin.fill("#cfg-business_description", "Clínica Sol, odontología general en Madrid.");
  await admin.fill("#cfg-business_hours", "L-V de 10 a 19h");
  await admin.getByRole("button", { name: "Activar solución" }).click();
  await admin.getByText(/activada/).first().waitFor();
  await h.shot(admin, "solution-activated");
});
await step(4, "Se crearon agente activo, knowledge base, workflow publicado y canal", async () => {
  await admin.getByRole("link", { name: "Sube la documentación del negocio" }).click();
  await admin.waitForURL(/\/knowledge\/[0-9a-f-]{36}/);
  await admin.setInputFiles("input[type=file]", "packages/core/test/fixtures/horario.pdf");
  await admin.getByRole("button", { name: "Subir e indexar" }).click();
  await h.waitReady(admin);
  await admin.goto(B + "/workflows");
  await admin.getByText(/Revisión de consultas delicadas/).waitFor();
  await admin.getByText("active").first().waitFor();
});
await step(5, "El chat del cliente responde con su documentación", async () => {
  await admin.goto(B + "/integrations");
  const href = await admin.getByRole("link", { name: "Probar chat" }).first().getAttribute("href");
  const visitor = await (await browser.newContext()).newPage();
  visitor.setDefaultTimeout(20000);
  await visitor.goto(B + href);
  await visitor.fill("input[aria-label=Mensaje]", "¿Qué horario de apertura tenéis?");
  await visitor.getByRole("button", { name: "Enviar" }).click();
  await visitor.getByText(/lunes a viernes de 9 a 14h/).waitFor();
});
await step(6, "Credenciales: se guardan cifradas y nunca se muestran", async () => {
  await admin.goto(B + "/integrations");
  const form = admin.locator("form", { has: admin.locator("input[name=value]") });
  await form.getByLabel("Nombre").fill("CRM_TOKEN");
  await form.getByLabel("Valor").fill("tok-e2e-very-secret-value");
  await form.getByRole("button", { name: "Guardar" }).click();
  await admin.getByText("Credencial guardada (cifrada).").waitFor();
  await admin.getByText("CRM_TOKEN").waitFor();
  const html = await admin.content();
  if (html.includes("very-secret")) throw new Error("secret value rendered in the page");
  await admin.getByText("…alue").waitFor();
});

await h.finish();
