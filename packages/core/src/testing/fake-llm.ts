/** Test doubles. Never import from production code. */
import type { ChatRequest, ChatResponse, EmbeddingRequest, EmbeddingResponse, LLMProvider, ProviderId, ToolCall } from "../llm/types";

export type Script = Partial<ChatResponse> | ((req: ChatRequest) => Partial<ChatResponse>) | Error;

/**
 * Deterministic LLM provider for tests. Each chat() call consumes the next
 * scripted response; every request is recorded for assertions.
 */
export class FakeProvider implements LLMProvider {
  readonly requests: ChatRequest[] = [];
  constructor(
    readonly id: ProviderId = "openai",
    private readonly script: Script[] = [],
  ) {}

  push(...s: Script[]) {
    this.script.push(...s);
    return this;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(structuredClone(req));
    const next = this.script.shift();
    if (!next) throw new Error("FakeProvider: script exhausted");
    if (next instanceof Error) throw next;
    const r = typeof next === "function" ? next(req) : next;
    return {
      content: r.content ?? "",
      toolCalls: r.toolCalls ?? [],
      usage: r.usage ?? { inputTokens: 100, outputTokens: 20 },
      finishReason: r.finishReason ?? ((r.toolCalls?.length ?? 0) > 0 ? "tool_calls" : "stop"),
      provider: this.id,
      model: req.model,
    };
  }

  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    return {
      vectors: req.input.map((t) => fakeEmbedding(t, req.dimensions ?? 8)),
      usage: { inputTokens: req.input.join(" ").split(/\s+/).length, outputTokens: 0 },
      provider: this.id,
      model: req.model,
    };
  }
}

export const toolCall = (name: string, args: Record<string, unknown> = {}, id = `call_${name}`): ToolCall => ({ id, name, arguments: args });

/** Bag-of-words hashing embedding: similar texts get similar vectors. */
export function fakeEmbedding(text: string, dims = 8): number[] {
  const v = new Array(dims).fill(0);
  for (const w of text.toLowerCase().split(/\W+/).filter(Boolean)) {
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % dims] += 1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

/** fetch mock that records calls and replies from a handler. */
export function mockFetch(handler: (url: string, init: RequestInit & { json?: unknown }) => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: { url: string; init: RequestInit; json: any }[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const json = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, init, json });
    const r = handler(url, { ...init, json });
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    return new Response(body, { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;
  return Object.assign(fn, { calls });
}
