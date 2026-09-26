import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  LLMProvider,
  ProviderId,
} from "../types";
import { postJson, safeParseArgs, type FetchLike } from "./http";

/**
 * Chat Completions wire format. Shared by OpenAI, xAI, DeepSeek and OpenRouter,
 * which all expose an OpenAI-compatible endpoint.
 */
export interface OpenAICompatibleOptions {
  id: ProviderId;
  apiKey: string;
  baseUrl: string;
  extraHeaders?: Record<string, string>;
  fetchImpl?: FetchLike;
  /** Some compatible providers do not support json_schema response formats. */
  supportsJsonSchema?: boolean;
}

export const DEFAULT_BASE_URLS: Partial<Record<ProviderId, string>> = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
  deepseek: "https://api.deepseek.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

interface OAChoice {
  message: {
    content: string | null;
    tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  };
  finish_reason: string | null;
}

interface OAChatResponse {
  choices: OAChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function toWire(messages: ChatMessage[]) {
  return messages.map((m) => {
    switch (m.role) {
      case "system":
        return { role: m.role, content: m.content };
      case "user":
        if (!m.attachments?.length) return { role: m.role, content: m.content };
        // OpenAI chat format: images as image_url data URLs, PDFs as file parts.
        return {
          role: m.role,
          content: [
            ...m.attachments.map((a) =>
              a.mimeType === "application/pdf"
                ? { type: "file", file: { filename: a.filename ?? "document.pdf", file_data: `data:${a.mimeType};base64,${a.data}` } }
                : { type: "image_url", image_url: { url: `data:${a.mimeType};base64,${a.data}` } },
            ),
            { type: "text", text: m.content },
          ],
        };
      case "assistant":
        return {
          role: "assistant",
          content: m.content || null,
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  id: c.id,
                  type: "function",
                  function: { name: c.name, arguments: JSON.stringify(c.arguments) },
                })),
              }
            : {}),
        };
      case "tool":
        return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    }
  });
}

function mapFinish(reason: string | null): ChatResponse["finishReason"] {
  switch (reason) {
    case "stop":
      return "stop";
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    default:
      return "other";
  }
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: ProviderId;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: OpenAICompatibleOptions) {
    this.id = opts.id;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers() {
    return { authorization: `Bearer ${this.opts.apiKey}`, ...(this.opts.extraHeaders ?? {}) };
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toWire(req.messages),
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (req.responseFormat) {
      body.response_format =
        this.opts.supportsJsonSchema === false
          ? { type: "json_object" }
          : {
              type: "json_schema",
              json_schema: { name: req.responseFormat.name, schema: req.responseFormat.schema, strict: false },
            };
    }

    const data = await postJson<OAChatResponse>(
      this.id,
      this.fetchImpl,
      `${this.opts.baseUrl}/chat/completions`,
      this.headers(),
      body,
      signal,
    );
    const choice = data.choices[0];
    return {
      content: choice?.message.content ?? "",
      toolCalls: (choice?.message.tool_calls ?? []).map((c) => ({
        id: c.id,
        name: c.function.name,
        arguments: safeParseArgs(c.function.arguments),
      })),
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      finishReason: mapFinish(choice?.finish_reason ?? null),
      provider: this.id,
      model: req.model,
    };
  }

  async embed(req: EmbeddingRequest, signal?: AbortSignal): Promise<EmbeddingResponse> {
    const data = await postJson<{
      data: { embedding: number[]; index: number }[];
      usage?: { prompt_tokens?: number };
    }>(
      this.id,
      this.fetchImpl,
      `${this.opts.baseUrl}/embeddings`,
      this.headers(),
      { model: req.model, input: req.input, ...(req.dimensions ? { dimensions: req.dimensions } : {}) },
      signal,
    );
    const vectors = [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return {
      vectors,
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: 0 },
      provider: this.id,
      model: req.model,
    };
  }
}
