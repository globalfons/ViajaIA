import Link from "next/link";
import { formatMoney } from "@dtn/core/billing/stripe";
import { platformClients, platformOverview } from "@dtn/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { decideLimitApprovalAction } from "@/lib/actions/admin";
import { db } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatUsd } from "@/lib/utils";
import { SUB_STATUS } from "@/lib/billing-ui";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardHeader>
    </Card>
  );
}

export async function OverviewTab() {
  const supabase = await createSupabaseServerClient();
  const [o, clients, { data: limitRequests }] = await Promise.all([
    platformOverview(db()),
    platformClients(db()),
    supabase.from("limit_approvals").select("id, limit_key, limit_value, used_value, created_at, organizations(name)").eq("status", "pending").order("created_at"),
  ]);
  const revenue = o.monthlyRevenue.length ? o.monthlyRevenue.map((r) => formatMoney(r.amount, r.currency)).join(" + ") : "Sin datos";
  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi label="Clientes" value={String(o.clients.active + o.clients.suspended)} hint={`${o.clients.active} activos · ${o.clients.suspended} bloqueados`} />
        <Kpi label="Agentes activos" value={String(o.activeAgents)} />
        <Kpi label="Coste IA del mes" value={formatUsd(o.monthlyAiCostUsd)} hint="Suma de usage_events (precios de la tabla de modelos)" />
        <Kpi
          label="Ingresos del mes"
          value={revenue}
          hint={o.monthlyRevenue.length ? "Facturas pagadas en Stripe" : process.env.STRIPE_SECRET_KEY ? "Aún no hay facturas pagadas este mes" : "Stripe no está configurado: no hay datos de ingresos"}
        />
        <Kpi label="Conversaciones activas" value={String(o.activeConversations)} hint="No cerradas, con actividad en 7 días" />
        <Kpi
          label="Tasa de error"
          value={o.runs.errorRate == null ? "Sin ejecuciones" : `${(o.runs.errorRate * 100).toFixed(1)} %`}
          hint={`${o.runs.failed} fallidas de ${o.runs.total} ejecuciones (agentes + workflows) este mes`}
        />
      </div>

      {limitRequests?.length ? (
        <Card className="mb-6 border-warning/40">
          <CardHeader>
            <CardTitle>Límites alcanzados: pendientes de aprobación</CardTitle>
            <CardDescription>Clientes con la política «pedir aprobación». Aprobar concede margen extra este mes (misma unidad que el límite).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {limitRequests.map((r) => {
              const org = (Array.isArray(r.organizations) ? r.organizations[0] : r.organizations) as { name: string } | null;
              return (
                <form key={r.id} action={decideLimitApprovalAction} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
                  <input type="hidden" name="id" value={r.id} />
                  <span className="font-medium">{org?.name}</span>
                  <code className="text-xs">{r.limit_key}</code>
                  <span className="text-muted-foreground">
                    {Number(r.used_value).toFixed(2)} / {Number(r.limit_value).toFixed(2)}
                  </span>
                  <Input name="extra" type="number" min={0} step="any" required placeholder="Margen extra" className="h-8 w-36" aria-label="Margen extra" />
                  <Button type="submit" name="decision" value="approve" size="sm">
                    Aprobar
                  </Button>
                  <Button type="submit" name="decision" value="reject" size="sm" variant="outline" formNoValidate>
                    Rechazar
                  </Button>
                </form>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Clientes</CardTitle>
          <CardDescription>Métricas del mes en curso por cliente.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Cliente</TH>
                <TH>Plan</TH>
                <TH className="text-right">Usuarios</TH>
                <TH className="text-right">Agentes</TH>
                <TH className="text-right">Conv. mes</TH>
                <TH className="text-right">Leads</TH>
                <TH className="text-right">Coste IA</TH>
                <TH className="text-right">Errores</TH>
                <TH>Suscripción</TH>
              </TR>
            </THead>
            <TBody>
              {clients.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <Link href={`/clients/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    {c.status !== "active" ? <Badge variant="danger" className="ml-2">bloqueado</Badge> : null}
                  </TD>
                  <TD>{c.plan_code ?? "—"}</TD>
                  <TD className="text-right">{c.members}</TD>
                  <TD className="text-right">{c.active_agents}</TD>
                  <TD className="text-right">{c.conversations_month}</TD>
                  <TD className="text-right">{c.leads}</TD>
                  <TD className="text-right">{formatUsd(Number(c.ai_cost_month))}</TD>
                  <TD className="text-right">{c.runs_month ? `${c.failed_month}/${c.runs_month}` : "—"}</TD>
                  <TD>{c.subscription_status ? (SUB_STATUS[c.subscription_status]?.label ?? c.subscription_status) : "—"}</TD>
                </TR>
              ))}
              {clients.length ? null : (
                <TR>
                  <TD colSpan={9} className="py-6 text-center text-muted-foreground">
                    Todavía no hay clientes.
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
