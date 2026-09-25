import { describe, expect, it } from "vitest";
import { AnthropicProvider, toAnthropicMessages } from "../src/llm/providers/anthropic";
import { GeminiProvider } from "../src/llm/providers/gemini";
import { OpenAICompatibleProvider } from "../src/llm/providers/openai-compatible";
import { LLMError, type ChatMessage } from "../src/llm/types";
import { mockFetch } from "../src/testing/fake-llm";

const convo: ChatMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "hola" },
  { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "lookup", arguments: { q: "x" } }] },
  { role: "tool", toolCallId: "c1", name: "lookup", content: "result" },
];
const tools = [{ name: "lookup", description: "d", parameters: { type: "object", properties: { q: { type: "string" } } } }];

describe("OpenAI-compatible provider", () => {
  it("maps messages, tools and usage (wire format)", async () => {
    const f = mockFetch(() => ({
      body: {
        choices: [{ message: { content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "lookup", arguments: '{"q":"y"}' } }] }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      },
    }));
    const p = new OpenAICompatibleProvider({ id: "xai", apiKey: "k", baseUrl: "https://api.x.ai/v1", fetchImpl: f });
    const res = await p.chat({ model: "m", messages: convo, tools, temperature: 0.2 });
    expect(f.calls[0]!.url).toBe("https://api.x.ai/v1/chat/completions");
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer k");
    const body = f.calls[0]!.json;
    expect(body.messages[2].tool_calls[0].function).toEqual({ name: "lookup", arguments: '{"q":"x"}' });
    expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "result" });
    expect(body.tools[0].function.name).toBe("lookup");
    expect(res).toMatchObject({ finishReason: "tool_calls", usage: { inputTokens: 11, outputTokens: 7 }, provider: "xai" });
    expect(res.toolCalls[0]).toEqual({ id: "c2", name: "lookup", arguments: { q: "y" } });
  });

  it("classifies 429/5xx as retryable and 400 as not", async () => {
    const mk = (status: number) =>
      new OpenAICompatibleProvider({ id: "openai", apiKey: "k", baseUrl: "https://x", fetchImpl: mockFetch(() => ({ status, body: { error: "e" } })) });
    await expect(mk(429).chat({ model: "m", messages: convo })).rejects.toMatchObject({ retryable: true, status: 429 });
    await expect(mk(503).chat({ model: "m", messages: convo })).rejects.toMatchObject({ retryable: true });
    await expect(mk(400).chat({ model: "m", messages: convo })).rejects.toMatchObject({ retryable: false });
  });

  it("never leaks the API key in errors", async () => {
    const p = new OpenAICompatibleProvider({ id: "openai", apiKey: "sk-super-secret-key-123456", baseUrl: "https://x", fetchImpl: mockFetch(() => ({ status: 401, body: "unauthorized" })) });
    const err = (await p.chat({ model: "m", messages: convo }).catch((e) => e)) as LLMError;
    expect(err.message).not.toContain("sk-super-secret");
  });

  it("sorts embeddings by index", async () => {
    const f = mockFetch(() => ({ body: { data: [{ embedding: [2], index: 1 }, { embedding: [1], index: 0 }], usage: { prompt_tokens: 3 } } }));
    const p = new OpenAICompatibleProvider({ id: "openai", apiKey: "k", baseUrl: "https://x", fetchImpl: f });
    expect((await p.embed({ model: "e", input: ["a", "b"] })).vectors).toEqual([[1], [2]]);
  });
});

describe("Anthropic provider", () => {
  it("merges system prompts, maps tool_use/tool_result and usage", async () => {
    const f = mockFetch(() => ({
      body: { content: [{ type: "text", text: "Hola" }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 3 } },
    }));
    const p = new AnthropicProvider({ apiKey: "ak", fetchImpl: f });
    const res = await p.chat({ model: "claude-sonnet-5", messages: convo, tools });
    const { json, init } = f.calls[0]!;
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("ak");
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
    expect(json.system).toBe("sys");
    expect(json.messages[1].content[0]).toEqual({ type: "tool_use", id: "c1", name: "lookup", input: { q: "x" } });
    expect(json.messages[2].content[0]).toEqual({ type: "tool_result", tool_use_id: "c1", content: "result" });
    expect(json.tools[0].input_schema).toBeDefined();
    expect(res).toMatchObject({ content: "Hola", finishReason: "stop", usage: { inputTokens: 5, outputTokens: 3 } });
  });

  it("implements structured output with a forced tool", async () => {
    const f = mockFetch(() => ({
      body: { content: [{ type: "tool_use", id: "t", name: "respond_out", input: { answer: "ok", confidence: 0.9 } }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } },
    }));
    const p = new AnthropicProvider({ apiKey: "ak", fetchImpl: f });
    const res = await p.chat({ model: "m", messages: [{ role: "user", content: "x" }], responseFormat: { type: "json_schema", name: "out", schema: { type: "object" } } });
    expect(f.calls[0]!.json.tool_choice).toEqual({ type: "tool", name: "respond_out" });
    expect(JSON.parse(res.content)).toEqual({ answer: "ok", confidence: 0.9 });
    expect(res.toolCalls).toEqual([]);
  });

  it("merges consecutive same-role turns (API requires alternation)", () => {
    const { messages } = toAnthropicMessages([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toHaveLength(2);
  });
});

describe("Gemini provider", () => {
  it("maps contents, function calls and usage", async () => {
    const f = mockFetch(() => ({
      body: {
        candidates: [{ content: { parts: [{ functionCall: { name: "lookup", args: { q: "z" } } }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 },
      },
    }));
    const p = new GeminiProvider({ apiKey: "gk", fetchImpl: f });
    const res = await p.chat({ model: "gemini-model", messages: convo, tools });
    const { url, json, init } = f.calls[0]!;
    expect(url).toContain("/models/gemini-model:generateContent");
    expect(url).not.toContain("gk"); // key goes in a header, not the URL (URLs end up in logs)
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("gk");
    expect(json.systemInstruction.parts[0].text).toBe("sys");
    expect(json.contents[1]).toEqual({ role: "model", parts: [{ functionCall: { name: "lookup", args: { q: "x" } } }] });
    expect(json.contents[2].parts[0].functionResponse.name).toBe("lookup");
    expect(res.toolCalls[0]).toMatchObject({ name: "lookup", arguments: { q: "z" } });
    expect(res.usage).toEqual({ inputTokens: 9, outputTokens: 4 });
  });
});
