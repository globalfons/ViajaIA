export interface UsageDailyRow {
  day: string;
  provider: string;
  model: string;
  agent_id: string | null;
  calls: number;
  errors: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | string;
  all_priced: boolean;
  avg_latency_ms: number | null;
}

export interface UsageSummary {
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpricedModels: string[];
  byModel: { key: string; calls: number; tokens: number; costUsd: number; errors: number; avgLatencyMs: number | null }[];
  byAgent: { key: string; calls: number; tokens: number; costUsd: number }[];
  byDay: { day: string; costUsd: number; tokens: number; calls: number; errors: number }[];
}

/** Aggregates rows of the usage_daily view. `days` fills gaps so charts have a continuous axis. */
export function summarizeUsage(rows: UsageDailyRow[], days: string[] = []): UsageSummary {
  const byModel = new Map<string, UsageSummary["byModel"][number] & { latencyWeight: number }>();
  const byAgent = new Map<string, UsageSummary["byAgent"][number]>();
  const byDay = new Map<string, UsageSummary["byDay"][number]>(days.map((d) => [d, { day: d, costUsd: 0, tokens: 0, calls: 0, errors: 0 }]));
  const unpriced = new Set<string>();
  const s = { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

  for (const r of rows) {
    const cost = Number(r.cost_usd) || 0;
    const tokens = Number(r.input_tokens) + Number(r.output_tokens);
    const calls = Number(r.calls);
    s.calls += calls;
    s.errors += Number(r.errors);
    s.inputTokens += Number(r.input_tokens);
    s.outputTokens += Number(r.output_tokens);
    s.costUsd += cost;
    const mk = `${r.provider}:${r.model}`;
    if (!r.all_priced) unpriced.add(mk);
    const m = byModel.get(mk) ?? { key: mk, calls: 0, tokens: 0, costUsd: 0, errors: 0, avgLatencyMs: null, latencyWeight: 0 };
    m.calls += calls;
    m.tokens += tokens;
    m.costUsd += cost;
    m.errors += Number(r.errors);
    if (r.avg_latency_ms != null) {
      m.avgLatencyMs = ((m.avgLatencyMs ?? 0) * m.latencyWeight + r.avg_latency_ms * calls) / (m.latencyWeight + calls);
      m.latencyWeight += calls;
    }
    byModel.set(mk, m);
    if (r.agent_id) {
      const a = byAgent.get(r.agent_id) ?? { key: r.agent_id, calls: 0, tokens: 0, costUsd: 0 };
      a.calls += calls;
      a.tokens += tokens;
      a.costUsd += cost;
      byAgent.set(r.agent_id, a);
    }
    const d = byDay.get(r.day) ?? { day: r.day, costUsd: 0, tokens: 0, calls: 0, errors: 0 };
    d.costUsd += cost;
    d.tokens += tokens;
    d.calls += calls;
    d.errors += Number(r.errors);
    byDay.set(r.day, d);
  }
  return {
    ...s,
    unpricedModels: [...unpriced].sort(),
    byModel: [...byModel.values()].map(({ latencyWeight: _w, ...m }) => ({ ...m, avgLatencyMs: m.avgLatencyMs === null ? null : Math.round(m.avgLatencyMs) })).sort((a, b) => b.costUsd - a.costUsd),
    byAgent: [...byAgent.values()].sort((a, b) => b.costUsd - a.costUsd),
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}

export function lastNDays(n: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function monthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
