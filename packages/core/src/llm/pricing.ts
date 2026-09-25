import type { ProviderId, TokenUsage } from "./types";

/**
 * Model prices are data, not code: they change often and differ per contract.
 * They are loaded from the `model_pricing` table (managed by the platform admin)
 * instead of being hardcoded. Unknown models are reported as "unpriced" so
 * dashboards can flag them rather than silently showing 0 €.
 */
export interface ModelPrice {
  provider: ProviderId;
  model: string;
  /** USD per 1M input tokens. */
  inputPerMTok: number;
  /** USD per 1M output tokens. */
  outputPerMTok: number;
}

export interface CostEstimate {
  costUsd: number;
  priced: boolean;
}

export class PricingCatalog {
  private readonly prices = new Map<string, ModelPrice>();

  constructor(prices: ModelPrice[] = []) {
    for (const p of prices) this.set(p);
  }

  set(price: ModelPrice): void {
    this.prices.set(`${price.provider}:${price.model}`, price);
  }

  get(provider: ProviderId, model: string): ModelPrice | undefined {
    const exact = this.prices.get(`${provider}:${model}`);
    if (exact) return exact;
    // Allow prefix entries such as "openai:gpt-x*" for dated snapshots.
    for (const [key, price] of this.prices) {
      if (key.endsWith("*") && `${provider}:${model}`.startsWith(key.slice(0, -1))) return price;
    }
    return undefined;
  }

  estimate(provider: ProviderId, model: string, usage: TokenUsage): CostEstimate {
    const price = this.get(provider, model);
    if (!price) return { costUsd: 0, priced: false };
    const cost = (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000;
    return { costUsd: Math.round(cost * 1e8) / 1e8, priced: true };
  }
}
