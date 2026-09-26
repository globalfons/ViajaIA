import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  LLMProvider,
} from "../types";
import { postJson, type FetchLike } from "./http";

/** Google Gemini API (generativelanguage.googleapis.com, v1beta). */
export interface GeminiOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

type Part =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

interface GeminiResponse {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/** Gemini's schema dialect rejects some JSON-Schema keywords. */
function cleanSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "$schema" || k === "additionalProperties" || k === "$id") continue;
    out[k] = cleanSchema(v);
  }
  return out;
}

function toContents(messages: ChatMessage[]) {
  const system: string[] = [];
  const contents: { role: "user" | "model"; parts: Part[] }[] = [];
  const push = (role: "user" | "model", parts: Part[]) => {
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  };
  for (const m of messages) {
    if (m.role === "system") system.push(m.content);
    else if (m.role === "user") push("user", [...(m.attachments ?? []).map((a): Part => ({ inline_data: { mime_type: a.mimeType, data: a.data } })), { text: m.content }]);
    else if (m.role === "assistant") {
      const parts: Part[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.arguments } });
      if (parts.length) push("model", parts);
    } else {
      push("user", [{ functionResponse: { name: m.name, response: { content: m.content } } }]);
    }
  }
  return { system: system.join("\n\n"), contents };
}

export class GeminiProvider implements LLMProvider {
  readonly id = "gemini" as const;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(private readonly opts: GeminiOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const { system, contents } = toContents(req.messages);
    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.maxTokens !== undefined) generationConfig.maxOutputTokens = req.maxTokens;
    if (req.responseFormat) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = cleanSchema(req.responseFormat.schema);
    }
    const body: Record<string, unknown> = { contents, generationConfig };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (req.tools?.length) {
      body.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: cleanSchema(t.parameters),
          })),
        },
      ];
    }

    const data = await postJson<GeminiResponse>(
      "gemini",
      this.fetchImpl,
      `${this.baseUrl}/models/${encodeURIComponent(req.model)}:generateContent`,
      { "x-goog-api-key": this.opts.apiKey },
      body,
      signal,
    );

    const cand = data.candidates?.[0];
    let content = "";
    const toolCalls: ChatResponse["toolCalls"] = [];
    (cand?.content?.parts ?? []).forEach((p, i) => {
      if ("text" in p) content += p.text;
      else if ("functionCall" in p)
        toolCalls.push({ id: `call_${i}_${p.functionCall.name}`, name: p.functionCall.name, arguments: p.functionCall.args ?? {} });
    });
    const fr = cand?.finishReason;
    return {
      content,
      toolCalls,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      finishReason:
        toolCalls.length > 0
          ? "tool_calls"
          : fr === "STOP"
            ? "stop"
            : fr === "MAX_TOKENS"
              ? "length"
              : fr === "SAFETY"
                ? "content_filter"
                : "other",
      provider: "gemini",
      model: req.model,
    };
  }

  async embed(req: EmbeddingRequest, signal?: AbortSignal): Promise<EmbeddingResponse> {
    const model = req.model.startsWith("models/") ? req.model : `models/${req.model}`;
    const data = await postJson<{ embeddings: { values: number[] }[] }>(
      "gemini",
      this.fetchImpl,
      `${this.baseUrl}/${model}:batchEmbedContents`,
      { "x-goog-api-key": this.opts.apiKey },
      {
        requests: req.input.map((text) => ({
          model,
          content: { parts: [{ text }] },
          ...(req.dimensions ? { outputDimensionality: req.dimensions } : {}),
        })),
      },
      signal,
    );
    return {
      vectors: data.embeddings.map((e) => e.values),
      // The batch embedding endpoint does not report token usage.
      usage: { inputTokens: 0, outputTokens: 0 },
      provider: "gemini",
      model: req.model,
    };
  }
}
