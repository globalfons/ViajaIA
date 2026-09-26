import Link from "next/link";
import { Card, CtaBand, PageHero, Section } from "@/components/site/ui";
import { ALL_SOLUTIONS, CHANNEL_LABEL, SITE_SOLUTIONS } from "@/lib/site-content";

export const metadata = { title: "Soluciones", description: "Soluciones de IA para atención al cliente, ventas, WhatsApp, documentos, marketing y automatización." };

export default function SolutionsPage() {
  return (
    <>
      <PageHero eyebrow="Soluciones" title="Soluciones de IA que configuramos para tu empresa" intro="Cada solución es una plantilla probada que adaptamos a tu negocio con tu información, tus canales y tus reglas." />
      <Section>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SITE_SOLUTIONS.map((s) => (
            <Link key={s.slug} href={`/soluciones/${s.slug}`} className="group">
              <Card className="h-full transition group-hover:border-violet-400/40">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">{s.kicker}</p>
                <h2 className="mt-2 text-xl font-semibold text-white">{s.title}</h2>
                <p className="mt-2 text-sm text-slate-400">{s.intro}</p>
                <span className="mt-4 inline-block text-sm font-medium text-cyan-300">Ver detalle →</span>
              </Card>
            </Link>
          ))}
        </div>
      </Section>
      <Section className="bg-[#0B1020]">
        <h2 className="mb-2 text-2xl font-semibold text-white">Catálogo completo</h2>
        <p className="mb-8 text-slate-400">Las plantillas de solución disponibles en la plataforma.</p>
        <div className="grid gap-4 md:grid-cols-2">
          {ALL_SOLUTIONS.map((s) => (
            <div key={s.key} className="rounded-2xl border border-white/10 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-white">{s.name}</h3>
                <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] text-slate-400">{s.category}</span>
              </div>
              <p className="mt-2 text-sm text-slate-400">{s.tagline}</p>
              <p className="mt-3 text-xs text-slate-500">Canales: {s.channels.map((c) => CHANNEL_LABEL[c] ?? c).join(", ")}</p>
            </div>
          ))}
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
