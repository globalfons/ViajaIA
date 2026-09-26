// TEST DOUBLE — NOT AN AI. Speaks the OpenAI HTTP format so E2E tests can run
// the real LLM Router / RAG pipeline without API keys or network access.
//  - /v1/embeddings: deterministic bag-of-words hashing vectors (1536 dims)
//  - /v1/chat/completions: echoes the first knowledge excerpt it was given,
//    which proves retrieval → context → LLM wiring end to end.
import http from "node:http";

const DIMS = 1536;
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
      const json = body ? JSON.parse(body) : {};
      res.setHeader("content-type", "application/json");
      if (req.url.endsWith("/embeddings")) {
        const input = Array.isArray(json.input) ? json.input : [json.input];
        return res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: embed(t) })), usage: { prompt_tokens: input.join(" ").length / 4 } }));
      }
      if (req.url.endsWith("/chat/completions")) {
        const system = json.messages?.find((m) => m.role === "system")?.content ?? "";
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
  .listen(Number(process.env.PORT ?? 4010), "127.0.0.1", () => console.log("fake-openai (TEST DOUBLE) on :" + (process.env.PORT ?? 4010)));
