// TEST DOUBLE — NOT AN AI and NOT a real Meta/Resend service. Speaks the
// providers' HTTP formats so E2E tests run the real code paths without API keys
// or network access.
//  - /v1/embeddings: deterministic bag-of-words hashing vectors (1536 dims)
//  - /v1/chat/completions: echoes the first knowledge excerpt it was given,
//    which proves retrieval → context → LLM wiring end to end.
//  - /graph/v21.0/*: WhatsApp Cloud API (number lookup, send message)
//  - /resend/emails: Resend send API
//  - /google/*: OAuth consent (auto-approves), token, revoke, Calendar freeBusy/events
//  - /_outbox: messages "sent" through the doubles (GET to read, DELETE to clear)
import http from "node:http";

const DIMS = 1536;
const outbox = [];
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
