// End-to-end journey through the real app (production build + worker + Supabase-compatible stack).
// Run: docker/e2e/up.sh, seed the admin (see docs/TESTING.md), start web + worker, then `pnpm e2e`.
import { chromium } from "playwright";
const B = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@agency.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Passw0rd!123";
import { mkdirSync } from "node:fs";
mkdirSync("e2e/.artifacts", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(12000);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror " + e.message));
page.on("console", (m) => m.type() === "error" && problems.push("console " + m.text()));
page.on("response", (r) => r.status() >= 500 && problems.push("HTTP " + r.status() + " " + r.url()));
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { globalThis.__fails = (globalThis.__fails ?? 0) + 1; console.log("FAIL", name, "-", e.message.split("\n")[0], "@", page.url()); await page.screenshot({ path: "e2e/.artifacts/fail-" + name.slice(0, 20).replace(/\W/g, "_") + ".png" }); } };
const shot = (n) => page.screenshot({ path: `e2e/.artifacts/${n}.png`, fullPage: false });

await step("redirects anonymous user to /login", async () => { await page.goto(B + "/agents"); if (!page.url().includes("/login?next=%2Fagents")) throw new Error(page.url()); });
await step("wrong password shows generic error", async () => {
  await page.fill("#email", ADMIN_EMAIL); await page.fill("#password", "wrongpass1"); await page.click("button[type=submit]");
  await page.getByText("Credenciales incorrectas").waitFor({ timeout: 8000 });
});
await step("login as platform admin", async () => {
  await page.fill("#password", ADMIN_PASSWORD); await page.click("button[type=submit]"); await page.waitForURL(/\/agents/, { timeout: 15000 }); await shot("01-agents-empty");
});
await step("clients list shows seeded orgs", async () => { await page.goto(B + "/clients"); await page.getByRole("cell", { name: /E2E Cliente A/ }).waitFor(); await shot("02-clients"); });
await step("create client from UI", async () => {
  await page.fill("#name", "Peluquería Sol " + Date.now()); await page.fill("#slug", "peluqueria-" + Date.now()); await page.click("text=Crear cliente");
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/); await page.getByText("Plan y límites").waitFor(); await shot("03-client-detail");
});
await step("open client panel (switch org)", async () => { await page.click("text=Abrir panel del cliente"); await page.waitForURL(/dashboard/); await page.getByText(/Resumen de Peluquería Sol/).waitFor(); await shot("04-dashboard"); });
await step("admin adds a chat model", async () => {
  await page.goto(B + "/admin?tab=settings"); await page.fill("input[name=model]", "test-model"); await page.selectOption("select[name=provider]", "openai");
  await page.fill("input[name=input_per_mtok]", "1"); await page.fill("input[name=output_per_mtok]", "2");
  await page.locator("form", { has: page.locator("input[name=model]") }).locator("button[type=submit]").click();
  await page.locator("td", { hasText: "openai:test-model" }).first().waitFor(); await shot("05-admin");
});
await step("create agent from Customer Support template", async () => {
  await page.goto(B + "/agents/new"); await page.fill("#name", "Asistente Peluquería"); await page.click("text=Crear agente");
  await page.waitForURL(/\/agents\/[0-9a-f-]{36}/); await page.getByText("Playground").waitFor(); await shot("06-agent-editor");
});
await step("save agent config (new version)", async () => { await page.fill("#a-desc", "Atiende dudas"); await page.click("text=Guardar"); await page.getByText(/Guardado \(v2\)/).waitFor(); });
await step("admin adds an embedding model", async () => {
  await page.goto(B + "/admin?tab=settings"); await page.fill("input[name=model]", "e2e-embeddings"); await page.selectOption("select[name=provider]", "openai");
  await page.selectOption("select[name=kind]", "embedding"); await page.fill("input[name=embedding_dimensions]", "1536");
  await page.locator("form", { has: page.locator("input[name=model]") }).locator("button[type=submit]").click();
  await page.locator("td", { hasText: "openai:e2e-embeddings" }).first().waitFor();
});
await step("create knowledge base and upload a PDF", async () => {
  await page.goto(B + "/knowledge"); await page.fill("input[name=name]", "Documentación"); await page.selectOption("select[name=embeddingModel]", "openai:e2e-embeddings");
  await page.getByRole("button", { name: "Crear" }).click(); await page.waitForURL(/\/knowledge\/[0-9a-f-]{36}/);
  await page.setInputFiles("input[type=file]", "packages/core/test/fixtures/horario.pdf");
  await page.getByRole("button", { name: "Subir e indexar" }).click(); await page.getByText(/En cola para indexar/).waitFor();
});
await step("worker indexes the document (status ready)", async () => {
  for (let i = 0; i < 20 && !(await page.getByText("ready", { exact: true }).count()); i++) { await page.waitForTimeout(1500); await page.reload(); }
  await page.getByText("ready", { exact: true }).waitFor({ timeout: 2000 }); await shot("11-knowledge");
});
await step("search tester retrieves the right fragment", async () => {
  await page.fill("input[aria-label=Consulta]", "horario de apertura"); await page.getByRole("button", { name: "Buscar" }).click();
  await page.getByText(/lunes a viernes/).first().waitFor();
});
await step("attach KB to the agent and answer from it with sources", async () => {
  await page.goto(B + "/agents"); await page.locator("table a").first().click(); await page.waitForURL(/\/agents\/[0-9a-f-]{36}/);
  await page.getByRole("tab", { name: "Conocimiento" }).click(); await page.getByLabel("Documentación").check(); await page.getByRole("button", { name: "Guardar", exact: true }).click(); await page.getByText(/Guardado \(v/).waitFor();
  await page.fill("textarea[placeholder='Escribe un mensaje…']", "¿Qué horario tenéis?"); await page.keyboard.press("Enter");
  await page.getByText(/Según la documentación: .*lunes a viernes/).first().waitFor({ timeout: 20000 });
  await page.getByText(/Fuentes: \[1\] horario/).waitFor();
  await page.getByText("completed", { exact: true }).waitFor();
  if (await page.getByText(/-- 1 of 1 --/).count()) throw new Error("PDF page separator leaked into the answer");
  if (!(await page.getByLabel("Documentación").isChecked())) throw new Error("KB checkbox shows unchecked after saving");
  await shot("12-rag-answer");
});
await step("create workflow and open builder", async () => {
  await page.goto(B + "/workflows"); await page.fill("input[name=name]", "Flujo prueba"); await page.click("text=Crear y abrir el editor");
  await page.waitForURL(/\/workflows\/[0-9a-f-]{36}/); await page.locator(".react-flow__node").first().waitFor(); await shot("08-builder");
});
await step("publish + run published workflow → worker completes it", async () => {
  await page.getByRole("button", { name: "Publicar" }).click(); await page.getByText(/Publicada la versión/).waitFor();
  await page.getByRole("button", { name: "Ejecutar publicada" }).click(); await page.waitForURL(/automations\/runs/);
  for (let i = 0; i < 15 && !(await page.getByText("completed").count()); i++) { await page.waitForTimeout(1500); await page.reload(); }
  await page.getByText("completed").first().waitFor({ timeout: 2000 }); await shot("09-run");
});
for (const p of ["/usage", "/analytics", "/automations", "/settings", "/dashboard"]) {
  await step("page " + p, async () => { await page.goto(B + p); await page.locator("h1").first().waitFor(); await shot("10" + p.replace("/", "-")); });
}
await step("API keys: create key and call API", async () => {
  await page.goto(B + "/settings"); await page.fill("#k-name", "test"); await page.click("text=Crear clave");
  const key = await page.locator("input[readonly]").inputValue();
  const r = await fetch(B + "/api/v1/agents", { headers: { authorization: "Bearer " + key } }); const j = await r.json();
  if (r.status !== 200 || j.data.length !== 1) throw new Error(r.status + JSON.stringify(j).slice(0, 200));
});
await step("sign out", async () => { await page.click("button[aria-label='Cerrar sesión']"); await page.waitForURL(/login/); });
console.log("PROBLEMS", JSON.stringify(problems, null, 1));
const failed = (globalThis.__fails ?? 0) + problems.length;
await browser.close();
process.exit(failed ? 1 : 0);
