// E2E: agent builder tabs, workflow run debugging (execution id, per-node
// duration/input/output) and OCR of scanned documents through the configured model.
import { mkdirSync } from "node:fs";
import { createHarness } from "./lib.mjs";

mkdirSync("e2e/.artifacts", { recursive: true });
const h = await createHarness("builder");
const { B, admin, step, ctx } = h;

await step(1, "Cliente con AI Customer Support", async () => {
  await h.login(admin, h.ADMIN);
  ctx.org = await h.createClient(`Restaurante Mar ${h.RUN}`);
  await admin.getByRole("button", { name: "Abrir panel del cliente" }).click();
  await admin.waitForURL(/dashboard/);
  await h.ensureModels();
  await admin.goto(B + "/solutions/customer_support");
  await admin.selectOption("#s-model", "openai:support-model");
  await admin.selectOption("#s-emb", "openai:support-embeddings");
  await admin.fill("#cfg-business_description", "Restaurante Mar, cocina mediterránea.");
  await admin.getByRole("button", { name: "Activar solución" }).click();
  await admin.getByText(/activada/).first().waitFor();
});
await step(2, "Agent Builder por pestañas: cambiar de pestaña conserva los cambios al guardar", async () => {
  await admin.goto(B + "/agents");
  await admin.locator("a[href^='/agents/']").filter({ hasText: /Soporte/ }).first().click();
  await admin.waitForURL(/\/agents\/[0-9a-f-]{36}/);
  for (const t of ["General", "Modelo", "Tools", "Conocimiento", "Seguridad y límites", "Salida"]) await admin.getByRole("tab", { name: new RegExp(`^${t}`) }).waitFor();
  await admin.fill("#a-desc", `Descripción editada ${h.RUN}`);
  await admin.getByRole("tab", { name: "Modelo" }).click();
  await admin.locator("#a-temp").focus();
  for (let i = 0; i < 3; i++) await admin.keyboard.press("ArrowRight");
  ctx.temp = await admin.inputValue("#a-temp");
  await admin.getByRole("tab", { name: /^Tools/ }).click();
  await admin.getByText("current_datetime").first().waitFor();
  await admin.getByRole("tab", { name: "Seguridad y límites" }).click();
  await admin.locator("#a-conf").waitFor();
  await admin.getByRole("button", { name: "Guardar", exact: true }).click();
  await admin.getByText(/Guardado \(v/).waitFor();
  await admin.reload();
  if ((await admin.inputValue("#a-desc")) !== `Descripción editada ${h.RUN}`) throw new Error("description not saved");
  await admin.getByRole("tab", { name: "Modelo" }).click();
  if ((await admin.inputValue("#a-temp")) !== ctx.temp) throw new Error(`temperature not saved (${ctx.temp})`);
  await h.shot(admin, "agent-tabs");
});
await step(3, "Ejecución de workflow: ID, duración total y por nodo, entrada y salida", async () => {
  await admin.goto(B + "/workflows");
  await admin.getByRole("link", { name: /Revisión de consultas delicadas/ }).first().click();
  await admin.waitForURL(/\/workflows\/[0-9a-f-]{36}/);
  await admin.getByLabel("Entrada JSON").fill(JSON.stringify({ message: `¿Tenéis menú sin gluten? ${h.RUN}` }));
  await admin.getByRole("button", { name: "Ejecutar publicada" }).click();
  await admin.waitForURL(/automations\/runs\/[0-9a-f-]{36}/);
  const runId = admin.url().split("/runs/")[1].split("?")[0];
  for (let i = 0; i < 20 && !(await admin.getByText("Revisión humana").count()); i++) await admin.waitForTimeout(1000);
  await admin.getByText("ID de ejecución").waitFor();
  await admin.getByText(runId).waitFor();
  await admin.getByText("Duración total").waitFor();
  const answer = admin.locator('[data-node="answer"]');
  await answer.getByText("Entrada", { exact: true }).click();
  await answer.getByText(`¿Tenéis menú sin gluten? ${h.RUN}`).first().waitFor();
  await answer.getByText(/^· \d/).first().waitFor(); // node duration
  await admin.locator('[data-node="review"]').getByText("waiting", { exact: true }).waitFor();
  // Execution order: start first, pending end node last.
  const order = await admin.locator("[data-node]").evaluateAll((els) => els.map((e) => e.getAttribute("data-node")));
  if (order[0] !== "start" || order[order.length - 1] !== "done") throw new Error("node order " + order.join(","));
  await h.shot(admin, "run-detail");
});
await step(4, "OCR: sin modelo la imagen falla con aviso; con modelo se transcribe e indexa", async () => {
  await admin.goto(B + "/admin?tab=settings");
  await admin.selectOption("select[name=ocrModel]", "");
  await admin.locator("form", { has: admin.locator("select[name=ocrModel]") }).getByRole("button", { name: "Guardar" }).click();
  await admin.getByText("Cambios guardados.").first().waitFor();
  await admin.goto(B + "/knowledge");
  await admin.locator("a[href^='/knowledge/']").first().click();
  await admin.waitForURL(/\/knowledge\/[0-9a-f-]{36}/);
  ctx.kbUrl = admin.url();
  await admin.setInputFiles("input[type=file]", "e2e/fixtures/carta-escaneada.png");
  await admin.getByRole("button", { name: "Subir e indexar" }).click();
  await h.waitReady(admin, "failed");
  await admin.getByText(/OCR model must be configured/).waitFor();

  await admin.goto(B + "/admin?tab=settings");
  await admin.selectOption("select[name=ocrModel]", "openai:support-model");
  await admin.locator("form", { has: admin.locator("select[name=ocrModel]") }).getByRole("button", { name: "Guardar" }).click();
  await admin.getByText("Cambios guardados.").first().waitFor();
  await admin.goto(ctx.kbUrl);
  await admin.locator("tr", { hasText: "carta-escaneada.png" }).getByRole("button", { name: "Reindexar" }).click();
  await h.waitReady(admin);
  await admin.goto(B + "/integrations");
  const href = await admin.getByRole("link", { name: "Probar chat" }).first().getAttribute("href");
  const v = await (await h.browser.newContext()).newPage();
  await v.goto(B + href);
  await v.fill("input[aria-label=Mensaje]", "¿Cuánto cuesta el menú del día?");
  await v.getByRole("button", { name: "Enviar" }).click();
  await v.getByText(/Menú del día: 14 euros/).waitFor({ timeout: 20000 });
  await v.close();
  await admin.goto(B + "/admin?tab=settings");
  await admin.selectOption("select[name=ocrModel]", "");
  await admin.locator("form", { has: admin.locator("select[name=ocrModel]") }).getByRole("button", { name: "Guardar" }).click();
});

await step(5, "Tiempo real (SSE): el visitante y el equipo ven los mensajes al instante", async () => {
  await admin.goto(B + "/integrations");
  const href = await admin.getByRole("link", { name: "Probar chat" }).first().getAttribute("href");
  const v = await (await h.browser.newContext()).newPage();
  h.watch(v);
  await v.goto(B + href);
  await v.fill("input[aria-label=Mensaje]", `Quiero hablar con una persona ${h.RUN}`);
  await v.getByRole("button", { name: "Enviar" }).click();
  await v.getByText(/persona del equipo/).first().waitFor({ timeout: 20000 });

  await admin.goto(B + "/conversations?status=escalated");
  await admin.locator("table a[href^='/conversations/']").first().click();
  await admin.waitForURL(/\/conversations\/[0-9a-f-]{36}/);
  await admin.getByText(`Quiero hablar con una persona ${h.RUN}`).waitFor();
  await admin.locator('[data-live="on"]').waitFor({ state: "attached" });

  await admin.getByLabel("Respuesta").fill(`Hola, soy Marta ${h.RUN}`);
  await admin.getByRole("button", { name: "Enviar respuesta" }).click();
  let t0 = Date.now();
  await v.getByText(`Hola, soy Marta ${h.RUN}`).waitFor({ timeout: 2500 }).catch(() => { throw new Error("visitor did not get the reply live"); }); // polling fallback would take ≥ 5 s
  const toVisitor = Date.now() - t0;

  await admin.locator('[data-live="on"]').waitFor({ state: "attached" });
  await v.fill("input[aria-label=Mensaje]", `Gracias Marta ${h.RUN}`);
  await v.getByRole("button", { name: "Enviar" }).click();
  t0 = Date.now();
  await admin.getByText(`Gracias Marta ${h.RUN}`).waitFor({ timeout: 2500 }).catch(() => { throw new Error("inbox did not update live"); }); // fallback refresh is 10 s
  console.log(`     live latency: visitor ${toVisitor} ms, inbox ${Date.now() - t0} ms`);
  await v.close();
});

await h.finish();
