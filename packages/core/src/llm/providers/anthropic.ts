import type { ChatMessage, ChatRequest, ChatResponse, LLMProvider } from "../types";
import { postJson, type FetchLike } from "./http";

/** Anthropic Messages API (https://docs.anthropic.com/en/api/messages). */
export interface AnthropicOptions {
  apiKey: string;
  baseUrl?: string;
  apiVersion?: string;
  fetchImpl?: FetchLike;
  defaultMaxTokens?: number;
}

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicResponse {
  content: Block[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

/** Converts neutral messages to Anthropic's format, merging consecutive same-role turns. */
export function toAnthropicMessages(messages: ChatMessage[]) {
  const system: string[] = [];
  const out: { role: "user" | "assistant"; content: Block[] }[] = [];
  const push = (role: "user" | "assistant", blocks: Block[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    switch (m.role) {
      case "system":
        system.push(m.content);
        break;
      case "user":
        push("user", [{ type: "text", text: m.content }]);
        break;
      case "assistant": {
        const blocks: Block[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const c of m.toolCalls ?? []) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.arguments });
        if (blocks.length) push("assistant", blocks);
        break;
      }
      case "tool":
        push("user", [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }]);
        break;
    }
  }
  return { system: system.join("\n\n"), messages: out };
}

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic" as const;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: AnthropicOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const { system, messages } = toAnthropicMessages(req.messages);
    let systemPrompt = system;
    const tools = req.tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) ?? [];

    // Structured output: force a single "respond" tool whose input is the schema.
    let forcedTool: string | undefined;
    if (req.responseFormat) {
      forcedTool = `respond_${req.responseFormat.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      tools.push({
        name: forcedTool,
        description: "Return the final answer using this exact structure.",
        input_schema: req.responseFormat.schema,
      });
      if (!req.tools?.length) {
        systemPrompt += `\n\nAlways answer by calling the ${forcedTool} tool.`;
      }
    }

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? this.opts.defaultMaxTokens ?? 4096,
      messages,
    };
    if (systemPrompt.trim()) body.system = systemPrompt.trim();
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (tools.length) body.tools = tools;
    if (forcedTool && !req.tools?.length) body.tool_choice = { type: "tool", name: forcedTool };

    const data = await postJson<AnthropicResponse>(
      "anthropic",
      this.fetchImpl,
      `${this.opts.baseUrl ?? "https://api.anthropic.com"}/v1/messages`,
      { "x-api-key": this.opts.apiKey, "anthropic-version": this.opts.apiVersion ?? "2023-06-01" },
      body,
      signal,
    );

    let content = "";
    const toolCalls: ChatResponse["toolCalls"] = [];
    for (const block of data.content) {
      if (block.type === "text") content += block.text;
      else if (block.type === "tool_use") {
        if (forcedTool && block.name === forcedTool) content = JSON.stringify(block.input);
        else toolCalls.push({ id: block.id, name: block.name, arguments: block.input ?? {} });
      }
    }

    const finishReason: ChatResponse["finishReason"] =
      toolCalls.length > 0
        ? "tool_calls"
        : data.stop_reason === "max_tokens"
          ? "length"
          : data.stop_reason === "end_turn" || data.stop_reason === "tool_use" || data.stop_reason === "stop_sequence"
            ? "stop"
            : "other";

    return {
      content,
      toolCalls,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
      finishReason,
      provider: "anthropic",
      model: req.model,
    };
  }
}
