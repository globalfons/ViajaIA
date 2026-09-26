// MVP acceptance test: the 17 steps that define "MVP achieved", executed in a
// real browser against the production build, the worker and a Supabase stack.
// LLM calls go to e2e/fake-providers.mjs (TEST DOUBLE) via OPENAI_BASE_URL.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? "admin@agency.test", password: process.env.E2E_ADMIN_PASSWORD ?? "Passw0rd!123" };
const RUN = Date.now().toString(36);
const USER_A = { email: `owner-a-${RUN}@clinica.test`, password: "Temporal-Passw0rd-A" };
const USER_B = { email: `owner-b-${RUN}@otra.test`, password: "Temporal-Passw0rd-B" };
mkdirSync("e2e/.artifacts", { recursive: true });

const browser = await chromium.launch();
const admin = await browser.newPage({ viewport: { width: 1440, height: 900 } });
admin.setDefaultTimeout(15000);
const problems = [];
let failures = 0;
const watch = (p) => {
  p.on("pageerror", (e) => problems.push("pageerror " + e.message));
  p.on("response", (r) => r.status() >= 500 && problems.push("HTTP " + r.status() + " " + r.url()));
};
watch(admin);
const shot = (p, n) => p.screenshot({ path: `e2e/.artifacts/mvp-${n}.png` });
const ctx = {};
async function step(n, name, fn) {
  try {
    await fn();
    console.log(`OK   ${String(n).padStart(2)} ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${String(n).padStart(2)} ${name} - ${e.message.split("\n")[0]}`);
    await shot(admin, `fail-${n}`).catch(() => {});
  }
}
async function login(page, { email, password }) {
  await page.goto(B + "/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL(/dashboard|onboarding|agents/);
}
async function createClient(name) {
  await admin.goto(B + "/clients");
  await admin.fill("#name", name);
  await admin.fill("#slug", name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  await admin.getByRole("button", { name: "Crear cliente" }).click();
  await admin.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  return admin.url().split("/clients/")[1].split("?")[0];
}
async function createUser(orgId, user) {
  await admin.goto(`${B}/clients/${orgId}`);
  await admin.fill("input[name=email]", user.email);
  await admin.fill("input[name=password]", user.password);
  await admin.selectOption("select[name=role]", "owner");
  await admin.getByRole("button", { name: "Crear y añadir" }).click();
  await admin.getByText(/Usuario creado/).waitFor();
}

await step(1, "Entrar como administrador", () => login(admin, ADMIN));
await step(2, "Crear una organización", async () => {
  ctx.orgA = await createClient(`Clinica Dental ${RUN}`);
});
await step(3, "Crear un usuario", () => createUser(ctx.orgA, USER_A));
await step(4, "Crear un agente (plantilla Customer Support)", async () => {
  await admin.goto(`${B}/clients/${ctx.orgA}`);
  await admin.getByRole("button", { name: "Abrir panel del cliente" }).click();
  await admin.waitForURL(/dashboard/);
  // Models are platform-level: ensure a chat and an embedding model exist.
  for (const [model, kind] of [["support-model", "chat"], ["support-embeddings", "embedding"]]) {
    await admin.goto(B + "/admin?tab=settings");
    if (await admin.locator("td", { hasText: `openai:${model}` }).count()) continue;
    await admin.fill("input[name=model]", model);
    await admin.selectOption("select[name=provider]", "openai");
    await admin.selectOption("select[name=kind]", kind);
    await admin.fill("input[name=input_per_mtok]", "2");
    await admin.fill("input[name=output_per_mtok]", "8");
    if (kind === "embedding") await admin.fill("input[name=embedding_dimensions]", "1536");
    await admin.locator("form", { has: admin.locator("input[name=model]") }).locator("button[type=submit]").click();
    await admin.locator("td", { hasText: `openai:${model}` }).first().waitFor();
  }
  await admin.goto(B + "/agents/new");
  await admin.fill("#name", "Asistente de la clínica");
  await admin.selectOption("#model", "openai:support-model");
  await admin.getByRole("button", { name: "Crear agente" }).click();
  await admin.waitForURL(/\/agents\/[0-9a-f-]{36}/);
  ctx.agentUrl = admin.url();
});
await step(5, "Seleccionar un modelo", async () => {
  if ((await admin.inputValue("#a-model")) !== "openai:support-model") throw new Error("model not selected");
});
await step(6, "Crear una knowledge base", async () => {
  await admin.goto(B + "/knowledge");
  await admin.fill("input[name=name]", "Documentación de la clínica");
  await admin.selectOption("select[name=embeddingModel]", "openai:support-embeddings");
  await admin.getByRole("button", { name: "Crear" }).click();
  await admin.waitForURL(/\/knowledge\/[0-9a-f-]{36}/);
  ctx.kbUrl = admin.url();
});
await step(7, "Subir documentación (PDF) y que se indexe", async () => {
  await admin.setInputFiles("input[type=file]", "packages/core/test/fixtures/horario.pdf");
  await admin.getByRole("button", { name: "Subir e indexar" }).click();
  await admin.getByText(/En cola para indexar/).waitFor();
  for (let i = 0; i < 20 && !(await admin.getByText("ready", { exact: true }).count()); i++) {
    await admin.waitForTimeout(1500);
    await admin.reload();
  }
  await admin.getByText("ready", { exact: true }).waitFor({ timeout: 3000 });
  // Connect the KB to the agent and activate it.
  await admin.goto(ctx.agentUrl);
  await admin.getByRole("tab", { name: "Conocimiento" }).click();
  await admin.getByLabel("Documentación de la clínica").check();
  await admin.getByRole("tab", { name: "General" }).click();
  await admin.selectOption("#a-status", "active");
  await admin.getByRole("button", { name: "Guardar", exact: true }).click();
  await admin.getByText(/Guardado \(v/).waitFor();
});
await step(8, "Crear un workflow", async () => {
  await admin.goto(B + "/workflows");
  await admin.fill("input[name=name]", "Seguimiento de consultas");
  await admin.getByRole("button", { name: "Crear y abrir el editor" }).click();
  await admin.waitForURL(/\/workflows\/[0-9a-f-]{36}/);
  await admin.getByRole("button", { name: "Publicar" }).click();
  await admin.getByText(/Publicada la versión/).waitFor();
});
await step(9, "Ejecutar el workflow (lo completa el worker)", async () => {
  await admin.getByRole("button", { name: "Ejecutar publicada" }).click();
  await admin.waitForURL(/automations\/runs/);
  for (let i = 0; i < 15 && !(await admin.getByText("completed").count()); i++) {
    await admin.waitForTimeout(1500);
    await admin.reload();
  }
  await admin.getByText("completed").first().waitFor({ timeout: 3000 });
});
let visitor;
await step(10, "Abrir una conversación (chat web público)", async () => {
  await admin.goto(B + "/integrations");
  await admin.fill("#ch-name", "Web de la clínica");
  await admin.getByRole("button", { name: "Crear chat web" }).click();
  await admin.getByText("Canal creado.").waitFor();
  ctx.chatUrl = await admin.getByRole("link", { name: "Probar chat" }).first().getAttribute("href");
  const anon = await browser.newContext({ viewport: { width: 400, height: 700 } }); // no session: a website visitor
  visitor = await anon.newPage();
  visitor.setDefaultTimeout(20000);
  watch(visitor);
  await visitor.goto(B + ctx.chatUrl);
  await visitor.getByText(/asistente virtual/).waitFor();
  await visitor.getByText(/Asistente de IA/).waitFor(); // AI disclosure
});
await step(11, "Hacer una pregunta", async () => {
  await visitor.fill("input[aria-label=Mensaje]", "¿Qué horario tenéis?");
  await visitor.getByRole("button", { name: "Enviar" }).click();
});
await step(12, "Obtener una respuesta basada en la knowledge base", async () => {
  await visitor.getByText(/Según la documentación: .*lunes a viernes de 9 a 14h/).waitFor();
  await shot(visitor, "12-visitor-answer");
});
await step(13, "Ver la ejecución (inbox con modelo, tokens, coste y fuentes)", async () => {
  await admin.goto(B + "/conversations");
  await admin.locator("table a").first().click();
  await admin.waitForURL(/\/conversations\/[0-9a-f-]{36}/);
  ctx.conversationUrl = admin.url();
  await admin.getByText("openai:support-model", { exact: false }).first().waitFor();
  await admin.getByText(/Fuentes: \[1\] horario/).waitFor();
  await admin.getByText(/tokens ·/).first().waitFor();
  await shot(admin, "13-inbox");
});
await step(14, "Ver el consumo", async () => {
  await admin.goto(B + "/usage");
  await admin.getByText("openai:support-model").first().waitFor();
  await admin.getByText("openai:support-embeddings").first().waitFor();
});
await step(15, "Ver el coste (distinto de cero y con precio)", async () => {
  const cost = await admin.locator("text=Coste IA (mes)").locator("xpath=..").innerText();
  if (!/[1-9]/.test(cost.replace(/Coste IA \(mes\)/, ""))) throw new Error(`cost looks zero: ${cost}`);
  if (await admin.getByText(/Modelos sin precio/).count()) throw new Error("unpriced models reported");
  await shot(admin, "15-usage");
});
await step(16, "Crear una segunda organización (con su usuario)", async () => {
  ctx.orgB = await createClient(`Otra Empresa ${RUN}`);
  await createUser(ctx.orgB, USER_B);
});
await step(17, "La segunda organización NO puede acceder a los datos de la primera", async () => {
  const other = await browser.newContext();
  const b = await other.newPage();
  b.setDefaultTimeout(15000);
  watch(b);
  await login(b, USER_B);
  for (const [path, marker] of [
    ["/conversations", /Aún no hay conversaciones/],
    ["/agents", /Todavía no hay agentes/],
    ["/knowledge", /Aún no hay knowledge bases/],
    ["/workflows", /Todavía no hay workflows/],
  ]) {
    await b.goto(B + path);
    await b.getByText(marker).waitFor();
  }
  // Direct URLs of organization A (ID manipulation) → 404, never data.
  for (const url of [ctx.conversationUrl, ctx.agentUrl, ctx.kbUrl]) {
    const res = await b.goto(url);
    if (res.status() !== 404) throw new Error(`${url} returned ${res.status()}`);
    await b.getByText(/could not be found/).waitFor();
    if (await b.getByText(/lunes a viernes|Asistente de la clínica|Documentación de la clínica/).count()) throw new Error(`data of org A leaked at ${url}`);
  }
  // Org B cannot switch into org A via the org cookie either.
  await other.addCookies([{ name: "dtn_org", value: ctx.orgA, url: B }]);
  await b.goto(B + "/agents");
  if (await b.getByText("Asistente de la clínica").count()) throw new Error("org cookie manipulation leaked org A");
  await other.close();
});

// Beyond the 17 steps: escalation to a human and the reply reaching the visitor.
await step(18, "Pregunta fuera de la documentación → escalado a humano", async () => {
  await visitor.fill("input[aria-label=Mensaje]", "¿Aceptáis el seguro Zeta para implantes?");
  await visitor.getByRole("button", { name: "Enviar" }).click();
  await visitor.getByText(/Una persona del equipo continuará/).waitFor();
});
await step(19, "El equipo responde y el visitante lo recibe", async () => {
  await admin.goto(ctx.conversationUrl);
  await admin.getByText(/Escalada:/).waitFor();
  await admin.fill("textarea[name=text]", "Hola, soy Marta, de recepción. Sí, trabajamos con el seguro Zeta.");
  await admin.getByRole("button", { name: "Enviar respuesta" }).click();
  await admin.getByText("Respuesta enviada.").waitFor();
  await visitor.getByText(/soy Marta, de recepción/).waitFor({ timeout: 20000 });
  await visitor.getByText(/Te atiende una persona del equipo/).waitFor();
  await shot(visitor, "19-human-reply");
});

console.log(`\n${19 - failures}/19 steps passed`);
console.log("PROBLEMS", JSON.stringify(problems, null, 1));
await browser.close();
process.exit(failures || problems.length ? 1 : 0);
