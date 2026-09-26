import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ButtonLink, Card, Check, CtaBand, H2, PageHero, Section } from "@/components/site/ui";
import { catalogFor, CHANNEL_LABEL, getSiteSolution, SITE_SOLUTIONS } from "@/lib/site-content";

export const dynamicParams = false;

export function generateStaticParams() {
  return SITE_SOLUTIONS.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const s = getSiteSolution((await params).slug);
  return s ? { title: s.title, description: s.intro } : {};
}

export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const s = getSiteSolution((await params).slug);
  if (!s) notFound();
  const catalog = catalogFor(s);
  const channels = [...new Set(catalog.flatMap((c) => c.channels))];
  return (
    <>
      <PageHero eyebrow={s.kicker} title={s.headline} intro={s.intro}>
        <div className="flex flex-wrap gap-3 pt-2">
          <ButtonLink href="/demo">Probar la demo</ButtonLink>
          <ButtonLink href={`/contacto?interes=${s.slug}`} variant="ghost">
            Quiero esta solución
          </ButtonLink>
        </div>
      </PageHero>
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <H2 className="text-2xl sm:text-3xl">Qué resuelve</H2>
            <ul className="mt-6 space-y-3">
              {s.problems.map((p) => (
                <Check key={p}>{p}</Check>
              ))}
            </ul>
          </div>
          <div>
            <H2 className="text-2xl sm:text-3xl">Cómo funciona</H2>
            <ol className="mt-6 space-y-3">
              {s.howItWorks.map((step, i) => (
                <li key={step} className="flex gap-3 text-slate-300">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-violet-400/40 text-xs font-semibold text-violet-200">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Section>
      <Section className="bg-[#0B1020]">
        <H2 className="mb-8 text-2xl sm:text-3xl">Incluye</H2>
        <div className="grid gap-5 md:grid-cols-2">
          {catalog.map((c) => (
            <Card key={c.key}>
              <h3 className="text-lg font-semibold text-white">{c.name}</h3>
              <p className="mt-2 text-sm text-slate-400">{c.description}</p>
              <p className="mt-3 text-sm text-slate-300">
                <span className="text-slate-500">Ejemplo de uso: </span>
                {c.useCase}
              </p>
              <p className="mt-3 text-xs text-slate-500">Plantilla {c.templateId}</p>
            </Card>
          ))}
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Card>
            <h3 className="font-semibold text-white">Canales</h3>
            <p className="mt-2 text-sm text-slate-400">{channels.map((c) => CHANNEL_LABEL[c] ?? c).join(" · ")}</p>
          </Card>
          <Card>
            <h3 className="font-semibold text-white">Lo que no hace (a propósito)</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {s.limits.map((l) => (
                <Check key={l}>{l}</Check>
              ))}
            </ul>
          </Card>
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
