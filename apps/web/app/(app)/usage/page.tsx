import { AlertTriangle } from "lucide-react";
import { effectiveLimits } from "@dtn/core/billing/limits";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { monthStartIso, summarizeUsage, type UsageDailyRow } from "@/lib/usage";
import { formatDate, formatNumber, formatUsd } from "@/lib/utils";

export const metadata = { title: "Usage" };

function Meter({ used, limit }: { used: number; limit: number | null | undefined }) {
  if (limit == null) return <p className="text-xs text-muted-foreground">Sin límite</p>;
  const pct = Math.min(100, limit === 0 ? 100 : (used / limit) * 100);
  const tone = pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-primary";
  return (
    <div className="mt-2">
      <div className="h-1.5 w-full rounded-full bg-muted" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{Math.round(pct)}% del límite</p>
    </div>
  );
}

export default async function UsagePage() {
  const [s, supabase] = await Promise.all([requireOrg("usage.read"), createSupabaseServerClient()]);
  const since = monthStartIso();
  const [{ data: rows }, { data: org }, { data: agents }, { data: failures }] = await Promise.all([
    supabase.from("usage_daily").select("*").eq("organization_id", s.org.id).gte("day", since),
    supabase.from("organizations").select("limits, plans(limits)").eq("id", s.org.id).single(),
    supabase.from("agents").select("id, name").eq("organization_id", s.org.id),
    supabase
      .from("usage_events")
      .select("id, provider, model, error_code, created_at, agent_id")
      .eq("organization_id", s.org.id)
      .eq("success", false)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const summary = summarizeUsage((rows ?? []) as UsageDailyRow[]);
  const plan = (Array.isArray(org?.plans) ? org?.plans[0] : org?.plans) as { limits?: unknown } | null;
  const limits = effectiveLimits(plan?.limits, org?.limits);
  const agentName = new Map((agents ?? []).map((a) => [a.id, a.name]));
  const tokens = summary.inputTokens + summary.outputTokens;

  return (
    <>
      <PageHeader title="Usage" description="Consumo del mes en curso (UTC)." />
      {summary.unpricedModels.length ? (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Modelos sin precio configurado (su coste no se contabiliza): {summary.unpricedModels.join(", ")}. El administrador de la plataforma
            puede añadirlos en Platform Admin → Modelos.
          </span>
        </div>
      ) : null}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Coste IA (mes)</CardDescription>
            <CardTitle className="text-2xl">{formatUsd(summary.costUsd)}</CardTitle>
            <Meter used={summary.costUsd} limit={limits.monthly_llm_cost_usd} />
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Tokens (mes)</CardDescription>
            <CardTitle className="text-2xl">{formatNumber(tokens)}</CardTitle>
            <Meter used={tokens} limit={limits.monthly_tokens} />
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Llamadas al LLM</CardDescription>
            <CardTitle className="text-2xl">{formatNumber(summary.calls)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Errores</CardDescription>
            <CardTitle className="text-2xl">{formatNumber(summary.errors)}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {summary.calls ? `${((summary.errors / summary.calls) * 100).toFixed(1)}% de las llamadas` : "—"}
            </p>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Coste por modelo</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Modelo</TH>
                  <TH className="text-right">Llamadas</TH>
                  <TH className="text-right">Tokens</TH>
                  <TH className="text-right">Latencia media</TH>
                  <TH className="text-right">Coste</TH>
                </TR>
              </THead>
              <TBody>
                {summary.byModel.map((m) => (
                  <TR key={m.key}>
                    <TD className="font-mono text-xs">{m.key}</TD>
                    <TD className="text-right">{formatNumber(m.calls)}</TD>
                    <TD className="text-right">{formatNumber(m.tokens)}</TD>
                    <TD className="text-right">{m.avgLatencyMs != null ? `${formatNumber(m.avgLatencyMs)} ms` : "—"}</TD>
                    <TD className="text-right">{formatUsd(m.costUsd)}</TD>
                  </TR>
                ))}
                {summary.byModel.length ? null : (
                  <TR>
                    <TD colSpan={5} className="py-6 text-center text-muted-foreground">
                      Sin consumo este mes.
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Coste por agente</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Agente</TH>
                  <TH className="text-right">Llamadas</TH>
                  <TH className="text-right">Tokens</TH>
                  <TH className="text-right">Coste</TH>
                </TR>
              </THead>
              <TBody>
                {summary.byAgent.map((a) => (
                  <TR key={a.key}>
                    <TD>{agentName.get(a.key) ?? a.key.slice(0, 8)}</TD>
                    <TD className="text-right">{formatNumber(a.calls)}</TD>
                    <TD className="text-right">{formatNumber(a.tokens)}</TD>
                    <TD className="text-right">{formatUsd(a.costUsd)}</TD>
                  </TR>
                ))}
                {summary.byAgent.length ? null : (
                  <TR>
                    <TD colSpan={4} className="py-6 text-center text-muted-foreground">
                      Sin consumo de agentes este mes.
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Últimos errores de LLM</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TBody>
                {(failures ?? []).map((f) => (
                  <TR key={f.id}>
                    <TD className="font-mono text-xs">
                      {f.provider}:{f.model}
                    </TD>
                    <TD className="font-mono text-xs text-danger">{f.error_code}</TD>
                    <TD className="text-xs text-muted-foreground">{f.agent_id ? (agentName.get(f.agent_id) ?? "—") : "—"}</TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(f.created_at)}</TD>
                  </TR>
                ))}
                {failures?.length ? null : (
                  <TR>
                    <TD className="py-6 text-center text-muted-foreground">Sin errores recientes.</TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
