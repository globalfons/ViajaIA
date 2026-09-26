// Shared helpers for browser E2E scripts (real app, real worker, Supabase stack).
import { chromium } from "playwright";

export async function createHarness(name) {
  const B = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? "admin@agency.test", password: process.env.E2E_ADMIN_PASSWORD ?? "Passw0rd!123" };
  const RUN = Date.now().toString(36);
  const browser = await chromium.launch();
  const admin = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  admin.setDefaultTimeout(15000);
  const problems = [];
  let failures = 0;
  let total = 0;
  const ctx = {};
  const watch = (p) => {
    p.on("pageerror", (e) => problems.push("pageerror " + e.message));
    p.on("response", (r) => r.status() >= 500 && problems.push("HTTP " + r.status() + " " + r.url()));
  };
  watch(admin);
  const shot = (p, n) => p.screenshot({ path: `e2e/.artifacts/${name}-${n}.png` });

  const h = {
    B,
    ADMIN,
    RUN,
    browser,
    admin,
    ctx,
    watch,
    shot,
    async step(n, label, fn) {
      total++;
      try {
        await fn();
        console.log(`OK   ${String(n).padStart(2)} ${label}`);
      } catch (e) {
        failures++;
        console.log(`FAIL ${String(n).padStart(2)} ${label} - ${e.message.split("\n")[0]}`);
        await shot(admin, `fail-${n}`).catch(() => {});
      }
    },
    async login(page, { email, password }) {
      await page.goto(B + "/login");
      await page.fill("#email", email);
      await page.fill("#password", password);
      await page.click("button[type=submit]");
      await page.waitForURL(/dashboard|onboarding|agents/);
    },
    async createClient(clientName) {
      await admin.goto(B + "/clients");
      await admin.fill("#name", clientName);
      await admin.fill("#slug", clientName.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
      await admin.getByRole("button", { name: "Crear cliente" }).click();
      await admin.waitForURL(/\/clients\/[0-9a-f-]{36}/);
      return admin.url().split("/clients/")[1].split("?")[0];
    },
    async createUser(orgId, user, role = "owner") {
      await admin.goto(`${B}/clients/${orgId}`);
      await admin.fill("input[name=email]", user.email);
      await admin.fill("input[name=password]", user.password);
      await admin.selectOption("select[name=role]", role);
      await admin.getByRole("button", { name: "Crear y añadir" }).click();
      await admin.getByText(/Usuario creado/).waitFor();
    },
    /** Platform-level chat + embedding models (priced) served by the OpenAI-format test double. */
    async ensureModels() {
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
    },
    async waitReady(page, text = "ready") {
      for (let i = 0; i < 20 && !(await page.getByText(text, { exact: true }).count()); i++) {
        await page.waitForTimeout(1500);
        await page.reload();
      }
      await page.getByText(text, { exact: true }).first().waitFor({ timeout: 3000 });
    },
    async finish() {
      console.log(`\n${total - failures}/${total} steps passed`);
      console.log("PROBLEMS", JSON.stringify(problems, null, 1));
      await browser.close();
      process.exit(failures || problems.length ? 1 : 0);
    },
  };
  return h;
}

export { chromium };
