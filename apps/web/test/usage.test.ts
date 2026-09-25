import { describe, expect, it } from "vitest";
import { lastNDays, summarizeUsage, type UsageDailyRow } from "@/lib/usage";

const row = (p: Partial<UsageDailyRow>): UsageDailyRow => ({
  day: "2026-09-01",
  provider: "openai",
  model: "m",
  agent_id: null,
  calls: 1,
  errors: 0,
  input_tokens: 10,
  output_tokens: 5,
  cost_usd: "0.5",
  all_priced: true,
  avg_latency_ms: 100,
  ...p,
});

describe("summarizeUsage", () => {
  it("aggregates totals, per model, per agent and per day", () => {
    const s = summarizeUsage(
      [
        row({ agent_id: "a1", calls: 2, avg_latency_ms: 100 }),
        row({ day: "2026-09-02", agent_id: "a1", calls: 2, errors: 1, avg_latency_ms: 300, cost_usd: 1 }),
        row({ provider: "anthropic", model: "c", all_priced: false, cost_usd: 0 }),
      ],
      ["2026-09-01", "2026-09-02", "2026-09-03"],
    );
    expect(s).toMatchObject({ calls: 5, errors: 1, costUsd: 1.5, inputTokens: 30, outputTokens: 15, unpricedModels: ["anthropic:c"] });
    expect(s.byModel[0]).toMatchObject({ key: "openai:m", calls: 4, costUsd: 1.5, avgLatencyMs: 200 });
    expect(s.byAgent).toEqual([{ key: "a1", calls: 4, tokens: 30, costUsd: 1.5 }]);
    expect(s.byDay.map((d) => d.day)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(s.byDay[2]).toMatchObject({ costUsd: 0, calls: 0 });
  });

  it("lastNDays returns a continuous UTC range", () => {
    expect(lastNDays(3, new Date("2026-03-01T10:00:00Z"))).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
  });
});
