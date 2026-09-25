// Responsive checks for the dashboard on phone and tablet viewports.
import { chromium, devices } from "playwright";
const B = process.env.E2E_BASE_URL ?? "http://localhost:3000";
let failures = 0;
const b = await chromium.launch();
for (const [name, dev] of [["iphone", devices["iPhone 13"]], ["ipad", devices["iPad Mini"]]]) {
  const ctx = await b.newContext({ ...dev }); const page = await ctx.newPage();
  await page.goto(B + "/login"); await page.fill("#email", process.env.E2E_ADMIN_EMAIL ?? "admin@agency.test"); await page.fill("#password", process.env.E2E_ADMIN_PASSWORD ?? "Passw0rd!123"); await page.click("button[type=submit]");
  await page.waitForURL(/dashboard/);
  for (const p of ["/usage", "/knowledge", "/agents", "/automations", "/settings"]) {
    await page.goto(B + p); await page.locator("h1").first().waitFor();
    const o = await page.evaluate(() => { const m = document.querySelector("main"); const cut = [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(e).position !== "fixed" && !e.closest(".overflow-x-auto")).length; return (document.documentElement.scrollWidth - window.innerWidth) + "/" + (m.scrollWidth - m.clientWidth) + " cut:" + cut; });
    const h1 = await page.locator("h1").first().boundingBox();
    const bad = !o.startsWith("0/0 cut:0") || h1.x < 8;
    if (bad) failures++;
    console.log(bad ? "FAIL" : "OK  ", name, p, "overflow", o, "h1.x", Math.round(h1.x));
  }
  
  await page.getByRole("button", { name: "Abrir menú" }).click();
  
  await page.getByRole("link", { name: "Knowledge" }).last().click(); await page.waitForURL(/knowledge/);
  const closed = !(await page.getByRole("dialog").count());
  if (!closed) failures++;
  console.log(closed ? "OK  " : "FAIL", name, "menu navigates and closes");
  await ctx.close();
}
await b.close();
process.exit(failures ? 1 : 0);
