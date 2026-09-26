// E2E: sales solution captures leads from the chat, CRM pipeline, and the
// "require admin approval" limit policy.
import { mkdirSync } from "node:fs";
import { createHarness } from "./lib.mjs";

mkdirSync("e2e/.artifacts", { recursive: true });
const h = await createHarness("crm");
const { B, admin, step, ctx, browser } = h;

await step(1, "Nuevo cliente + activar AI Sales Agent", async () => {
  await h.login(admin, h.ADMIN);
  ctx.org = await h.createClient(`Academia Norte ${h.RUN}`);
  await admin.getByRole("button", { name: "Abrir panel del cliente" }).click();
  await admin.waitForURL(/dashboard/);
  await h.ensureModels();
  await admin.goto(B + "/solutions/sales_agent");
  await admin.selectOption("#s-model", "openai:support-model");
  await admin.selectOption("#s-emb", "openai:support-embeddings");
  await admin.fill("#cfg-business_description", "Academia Norte: cursos de inglés para empresas.");
  await admin.getByRole("button", { name: "Activar solución" }).click();
  await admin.getByText(/activada/).first().waitFor();
});
await step(2, "Un visitante pide presupuesto en el chat → lead capturado", async () => {
  await admin.goto(B + "/integrations");
  const href = await admin.getByRole("link", { name: "Probar chat" }).first().getAttribute("href");
  const visitor = await (await browser.newContext()).newPage();
  visitor.setDefaultTimeout(20000);
  h.watch(visitor);
  await visitor.goto(B + href);
  await visitor.fill("input[aria-label=Mensaje]", "Quiero contratar un curso para 12 personas, ¿qué presupuesto tenéis?");
  await visitor.getByRole("button", { name: "Enviar" }).click();
  await visitor.locator("[data-role=assistant], .assistant, [data-from=assistant]").first().or(visitor.getByText(/documentación/)).first().waitFor();
  await visitor.close();
  // Lead capture is asynchronous bookkeeping after the reply.
  for (let i = 0; i < 10; i++) {
    await admin.goto(B + "/leads");
    if (await admin.locator("[data-stage=QUALIFIED]").getByText(/Visitante/).count()) break;
    await admin.waitForTimeout(1000);
  }
  await admin.locator("[data-stage=QUALIFIED]").getByText(/Visitante/).first().waitFor({ timeout: 3000 });
  await admin.locator("[data-stage=QUALIFIED]").getByText("80").first().waitFor();
  await h.shot(admin, "board");
});
await step(3, "Ficha del lead: nota, tarea, oportunidad y cambio de etapa", async () => {
  await admin.locator("[data-stage=QUALIFIED]").getByRole("link", { name: /Visitante/ }).first().click();
  await admin.waitForURL(/\/leads\/[0-9a-f-]{36}/);
  await admin.getByText(/registrado por el agente/).waitFor();
  await admin.getByLabel("Nota").fill("Llamar el lunes, interesados en modalidad in-company.");
  await admin.getByRole("button", { name: "Guardar nota" }).click();
  await admin.getByText("Llamar el lunes, interesados en modalidad in-company.").waitFor();
  await admin.getByLabel("Nueva tarea").fill("Enviar propuesta in-company");
  await admin.getByRole("button", { name: "Añadir" }).click();
  await admin.getByText("Enviar propuesta in-company").waitFor();
  await admin.getByLabel("Importe").fill("4800");
  await admin.getByRole("button", { name: "Guardar", exact: true }).click();
  await admin.getByText(/Abierta · 4\.?800/).waitFor();
  await admin.selectOption("select[aria-label=Etapa]", "PROPOSAL");
  await admin.getByRole("button", { name: "Cambiar etapa" }).click();
  await admin.getByText("QUALIFIED → PROPOSAL").waitFor();
});
await step(4, "Mover desde el tablero", async () => {
  await admin.goto(B + "/leads");
  const card = admin.locator("[data-stage=PROPOSAL] > div").filter({ hasText: /Visitante/ }).first();
  await card.locator("select[aria-label='Mover a']").selectOption("WON");
  await card.getByRole("button", { name: "Mover" }).click();
  await admin.locator("[data-stage=WON]").getByText(/Visitante/).waitFor();
});
await step(5, "Lead manual con base legal RGPD", async () => {
  await admin.getByLabel("Nombre", { exact: true }).fill("Marta Ruiz");
  await admin.getByLabel("Email", { exact: true }).fill(`marta.${h.RUN}@example.com`);
  await admin.getByLabel("Valor").fill("1200");
  await admin.getByRole("button", { name: "Crear lead" }).click();
  await admin.waitForURL(/\/leads\/[0-9a-f-]{36}/);
  await admin.getByText("Marta Ruiz").first().waitFor();
  await admin.getByText(/Solicitud del propio interesado/).waitFor();
});
await step(6, "Política «pedir aprobación»: al llegar al límite se pide al admin", async () => {
  await admin.goto(`${B}/clients/${ctx.org}`);
  await admin.fill("#limits", JSON.stringify({ max_workflow_runs_per_month: 0 }));
  await admin.selectOption("#policy", "require_approval");
  await admin.locator("form", { has: admin.locator("#policy") }).getByRole("button", { name: "Guardar" }).click();
  await admin.waitForLoadState("networkidle");
  await admin.goto(B + "/workflows");
  await admin.getByRole("link", { name: /Cualificación y derivación/ }).first().click();
  await admin.waitForURL(/\/workflows\/[0-9a-f-]{36}/);
  ctx.wfUrl = admin.url();
  await admin.getByRole("button", { name: "Ejecutar publicada" }).click();
  await admin.getByText(/Se ha pedido aprobación al administrador/).waitFor();
  await admin.goto(B + "/usage");
  await admin.getByText(/el servicio está en pausa hasta que el administrador lo apruebe/).waitFor();
});
await step(7, "El admin aprueba margen extra y la ejecución funciona", async () => {
  await admin.goto(B + "/admin");
  const row = admin.locator("form", { has: admin.locator("input[name=extra]") }).first();
  await row.locator("input[name=extra]").fill("5");
  await row.getByRole("button", { name: "Aprobar" }).click();
  await admin.waitForLoadState("networkidle");
  await admin.goto(B + "/usage");
  if (await admin.getByText(/el servicio está en pausa/).count()) throw new Error("banner still visible after approval");
  await admin.goto(ctx.wfUrl);
  await admin.getByRole("button", { name: "Ejecutar publicada" }).click();
  await admin.waitForURL(/automations\/runs/);
});

await h.finish();
