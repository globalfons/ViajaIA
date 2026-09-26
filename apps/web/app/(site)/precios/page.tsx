import { LIMIT_KEYS, type LimitKey } from "@dtn/core/billing/limits";
import { formatMoney } from "@dtn/core/billing/stripe";
import { publicPlans } from "@dtn/db";
import { ButtonLink, Card, CtaBand, PageHero, Section } from "@/components/site/ui";
import { db } from "@/lib/db";

export const metadata = { title: "Precios", description: "Planes de la plataforma y cómo se calcula el precio de cada solución." };
export const dynamic = "force-dynamic";

const INTERVAL: Record<string, string> = { month: "mes", year: "año", week: "semana", day: "día" };
const SHOWN: LimitKey[] = ["max_agents", "max_workflows", "max_knowledge_bases", "max_monthly_conversations", "max_members", "monthly_llm_cost_usd"];

async function loadPlans() {
  try {
    return await publicPlans(db());
  } catch {
    return null; // database unavailable: the page still explains how pricing works
  }
}

export default async function PricingPage() {
  const plans = await loadPlans();
  const anyPrice = plans?.some((p) => p.prices?.length);
  return (
    <>
      <PageHero
        eyebrow="Precios"
        title="Un plan de plataforma y una propuesta a tu medida"
        intro="Cada proyecto combina un plan de la plataforma (capacidad y límites) con la configuración de tus soluciones. Solo mostramos precios que están publicados en nuestro sistema de cobro."
      />
      <Section>
        {plans?.length ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {plans.map((p) => (
              <Card key={p.code} className="flex flex-col">
                <h2 className="text-xl font-semibold text-white">{p.name}</h2>
                {p.description ? <p className="mt-1 text-sm text-slate-400">{p.description}</p> : null}
                <div className="my-5">
                  {p.prices?.length ? (
                    p.prices.map((x) => (
                      <p key={`${x.currency}-${x.interval}`} className="text-3xl font-semibold text-white">
                        {formatMoney(Number(x.unit_amount), x.currency)} <span className="text-base font-normal text-slate-400">/ {INTERVAL[x.interval] ?? x.interval}</span>
                      </p>
                    ))
                  ) : (
                    <p className="text-lg font-medium text-slate-200">Precio según propuesta</p>
                  )}
                </div>
                <dl className="space-y-1.5 text-sm">
                  {SHOWN.map((k) => (
                    <div key={k} className="flex justify-between gap-3 border-b border-white/5 pb-1.5">
                      <dt className="text-slate-400">{LIMIT_KEYS[k]}</dt>
                      <dd className="text-slate-200">{p.limits?.[k] == null ? "Según propuesta" : String(p.limits[k])}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-6 pt-2">
                  <ButtonLink href={`/contacto?plan=${p.code}`} variant={p.code === "PRO" ? "primary" : "ghost"}>
                    Solicitar propuesta
                  </ButtonLink>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <p className="text-slate-300">Estamos preparando la publicación de planes. Escríbenos y te enviamos una propuesta.</p>
          </Card>
        )}
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          <Card>
            <h3 className="font-semibold text-white">Qué incluye la propuesta</h3>
            <p className="mt-2 text-sm text-slate-400">Configuración de las soluciones, conexión de canales, carga de tu documentación y pruebas contigo antes de abrirla a tus clientes.</p>
          </Card>
          <Card>
            <h3 className="font-semibold text-white">Consumo de IA transparente</h3>
            <p className="mt-2 text-sm text-slate-400">Ves el coste de cada conversación y el total del mes. Puedes fijar un límite mensual y decidir si al alcanzarlo se pausa o se pide aprobación.</p>
          </Card>
          <Card>
            <h3 className="font-semibold text-white">Pago y facturas</h3>
            <p className="mt-2 text-sm text-slate-400">
              {anyPrice ? "Los planes publicados se contratan y facturan con Stripe; las facturas quedan disponibles en tu panel." : "Te enviamos la propuesta y, al aceptarla, activamos tu plan."}
            </p>
          </Card>
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
