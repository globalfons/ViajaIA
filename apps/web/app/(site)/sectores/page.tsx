import Link from "next/link";
import { Card, Check, CtaBand, PageHero, Section } from "@/components/site/ui";
import { getSiteSolution, SECTORS } from "@/lib/site-content";

export const metadata = { title: "Sectores", description: "Cómo aplicar agentes de IA en clínicas, academias, inmobiliarias, despachos, comercio y hostelería." };

export default function SectorsPage() {
  return (
    <>
      <PageHero eyebrow="Sectores" title="Soluciones pensadas para cómo trabaja tu sector" intro="Ejemplos de aplicación por sector. Son escenarios ilustrativos de lo que la plataforma hace, no referencias de clientes." />
      <Section>
        <div className="grid gap-5 md:grid-cols-2">
          {SECTORS.map((sec) => (
            <Card key={sec.slug} className="flex flex-col">
              <h2 className="text-xl font-semibold text-white" id={sec.slug}>
                {sec.name}
              </h2>
              <p className="mt-1 text-sm text-slate-400">{sec.intro}</p>
              <ul className="mt-4 space-y-2 text-sm">
                {sec.examples.map((e) => (
                  <Check key={e}>{e}</Check>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap gap-2 pt-1">
                {sec.solutions.map((slug) => {
                  const s = getSiteSolution(slug)!;
                  return (
                    <Link key={slug} href={`/soluciones/${slug}`} className="rounded-full border border-white/10 px-3 py-1 text-xs text-cyan-200 hover:border-cyan-300/50">
                      {s.title}
                    </Link>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
