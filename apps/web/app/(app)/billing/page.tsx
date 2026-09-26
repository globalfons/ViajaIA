import { effectiveLimits, LIMIT_KEYS, type LimitKey } from "@dtn/core/billing/limits";
import { formatMoney } from "@dtn/core/billing/stripe";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { checkoutAction, portalAction } from "@/lib/actions/billing";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { SUB_STATUS } from "@/lib/billing-ui";

export const metadata = { title: "Billing" };

const INVOICE_STATUS: Record<string, string> = { paid: "Pagada", open: "Pendiente", draft: "Borrador", void: "Anulada", uncollectible: "Incobrable" };
const INTERVAL: Record<string, string> = { month: "mes", year: "año", week: "semana", day: "día" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [s, sp, supabase] = await Promise.all([requireOrg("billing.read"), searchParams, createSupabaseServerClient()]);
  const [{ data: org }, { data: plans }, { data: prices }, { data: subs }, { data: invoices }] = await Promise.all([
    supabase.from("organizations").select("plan_code, limits, stripe_customer_id, plans(name, limits)").eq("id", s.org.id).single(),
    supabase.from("plans").select("code, name, description, limits").eq("active", true).order("sort_order"),
    supabase.from("plan_prices").select("stripe_price_id, plan_code, currency, unit_amount, interval").eq("active", true),
    supabase.from("subscriptions").select("status, plan_code, current_period_end, cancel_at_period_end").eq("organization_id", s.org.id).order("updated_at", { ascending: false }).limit(1),
    supabase.from("invoices").select("id, number, status, currency, amount_due, amount_paid, hosted_invoice_url, invoice_pdf, created_at, paid_at").eq("organization_id", s.org.id).order("created_at", { ascending: false }).limit(24),
  ]);
  const stripeOn = Boolean(process.env.STRIPE_SECRET_KEY);
  const sub = subs?.[0] ?? null;
  const live = sub && ["active", "trialing", "past_due", "unpaid"].includes(sub.status);
  const plan = (Array.isArray(org?.plans) ? org?.plans[0] : org?.plans) as { name: string; limits: unknown } | null;
  const limits = effectiveLimits(plan?.limits, org?.limits);
  const manage = s.can("billing.manage");
  const st = sub ? (SUB_STATUS[sub.status] ?? { label: sub.status, variant: "secondary" as const }) : null;

  return (
    <>
      <PageHeader title="Billing" description="Plan, suscripción y facturas de tu organización." />
      <Flash
        message={{ checkout: "Pago completado. La suscripción se activa en cuanto Stripe lo confirme.", checkout_canceled: "Has cancelado el pago; no se ha cobrado nada." }[sp.ok ?? ""]}
        error={sp.error}
      />
      {!stripeOn ? (
        <p className="mb-6 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          La facturación online todavía no está activada en esta plataforma. Tu plan lo gestiona directamente la agencia.
        </p>
      ) : null}

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Plan actual</CardDescription>
            <CardTitle className="text-2xl">{plan?.name ?? org?.plan_code ?? "—"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {st ? (
              <p className="flex flex-wrap items-center gap-2">
                Suscripción <Badge variant={st.variant}>{st.label}</Badge>
                {sub?.current_period_end ? <span>· {sub.cancel_at_period_end ? "termina" : "renueva"} el {formatDate(sub.current_period_end)}</span> : null}
              </p>
            ) : (
              <p>Sin suscripción online.</p>
            )}
            {manage && stripeOn && org?.stripe_customer_id ? (
              <form action={portalAction} className="mt-3">
                <Button type="submit" variant="outline">
                  Gestionar suscripción y pago
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Límites de tu plan</CardTitle>
            <CardDescription>Límites efectivos, incluidos los ajustes que haya hecho la agencia para tu cuenta.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {(Object.keys(LIMIT_KEYS) as LimitKey[]).map((k) => (
                <div key={k} className="flex justify-between gap-2 border-b py-1">
                  <dt className="text-muted-foreground">{LIMIT_KEYS[k]}</dt>
                  <dd className="font-medium">{limits[k] == null ? "Sin límite" : String(limits[k])}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      {stripeOn && !live ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Planes disponibles</CardTitle>
            <CardDescription>El pago se hace en Stripe. Solo se muestran los planes que la agencia ha publicado con su precio en Stripe.</CardDescription>
          </CardHeader>
          <CardContent>
            {(prices ?? []).length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {(plans ?? [])
                  .filter((p) => (prices ?? []).some((x) => x.plan_code === p.code))
                  .map((p) => (
                    <div key={p.code} className="flex flex-col gap-2 rounded-lg border p-4">
                      <p className="font-semibold">{p.name}</p>
                      {p.description ? <p className="text-sm text-muted-foreground">{p.description}</p> : null}
                      {(prices ?? [])
                        .filter((x) => x.plan_code === p.code)
                        .map((x) => (
                          <form key={x.stripe_price_id} action={checkoutAction} className="mt-auto space-y-2">
                            <input type="hidden" name="priceId" value={x.stripe_price_id} />
                            <p className="text-xl font-semibold">
                              {formatMoney(Number(x.unit_amount), x.currency)} <span className="text-sm font-normal text-muted-foreground">/ {INTERVAL[x.interval] ?? x.interval}</span>
                            </p>
                            {manage ? (
                              <Button type="submit" className="w-full">
                                Contratar {p.name}
                              </Button>
                            ) : null}
                          </form>
                        ))}
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">La agencia todavía no ha publicado precios. Contacta con ella para contratar un plan.</p>
            )}
            {!manage ? <p className="mt-3 text-xs text-muted-foreground">Solo el propietario de la cuenta puede contratar o cambiar el plan.</p> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Facturas</CardTitle>
        </CardHeader>
        <CardContent>
          {(invoices ?? []).length ? (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Número</TH>
                    <TH>Fecha</TH>
                    <TH>Estado</TH>
                    <TH className="text-right">Importe</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {(invoices ?? []).map((i) => (
                    <TR key={i.id}>
                      <TD className="font-mono text-xs">{i.number ?? "—"}</TD>
                      <TD>{formatDate(i.paid_at ?? i.created_at)}</TD>
                      <TD>
                        <Badge variant={i.status === "paid" ? "success" : i.status === "open" ? "warning" : "secondary"}>{INVOICE_STATUS[i.status] ?? i.status}</Badge>
                      </TD>
                      <TD className="text-right">{formatMoney(Number(i.status === "paid" ? i.amount_paid : i.amount_due), i.currency)}</TD>
                      <TD className="text-right">
                        {i.hosted_invoice_url ? (
                          <a href={i.hosted_invoice_url} target="_blank" rel="noreferrer" className="text-sm underline">
                            Ver factura
                          </a>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Todavía no hay facturas.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
