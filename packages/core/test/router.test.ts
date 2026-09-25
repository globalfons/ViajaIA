import { describe, expect, it, vi } from "vitest";
import { PricingCatalog } from "../src/llm/pricing";
import { LLMRouter, providersFromEnv, type UsageRecord } from "../src/llm/router";
import { LLMError } from "../src/llm/types";
import { FakeProvider } from "../src/testing/fake-llm";

const ctx = { organizationId: "org-1", agentId: "agent-1" };
const msg = [{ role: "user" as const, content: "hola" }];
const noSleep = async () => {};

describe("LLMRouter", () => {
  it("routes by provider prefix and records cost per tenant", async () => {
    const anthropic = new FakeProvider("anthropic", [{ content: "hi", usage: { inputTokens: 1_000_000, outputTokens: 500_000 } }]);
    const usage: UsageRecord[] = [];
    const router = new LLMRouter({
      providers: { anthropic },
      pricing: new PricingCatalog([{ provider: "anthropic", model: "claude-sonnet-5", inputPerMTok: 3, outputPerMTok: 15 }]),
      onUsage: (r) => void usage.push(r),
    });
    const res = await router.chat({ model: "anthropic:claude-sonnet-5", messages: msg }, ctx);
    expect(res.content).toBe("hi");
    expect(anthropic.requests[0]!.model).toBe("claude-sonnet-5");
    expect(res.costUsd).toBeCloseTo(3 + 7.5);
    expect(usage[0]).toMatchObject({ organizationId: "org-1", agentId: "agent-1", provider: "anthropic", success: true, priced: true });
  });

  it("marks unknown models as unpriced instead of inventing a price", async () => {
    const router = new LLMRouter({ providers: { openai: new FakeProvider("openai", [{ content: "x" }]) } });
    const res = await router.chat({ model: "openai:some-model", messages: msg }, ctx);
    expect(res).toMatchObject({ costUsd: 0, priced: false });
  });

  it("retries retryable errors, then falls back to the next model", async () => {
    const primary = new FakeProvider("openai", [
      new LLMError("overloaded", "openai", 529, true),
      new LLMError("overloaded", "openai", 529, true),
      new LLMError("overloaded", "openai", 529, true),
    ]);
    const backup = new FakeProvider("anthropic", [{ content: "from backup" }]);
    const usage: UsageRecord[] = [];
    const router = new LLMRouter({ providers: { openai: primary, anthropic: backup }, sleep: noSleep, onUsage: (r) => void usage.push(r) });
    const res = await router.chat({ model: "openai:a", fallbackModels: ["anthropic:b"], messages: msg }, ctx);
    expect(res).toMatchObject({ content: "from backup", modelRef: "anthropic:b", attempts: 4 });
    expect(usage.filter((u) => !u.success)).toHaveLength(3);
    expect(usage.at(-1)).toMatchObject({ success: true, fallbackFrom: "openai:a" });
  });

  it("does not retry non-retryable errors (goes straight to fallback)", async () => {
    const primary = new FakeProvider("openai", [new LLMError("bad request", "openai", 400, false)]);
    const backup = new FakeProvider("gemini", [{ content: "ok" }]);
    const router = new LLMRouter({ providers: { openai: primary, gemini: backup }, sleep: noSleep });
    const res = await router.chat({ model: "openai:a", fallbackModels: ["gemini:b"], messages: msg }, ctx);
    expect(res.attempts).toBe(2);
  });

  it("throws the last error when every model fails", async () => {
    const router = new LLMRouter({ providers: { openai: new FakeProvider("openai", [new LLMError("nope", "openai", 401)]) }, sleep: noSleep });
    await expect(router.chat({ model: "openai:a", messages: msg }, ctx)).rejects.toThrow(/nope/);
  });

  it("treats a missing provider as a fallback-able error", async () => {
    const router = new LLMRouter({ providers: { gemini: new FakeProvider("gemini", [{ content: "ok" }]) }, sleep: noSleep, maxRetries: 0 });
    const res = await router.chat({ model: "deepseek:x", fallbackModels: ["gemini:y"], messages: msg }, ctx);
    expect(res.modelRef).toBe("gemini:y");
  });

  it("lets the budget gate block a call before it reaches the provider", async () => {
    const p = new FakeProvider("openai", [{ content: "x" }]);
    const router = new LLMRouter({
      providers: { openai: p },
      beforeCall: () => {
        throw new Error("Monthly budget exceeded");
      },
    });
    await expect(router.chat({ model: "openai:a", messages: msg }, ctx)).rejects.toThrow(/budget/);
    expect(p.requests).toHaveLength(0);
  });

  it("times out slow providers", async () => {
    const slow = {
      id: "openai" as const,
      chat: (_req: unknown, signal?: AbortSignal) =>
        new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    };
    const router = new LLMRouter({ providers: { openai: slow }, maxRetries: 0 });
    await expect(router.chat({ model: "openai:a", messages: msg, timeoutMs: 20 }, ctx)).rejects.toThrow(/aborted/);
  });

  it("a failing usage sink never breaks the call", async () => {
    const router = new LLMRouter({
      providers: { openai: new FakeProvider("openai", [{ content: "ok" }]) },
      onUsage: () => {
        throw new Error("db down");
      },
    });
    await expect(router.chat({ model: "openai:a", messages: msg }, ctx)).resolves.toMatchObject({ content: "ok" });
  });

  it("embeds in batches and records embedding usage", async () => {
    const onUsage = vi.fn();
    const router = new LLMRouter({ providers: { openai: new FakeProvider("openai") }, onUsage });
    const res = await router.embed("openai:emb", ["a b", "c", "d"], ctx, { batchSize: 2, dimensions: 4 });
    expect(res.vectors).toHaveLength(3);
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ purpose: "embedding", model: "emb" }));
  });

  it("rejects malformed model references", async () => {
    const router = new LLMRouter({ providers: {} });
    await expect(router.chat({ model: "gpt", messages: msg }, ctx)).rejects.toThrow(/Invalid model reference/);
    await expect(router.chat({ model: "acme:x", messages: msg }, ctx)).rejects.toThrow(/Unknown LLM provider/);
  });

  it("builds only the providers whose keys are present", () => {
    expect(Object.keys(providersFromEnv({ ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "o" })).sort()).toEqual(["anthropic", "openrouter"]);
    expect(providersFromEnv({})).toEqual({});
  });
});

describe("PricingCatalog", () => {
  it("supports wildcard entries for dated model snapshots", () => {
    const c = new PricingCatalog([{ provider: "openai", model: "model-x*", inputPerMTok: 1, outputPerMTok: 2 }]);
    expect(c.estimate("openai", "model-x-2026-01-01", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toEqual({ costUsd: 3, priced: true });
  });
});
