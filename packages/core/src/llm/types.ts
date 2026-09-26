/**
 * Provider-agnostic LLM contracts. Agents and workflows only ever talk to
 * these types; concrete provider wire formats live in ./providers.
 */

export type ProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "xai"
  | "deepseek"
  | "openrouter";

export const PROVIDER_IDS: readonly ProviderId[] = [
  "openai",
  "anthropic",
  "gemini",
  "xai",
  "deepseek",
  "openrouter",
];

/** A model reference in the form "provider:model", e.g. "anthropic:claude-sonnet-5". */
export type ModelRef = `${ProviderId}:${string}`;

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed JSON arguments produced by the model. */
  arguments: Record<string, unknown>;
}

/** Binary input (image or PDF) for vision-capable models, base64-encoded. */
export interface Attachment {
  mimeType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  data: string;
  filename?: string;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string; attachments?: Attachment[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema describing the tool arguments. */
  parameters: Record<string, unknown>;
}

export interface JsonSchemaFormat {
  type: "json_schema";
  name: string;
  schema: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSpec[];
  responseFormat?: JsonSchemaFormat;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  finishReason: "stop" | "tool_calls" | "length" | "content_filter" | "other";
  provider: ProviderId;
  model: string;
}

export interface EmbeddingRequest {
  model: string;
  input: string[];
  dimensions?: number;
}

export interface EmbeddingResponse {
  vectors: number[][];
  usage: TokenUsage;
  provider: ProviderId;
  model: string;
}

export interface LLMProvider {
  readonly id: ProviderId;
  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
  embed?(req: EmbeddingRequest, signal?: AbortSignal): Promise<EmbeddingResponse>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderId,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export function parseModelRef(ref: string): { provider: ProviderId; model: string } {
  const idx = ref.indexOf(":");
  if (idx <= 0) throw new Error(`Invalid model reference "${ref}". Expected "provider:model".`);
  const provider = ref.slice(0, idx) as ProviderId;
  const model = ref.slice(idx + 1);
  if (!PROVIDER_IDS.includes(provider)) throw new Error(`Unknown LLM provider "${provider}".`);
  if (!model) throw new Error(`Missing model name in "${ref}".`);
  return { provider, model };
}
