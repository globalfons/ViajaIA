import { describe, expect, it } from "vitest";
import { checkLimit, effectiveLimits, limitsSchema } from "../src/billing/limits";

describe("limits", () => {
  it("org overrides win over plan limits", () => {
    expect(effectiveLimits({ max_agents: 3, max_members: 5 }, { max_agents: 10 })).toEqual({ max_agents: 10, max_members: 5 });
  });

  it("null override means unlimited", () => {
    const l = effectiveLimits({ max_agents: 3 }, { max_agents: null });
    expect(checkLimit(l, "max_agents", 1000).allowed).toBe(true);
  });

  it("blocks when the increment would exceed the limit", () => {
    expect(checkLimit({ max_agents: 3 }, "max_agents", 2)).toMatchObject({ allowed: true, remaining: 1 });
    expect(checkLimit({ max_agents: 3 }, "max_agents", 3)).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("rejects unknown keys and negative values", () => {
    expect(limitsSchema.safeParse({ max_agentz: 1 }).success).toBe(false);
    expect(limitsSchema.safeParse({ max_agents: -1 }).success).toBe(false);
  });

  it("ignores malformed stored limits instead of crashing", () => {
    expect(effectiveLimits("garbage", { max_agents: 2 })).toEqual({ max_agents: 2 });
  });
});
