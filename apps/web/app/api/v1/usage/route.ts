import { z } from "zod";
import { withApi } from "@/lib/api/http";
import { db } from "@/lib/db";

/** Usage totals per day and model for a date range (default: current month, UTC). */
export const GET = withApi("usage:read", async ({ principal, req }) => {
  const q = z
    .object({ from: z.string().date().optional(), to: z.string().date().optional() })
    .parse(Object.fromEntries(req.nextUrl.searchParams));
  const now = new Date();
  const from = q.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const to = q.to ?? now.toISOString().slice(0, 10);
  const { rows } = await db().query(
    `select day, provider, model, agent_id, calls::int, errors::int, input_tokens::bigint as input_tokens,
            output_tokens::bigint as output_tokens, cost_usd::float as cost_usd, all_priced
     from public.usage_daily where organization_id = $1 and day between $2 and $3 order by day, provider, model`,
    [principal.organizationId, from, to],
  );
  const totals = rows.reduce(
    (acc, r) => ({ calls: acc.calls + r.calls, input_tokens: acc.input_tokens + Number(r.input_tokens), output_tokens: acc.output_tokens + Number(r.output_tokens), cost_usd: acc.cost_usd + r.cost_usd }),
    { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
  );
  return { from, to, totals, data: rows };
});
