import { describe, expect, it } from "vitest";
import { getSystemStatus } from "@/lib/system-status";

describe("getSystemStatus", () => {
  it("never exposes configuration values, only booleans", () => {
    const status = getSystemStatus({ OPENAI_API_KEY: "sk-live-secret", STRIPE_SECRET_KEY: "sk_live_x" });
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("sk-live-secret");
    expect(serialized).not.toContain("sk_live_x");
  });

  it("flags missing required services", () => {
    const status = getSystemStatus({});
    expect(status.filter((s) => s.required && !s.configured).map((s) => s.key)).toEqual([
      "supabase",
      "service",
      "secrets",
      "llm",
    ]);
  });

  it("treats a single LLM provider as sufficient", () => {
    const status = getSystemStatus({ ANTHROPIC_API_KEY: "x" });
    expect(status.find((s) => s.key === "llm")?.configured).toBe(true);
  });
});
