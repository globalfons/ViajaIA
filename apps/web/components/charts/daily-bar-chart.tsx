"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Single-series daily bar chart (one hue = brand primary, so no legend box —
 * the card title names the series). Thin bars with rounded data-ends,
 * recessive grid, hover tooltip. Pair it with a table for an accessible view.
 */
export function DailyBarChart({
  data,
  valueKey,
  label,
  format,
}: {
  data: { day: string; [k: string]: number | string }[];
  valueKey: string;
  label: string;
  format: "usd" | "number";
}) {
  const fmt = (v: number) =>
    format === "usd"
      ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD", maximumFractionDigits: v < 1 ? 4 : 2 }).format(v)
      : new Intl.NumberFormat("es-ES", { notation: "compact" }).format(v);
  return (
    <div className="h-56 w-full" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="0" />
          <XAxis
            dataKey="day"
            tickFormatter={(d: string) => d.slice(8, 10)}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={fmt}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            width={64}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted))" }}
            formatter={(v) => [fmt(Number(v)), label]}
            labelFormatter={(d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--foreground))" }}
          />
          <Bar dataKey={valueKey} fill="hsl(var(--brand-primary))" radius={[4, 4, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
