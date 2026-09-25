import { DailyBarChart } from "@/components/charts/daily-bar-chart";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { lastNDays, summarizeUsage, type UsageDailyRow } from "@/lib/usage";
import { formatNumber, formatUsd } from "@/lib/utils";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const [s, supabase] = await Promise.all([requireOrg("usage.read"), createSupabaseServerClient()]);
  const days = lastNDays(30);
  const { data: rows } = await supabase.from("usage_daily").select("*").eq("organization_id", s.org.id).gte("day", days[0]!);
  const summary = summarizeUsage((rows ?? []) as UsageDailyRow[], days);
  const chartData = summary.byDay.map((d) => ({ day: d.day, cost: d.costUsd, tokens: d.tokens }));

  return (
    <>
      <PageHeader title="Analytics" description="Últimos 30 días." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Coste diario de IA</CardTitle>
            <CardDescription>Total: {formatUsd(summary.costUsd)}</CardDescription>
          </CardHeader>
          <CardContent>
            <DailyBarChart data={chartData} valueKey="cost" label="Coste (USD)" format="usd" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tokens diarios</CardTitle>
            <CardDescription>Total: {formatNumber(summary.inputTokens + summary.outputTokens)}</CardDescription>
          </CardHeader>
          <CardContent>
            <DailyBarChart data={chartData} valueKey="tokens" label="Tokens" format="number" />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Detalle por día</CardTitle>
          </CardHeader>
          <CardContent className="max-h-96 overflow-y-auto p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Día</TH>
                  <TH className="text-right">Llamadas</TH>
                  <TH className="text-right">Errores</TH>
                  <TH className="text-right">Tokens</TH>
                  <TH className="text-right">Coste</TH>
                </TR>
              </THead>
              <TBody>
                {[...summary.byDay].reverse().map((d) => (
                  <TR key={d.day}>
                    <TD>{d.day}</TD>
                    <TD className="text-right">{formatNumber(d.calls)}</TD>
                    <TD className="text-right">{formatNumber(d.errors)}</TD>
                    <TD className="text-right">{formatNumber(d.tokens)}</TD>
                    <TD className="text-right">{formatUsd(d.costUsd)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
