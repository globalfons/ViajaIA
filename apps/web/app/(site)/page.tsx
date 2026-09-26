import Link from "next/link";
import { ButtonLink, Card, Check, Container, CtaBand, Eyebrow, Gradient, H1, H2, Lead, Section } from "@/components/site/ui";
import { SITE_SOLUTIONS } from "@/lib/site-content";

export const metadata = { title: { absolute: "DigitalizaTusNegocios · Soluciones de IA para empresas" } };

const CHANNELS = [
  ["Chat web", "Un widget en tu web con una línea de código."],
  ["WhatsApp Business", "API oficial de Meta, con tu número."],
  ["Email", "Borradores revisados por tu equipo o envío automático si lo activas."],
  ["Google Calendar", "Huecos reales y reserva de citas."],
  ["API REST", "Integra los agentes en tus propias herramientas."],
];

const STEPS = [
  ["Diagnóstico", "Vemos qué consultas, procesos y canales te cuestan más tiempo y dónde la IA aporta de verdad."],
  ["Configuración", "Montamos la solución con tu documentación, tu tono y tus reglas: qué puede hacer y qué no."],
  ["Puesta en marcha", "La conectamos a tu web, WhatsApp, email o calendario y la probamos contigo antes de abrirla."],
  ["Mejora continua", "Revisamos conversaciones, costes y escalados para ajustar respuestas y automatizar más."],
];

const CONTROL = [
  "Tus datos, separados de los de cualquier otra empresa y con aislamiento verificado por tests.",
  "Cada agente solo usa las herramientas que le permites; las acciones sensibles esperan aprobación.",
  "Escalado a una persona cuando la IA no está segura o el cliente lo pide.",
  "Coste de cada conversación y límites mensuales configurables.",
  "Credenciales cifradas: nunca se muestran ni llegan al modelo.",
  "Registro de auditoría de las acciones importantes.",
];

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(124,92,255,0.25),transparent_60%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        <Container className="relative grid items-center gap-12 pb-20 pt-16 sm:pt-24 lg:grid-cols-[1.15fr_1fr]">
          <div className="space-y-6">
            <Eyebrow>Agencia de soluciones de IA</Eyebrow>
            <H1>
              IA que atiende, vende y automatiza, <Gradient>con tus datos y bajo tu control.</Gradient>
            </H1>
            <Lead className="max-w-xl">
              Configuramos, desplegamos y gestionamos agentes de IA para tu empresa: atención al cliente, ventas, WhatsApp, citas, documentos y procesos.
            </Lead>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/demo">Probar la demo</ButtonLink>
              <ButtonLink href="/contacto" variant="ghost">
                Hablar con nosotros
              </ButtonLink>
            </div>
          </div>
          <Card className="relative space-y-4 bg-[#0B1020]/80">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Cómo responde un agente</p>
            <ol className="space-y-3 text-sm">
              {[
                ["1", "Recibe la pregunta", "Desde tu web, WhatsApp o email."],
                ["2", "Busca en tu información", "Solo en la documentación de tu empresa."],
                ["3", "Responde citando la fuente", "Y registra coste y consumo."],
                ["4", "Si no está seguro, deriva", "Tu equipo continúa con todo el contexto."],
              ].map(([n, t, d]) => (
                <li key={n} className="flex gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 text-xs font-bold text-white">{n}</span>
                  <span>
                    <span className="block font-medium text-white">{t}</span>
                    <span className="text-slate-400">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </Container>
      </section>

      <Section className="border-t border-white/5">
        <Eyebrow>Soluciones</Eyebrow>
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <H2 className="max-w-2xl">Soluciones listas para configurar con tu información</H2>
          <Link href="/soluciones" className="text-sm font-medium text-cyan-300 hover:text-cyan-200">
            Ver todas →
          </Link>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SITE_SOLUTIONS.map((s) => (
            <Link key={s.slug} href={`/soluciones/${s.slug}`} className="group">
              <Card className="h-full transition group-hover:border-violet-400/40 group-hover:bg-white/[0.05]">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">{s.kicker}</p>
                <h3 className="mt-2 text-lg font-semibold text-white">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.headline}</p>
                <span className="mt-4 inline-block text-sm font-medium text-cyan-300">Ver solución →</span>
              </Card>
            </Link>
          ))}
        </div>
      </Section>

      <Section className="bg-[#0B1020]">
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <Eyebrow>Canales disponibles hoy</Eyebrow>
            <H2>Donde ya hablan tus clientes</H2>
            <Lead className="mt-4">Todos los canales comparten el mismo agente, la misma información y la misma bandeja para tu equipo.</Lead>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {CHANNELS.map(([t, d]) => (
              <li key={t} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="font-medium text-white">{t}</p>
                <p className="mt-1 text-sm text-slate-400">{d}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section>
        <Eyebrow>Cómo trabajamos</Eyebrow>
        <H2 className="mb-10 max-w-2xl">De la idea a una solución en producción, sin que tengas que aprender IA</H2>
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([t, d], i) => (
            <li key={t}>
              <Card className="h-full">
                <p className="text-sm font-semibold text-cyan-300">0{i + 1}</p>
                <h3 className="mt-2 text-lg font-semibold text-white">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{d}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section className="bg-[#0B1020]">
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <Eyebrow>Control y seguridad</Eyebrow>
            <H2>La IA trabaja con reglas, no por libre</H2>
            <Lead className="mt-4">Tú decides qué puede hacer cada agente, cuándo interviene una persona y cuánto puede gastar.</Lead>
          </div>
          <ul className="space-y-3">
            {CONTROL.map((c) => (
              <Check key={c}>{c}</Check>
            ))}
          </ul>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
