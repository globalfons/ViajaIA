// TEST DOUBLE — NOT AN AI and NOT a real Meta/Resend service. Speaks the
// providers' HTTP formats so E2E tests run the real code paths without API keys
// or network access.
//  - /v1/embeddings: deterministic bag-of-words hashing vectors (1536 dims)
//  - /v1/chat/completions: echoes the first knowledge excerpt it was given,
//    which proves retrieval → context → LLM wiring end to end.
//  - /graph/v21.0/*: WhatsApp Cloud API (number lookup, send message)
//  - /resend/emails: Resend send API
//  - /google/*: OAuth consent (auto-approves), token, revoke, Calendar freeBusy/events
//  - /stripe/*: Stripe API (prices, customers, checkout, portal); its checkout page
//    "pays" by sending signed webhooks to the app, like Stripe does
//  - /_outbox: messages "sent" through the doubles (GET to read, DELETE to clear)
import { createHmac } from "node:crypto";
import http from "node:http";

const DIMS = 1536;
const outbox = [];
const stripeSessions = new Map();
const STRIPE_PRICES = { price_e2epro: { id: "price_e2epro", active: true, currency: "eur", unit_amount: 4900, recurring: { interval: "month", interval_count: 1 }, product: "prod_e2e" } };
async function stripeWebhook(event) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET ?? "").update(`${t}.${payload}`).digest("hex");
  const res = await fetch(`${process.env.APP_URL ?? "http://localhost:3000"}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${sig}` }, body: payload });
  outbox.push({ kind: "stripe_webhook", type: event.type, status: res.status });
}
function embed(text) {
  const v = new Array(DIMS).fill(0);
  for (const w of text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").split(/\W+/).filter((x) => x.length > 2)) {
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % DIMS] += 1;
  }
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / n);
}

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const form = (req.headers["content-type"] ?? "").includes("x-www-form-urlencoded") ? new URLSearchParams(body) : null;
      const json = !form && body ? JSON.parse(body) : {};
      res.setHeader("content-type", "application/json");
      const auth = req.headers.authorization ?? "";
      if (req.url === "/_outbox") {
        if (req.method === "DELETE") outbox.length = 0;
        return res.end(JSON.stringify(outbox));
      }
      if (req.url.startsWith("/graph/")) {
        if (!auth.startsWith("Bearer ")) return (res.statusCode = 401), res.end(JSON.stringify({ error: { message: "Missing token" } }));
        const lookup = /^\/graph\/v21\.0\/(\d+)\?fields=/.exec(req.url);
        if (lookup) {
          if (lookup[1] === "999999") return (res.statusCode = 400), res.end(JSON.stringify({ error: { message: "Unsupported get request" } }));
          return res.end(JSON.stringify({ id: lookup[1], display_phone_number: "+34 910 000 000", verified_name: "Negocio de prueba" }));
        }
        const send = /^\/graph\/v21\.0\/(\d+)\/messages$/.exec(req.url);
        if (send && req.method === "POST") {
          const id = `wamid.test.${outbox.length + 1}`;
          outbox.push({ kind: "whatsapp", phoneNumberId: send[1], to: json.to, text: json.text?.body, auth: auth.slice(7, 13) + "…", id });
          return res.end(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id }] }));
        }
      }
      if (req.url.startsWith("/stripe/v1/")) {
        if (auth !== "Bearer sk_test_e2e") return (res.statusCode = 401), res.end(JSON.stringify({ error: { message: "Invalid API Key" } }));
        const path = req.url.slice("/stripe/v1".length);
        if (path.startsWith("/prices/")) {
          const price = STRIPE_PRICES[path.slice(8)];
          return price ? res.end(JSON.stringify(price)) : ((res.statusCode = 404), res.end(JSON.stringify({ error: { message: "No such price" } })));
        }
        if (path === "/customers") return res.end(JSON.stringify({ id: `cus_e2e_${form.get("metadata[organization_id]").slice(0, 8)}` }));
        if (path === "/checkout/sessions") {
          const id = `cs_e2e_${stripeSessions.size + 1}`;
          stripeSessions.set(id, Object.fromEntries(form));
          return res.end(JSON.stringify({ id, url: `http://127.0.0.1:${process.env.PORT ?? 4010}/stripe/checkout/${id}` }));
        }
        if (path === "/billing_portal/sessions") return res.end(JSON.stringify({ id: "bps_e2e", url: `http://127.0.0.1:${process.env.PORT ?? 4010}/stripe/portal?return=${encodeURIComponent(form.get("return_url"))}` }));
      }
      if (req.url.startsWith("/stripe/checkout/")) {
        // "Payment" succeeds: Stripe would now send these signed events.
        const cs = stripeSessions.get(req.url.split("/").pop());
        if (!cs) return (res.statusCode = 404), res.end("{}");
        const now = Math.floor(Date.now() / 1000);
        const sub = { id: `sub_${cs.customer}`, object: "subscription", customer: cs.customer, status: "active", cancel_at_period_end: false, metadata: { organization_id: cs.client_reference_id }, items: { data: [{ price: { id: cs["line_items[0][price]"] }, current_period_start: now, current_period_end: now + 30 * 86400 }] } };
        (async () => {
          await stripeWebhook({ id: `evt_${cs.customer}_1`, type: "checkout.session.completed", created: now, data: { object: { id: "cs", customer: cs.customer, client_reference_id: cs.client_reference_id } } });
          await stripeWebhook({ id: `evt_${cs.customer}_2`, type: "customer.subscription.created", created: now, data: { object: sub } });
          await stripeWebhook({ id: `evt_${cs.customer}_3`, type: "invoice.paid", created: now, data: { object: { id: `in_${cs.customer}`, customer: cs.customer, subscription: sub.id, number: "E2E-0001", status: "paid", currency: "eur", amount_due: 4900, amount_paid: 4900, hosted_invoice_url: "https://invoice.stripe.test/e2e", status_transitions: { paid_at: now } } } });
          res.statusCode = 303;
          res.setHeader("location", cs.success_url);
          res.end();
        })();
        return;
      }
      if (req.url.startsWith("/stripe/portal")) {
        const back = new URL(req.url, "http://x").searchParams.get("return");
        res.setHeader("content-type", "text/html; charset=utf-8");
        return res.end(`<!doctype html><title>Stripe portal (TEST DOUBLE)</title><h1>Portal de facturación de pruebas</h1><a href="${back}">Volver</a>`);
      }
      if (req.url.startsWith("/google/auth")) {
        // Simulates a user granting consent on Google's screen.
        const q = new URL(req.url, "http://x").searchParams;
        const back = new URL(q.get("redirect_uri"));
        back.searchParams.set("code", "e2e-google-code");
        back.searchParams.set("state", q.get("state") ?? "");
        res.statusCode = 302;
        res.setHeader("location", back.toString());
        return res.end();
      }
      if (req.url === "/google/token" && form) {
        if (form.get("client_secret") !== "e2e-google-secret") return (res.statusCode = 401), res.end(JSON.stringify({ error: "invalid_client" }));
        if (form.get("grant_type") === "authorization_code") {
          if (form.get("code") !== "e2e-google-code") return (res.statusCode = 400), res.end(JSON.stringify({ error: "invalid_grant" }));
          const idToken = ["e30", Buffer.from(JSON.stringify({ email: "agenda@negocio.test" })).toString("base64url"), "sig"].join(".");
          return res.end(JSON.stringify({ access_token: "ya29.e2e", refresh_token: "1//e2e-refresh", expires_in: 3599, scope: "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy", id_token: idToken }));
        }
        if (form.get("grant_type") === "refresh_token" && form.get("refresh_token") === "1//e2e-refresh") return res.end(JSON.stringify({ access_token: "ya29.e2e-refreshed", expires_in: 3599 }));
        return (res.statusCode = 400), res.end(JSON.stringify({ error: "invalid_grant" }));
      }
      if (req.url === "/google/revoke") {
        outbox.push({ kind: "google_revoke", token: form?.get("token")?.slice(0, 6) });
        return res.end("{}");
      }
      if (req.url.startsWith("/google/calendar/v3/")) {
        if (!auth.startsWith("Bearer ya29.")) return (res.statusCode = 401), res.end(JSON.stringify({ error: { message: "Invalid Credentials" } }));
        if (req.url === "/google/calendar/v3/freeBusy") return res.end(JSON.stringify({ calendars: { primary: { busy: [] } } }));
        if (req.url.startsWith("/google/calendar/v3/calendars/primary/events")) {
          const id = `evt_e2e_${outbox.length + 1}`;
          outbox.push({ kind: "calendar", summary: json.summary, start: json.start?.dateTime, timeZone: json.start?.timeZone, description: json.description, sendUpdates: new URL(req.url, "http://x").searchParams.get("sendUpdates"), id });
          return res.end(JSON.stringify({ id, htmlLink: "https://calendar.google.com/event?eid=e2e" }));
        }
      }
      if (req.url === "/resend/emails" && req.method === "POST") {
        if (!auth.startsWith("Bearer ")) return (res.statusCode = 401), res.end(JSON.stringify({ message: "Missing API key" }));
        const id = `re_test_${outbox.length + 1}`;
        outbox.push({ kind: "email", from: json.from, to: json.to?.[0], subject: json.subject, text: json.text, inReplyTo: json.headers?.["In-Reply-To"] ?? null, id });
        return res.end(JSON.stringify({ id }));
      }
      if (req.url.endsWith("/embeddings")) {
        const input = Array.isArray(json.input) ? json.input : [json.input];
        return res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: embed(t) })), usage: { prompt_tokens: input.join(" ").length / 4 } }));
      }
      if (req.url.endsWith("/chat/completions")) {
        // OCR: a user message with file/image parts gets a deterministic transcription.
        const multimodal = (json.messages ?? []).find((m) => Array.isArray(m.content) && m.content.some((c) => c.type === "file" || c.type === "image_url"));
        if (multimodal) {
          const text = "Carta del restaurante (transcrito por el doble de pruebas)\nMenú del día: 14 euros, de lunes a viernes.\nTerraza abierta de 13 a 16h.";
          return res.end(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 40 } }));
        }
        const toolNames = (json.tools ?? []).map((t) => t.function?.name);
        const msgs = json.messages ?? [];
        const last = msgs[msgs.length - 1];
        const reply = (message, finish = "stop") => res.end(JSON.stringify({ choices: [{ message, finish_reason: finish }], usage: { prompt_tokens: 150, completion_tokens: 25 } }));
        const callTool = (name, args) => reply({ role: "assistant", content: null, tool_calls: [{ id: `call_${msgs.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, "tool_calls");
        const userText = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
        if (toolNames.includes("calendar_find_slots") && /\bcita\b/i.test(userText)) {
          if (last?.role === "user") return callTool("calendar_find_slots", { days: 7 });
          if (last?.role === "tool") {
            const raw = String(last.content);
            const result = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); // tool output arrives wrapped in <untrusted>
            if (result.slots?.length && /res[eé]rv/i.test(userText)) {
              const name = /soy (\p{L}+)/u.exec(userText)?.[1] ?? "Cliente";
              return callTool("calendar_create_appointment", { start: result.slots[0].start, customer_name: name, service: "Revisión", contact: "600 000 000" });
            }
            if (result.eventId) return reply({ role: "assistant", content: `Cita reservada: ${result.label}.` });
            if (result.slots) return reply({ role: "assistant", content: `Huecos libres: ${result.slots.slice(0, 3).map((x) => x.label).join("; ")}.` });
            return reply({ role: "assistant", content: `No he podido reservar: ${result.error ?? "sin respuesta"}` });
          }
        }
        const system = msgs.find((m) => m.role === "system")?.content ?? "";
        const question = [...(json.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";
        const words = (t) => new Set(t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").split(/\W+/).filter((w) => w.length > 3));
        const candidate = /<untrusted source="kb:[^"]+">\n([\s\S]*?)\n<\/untrusted>/.exec(system)?.[1]?.trim();
        // Only "knows" the answer when the excerpt shares terms with the question.
        const excerpt = candidate && [...words(question)].some((w) => words(candidate).has(w)) ? candidate : undefined;
        const text = excerpt ? `Según la documentación: ${excerpt.slice(0, 300)} [1]` : "No encuentro esa información en la documentación.";
        // Honour structured output requests (e.g. the Customer Support template schema).
        // Fields are filled from the requested schema (support: answer/category; sales: reply/score/stage).
        const props = json.response_format?.json_schema?.schema?.properties ?? {};
        const buying = /presupuesto|contratar|comprar|precio/i.test(question);
        const content = json.response_format?.type === "json_schema"
          ? JSON.stringify({
              ...("answer" in props ? { answer: text, category: "informacion" } : {}),
              ...("reply" in props ? { reply: text, score: buying ? 80 : 30, stage: buying ? "cualificado" : "cualificando", need: buying ? question.slice(0, 120) : null } : {}),
              confidence: excerpt || buying ? 0.9 : 0.2,
              needs_human: !(excerpt || buying),
              ...(excerpt || buying ? {} : { reason: "La documentación no cubre esta consulta" }),
            })
          : text;
        return res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 30 } }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
  })
  .listen(Number(process.env.PORT ?? 4010), "127.0.0.1", () => console.log("fake-providers (TEST DOUBLE) on :" + (process.env.PORT ?? 4010)));
