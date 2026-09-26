import { PricingCatalog } from "./pricing";
import { AnthropicProvider } from "./providers/anthropic";
import { GeminiProvider } from "./providers/gemini";
import { DEFAULT_BASE_URLS, OpenAICompatibleProvider } from "./providers/openai-compatible";
import {
  LLMError,
  parseModelRef,
  type ChatRequest,
  type ChatResponse,
  type EmbeddingResponse,
  type LLMProvider,
  type ModelRef,
  type ProviderId,
} from "./types";

/** Who is spending: every LLM call is attributed to a tenant. */
export interface UsageContext {
  organizationId: string;
  agentId?: string;
  workflowId?: string;
  workflowRunId?: string;
  conversationId?: string;
  purpose?: "chat" | "embedding" | "rerank" | "classification" | "workflow" | "test" | "ocr";
}

export interface UsageRecord extends UsageContext {
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  priced: boolean;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  fallbackFrom?: string;
}

export interface RoutedChatRequest extends Omit<ChatRequest, "model"> {
  model: ModelRef | string;
  fallbackModels?: (ModelRef | string)[];
  timeoutMs?: number;
}

export interface RoutedChatResponse extends ChatResponse {
  costUsd: number;
  priced: boolean;
  latencyMs: number;
  modelRef: string;
  attempts: number;
}

export interface LLMRouterOptions {
  providers: Partial<Record<ProviderId, LLMProvider>>;
  pricing?: PricingCatalog;
  /** Persist usage (usage_events). Errors here never break the call. */
  onUsage?: (record: UsageRecord) => void | Promise<void>;
  /** Budget / rate-limit gate. Throw to block the call. */
  beforeCall?: (ctx: UsageContext, modelRef: string) => void | Promise<void>;
  defaultTimeoutMs?: number;
  /** Retries per model before moving to the next fallback. */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The LLM Router decouples agents from providers: agents reference models as
 * "provider:model" strings, and the router handles credentials, retries,
 * timeouts, fallbacks, cost estimation and usage accounting.
 */
export class LLMRouter {
  private readonly pricing: PricingCatalog;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: LLMRouterOptions) {
    this.pricing = opts.pricing ?? new PricingCatalog();
    this.sleep = opts.sleep ?? defaultSleep;
  }

  availableProviders(): ProviderId[] {
    return Object.keys(this.opts.providers) as ProviderId[];
  }

  private provider(id: ProviderId): LLMProvider {
    const p = this.opts.providers[id];
    if (!p) throw new LLMError(`Provider "${id}" is not configured (missing API key?)`, id, undefined, true);
    return p;
  }

  private async record(rec: UsageRecord) {
    try {
      await this.opts.onUsage?.(rec);
    } catch {
      /* usage persistence must never break the user-facing call */
    }
  }

  async chat(req: RoutedChatRequest, ctx: UsageContext): Promise<RoutedChatResponse> {
    const chain = [req.model, ...(req.fallbackModels ?? [])].filter((m, i, a) => m && a.indexOf(m) === i);
    const maxRetries = this.opts.maxRetries ?? 2;
    let lastError: unknown;
    let attempts = 0;

    for (const [chainIdx, ref] of chain.entries()) {
      const { provider: providerId, model } = parseModelRef(ref);
      await this.opts.beforeCall?.(ctx, ref);

      for (let retry = 0; retry <= maxRetries; retry++) {
        attempts++;
        const started = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? this.opts.defaultTimeoutMs ?? 60_000);
        try {
          const provider = this.provider(providerId);
          const res = await provider.chat(
            {
              model,
              messages: req.messages,
              temperature: req.temperature,
              maxTokens: req.maxTokens,
              tools: req.tools,
              responseFormat: req.responseFormat,
            },
            controller.signal,
          );
          const latencyMs = Date.now() - started;
          const cost = this.pricing.estimate(providerId, model, res.usage);
          await this.record({
            ...ctx,
            provider: providerId,
            model,
            inputTokens: res.usage.inputTokens,
            outputTokens: res.usage.outputTokens,
            costUsd: cost.costUsd,
            priced: cost.priced,
            latencyMs,
            success: true,
            fallbackFrom: chainIdx > 0 ? chain[0] : undefined,
          });
          return { ...res, costUsd: cost.costUsd, priced: cost.priced, latencyMs, modelRef: ref, attempts };
        } catch (err) {
          lastError = err;
          const llmErr = err instanceof LLMError ? err : undefined;
          await this.record({
            ...ctx,
            provider: providerId,
            model,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            priced: true,
            latencyMs: Date.now() - started,
            success: false,
            errorCode: llmErr?.status ? `http_${llmErr.status}` : controller.signal.aborted ? "timeout" : "error",
          });
          const retryable = llmErr ? llmErr.retryable : controller.signal.aborted;
          if (!retryable) break; // e.g. 400/401: move to fallback model immediately
          if (retry < maxRetries) await this.sleep(Math.min(250 * 2 ** retry, 4000));
        } finally {
          clearTimeout(timer);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("LLM call failed");
  }

  async embed(
    ref: ModelRef | string,
    input: string[],
    ctx: UsageContext,
    opts: { dimensions?: number; batchSize?: number } = {},
  ): Promise<EmbeddingResponse> {
    const { provider: providerId, model } = parseModelRef(ref);
    const provider = this.provider(providerId);
    if (!provider.embed) throw new LLMError(`Provider "${providerId}" does not support embeddings`, providerId);
    await this.opts.beforeCall?.(ctx, ref);

    const batchSize = opts.batchSize ?? 64;
    const vectors: number[][] = [];
    let inputTokens = 0;
    const started = Date.now();
    for (let i = 0; i < input.length; i += batchSize) {
      const res = await provider.embed({ model, input: input.slice(i, i + batchSize), dimensions: opts.dimensions });
      vectors.push(...res.vectors);
      inputTokens += res.usage.inputTokens;
    }
    const usage = { inputTokens, outputTokens: 0 };
    const cost = this.pricing.estimate(providerId, model, usage);
    await this.record({
      ...ctx,
      purpose: ctx.purpose ?? "embedding",
      provider: providerId,
      model,
      ...usage,
      costUsd: cost.costUsd,
      priced: cost.priced,
      latencyMs: Date.now() - started,
      success: true,
    });
    return { vectors, usage, provider: providerId, model };
  }
}

/** Builds providers from environment variables. Missing keys simply disable a provider. */
export function providersFromEnv(env: Record<string, string | undefined> = process.env) {
  const providers: Partial<Record<ProviderId, LLMProvider>> = {};
  const compat: [ProviderId, string][] = [
    ["openai", "OPENAI_API_KEY"],
    ["xai", "XAI_API_KEY"],
    ["deepseek", "DEEPSEEK_API_KEY"],
    ["openrouter", "OPENROUTER_API_KEY"],
  ];
  for (const [id, keyVar] of compat) {
    const apiKey = env[keyVar];
    if (!apiKey) continue;
    providers[id] = new OpenAICompatibleProvider({
      id,
      apiKey,
      baseUrl: env[`${id.toUpperCase()}_BASE_URL`] ?? DEFAULT_BASE_URLS[id]!,
      extraHeaders:
        id === "openrouter" && env.APP_URL ? { "HTTP-Referer": env.APP_URL, "X-Title": "DigitalizaTusNegocios AI OS" } : undefined,
    });
  }
  if (env.ANTHROPIC_API_KEY) providers.anthropic = new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY });
  if (env.GEMINI_API_KEY) providers.gemini = new GeminiProvider({ apiKey: env.GEMINI_API_KEY });
  return providers;
}
