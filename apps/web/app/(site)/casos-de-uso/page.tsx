import { Card, CtaBand, PageHero, Section } from "@/components/site/ui";
import { ALL_SOLUTIONS, CHANNEL_LABEL } from "@/lib/site-content";

export const metadata = { title: "Casos de uso", description: "Ejemplos ilustrativos de uso de cada solución de IA." };

export default function UseCasesPage() {
  return (
    <>
      <PageHero
        eyebrow="Casos de uso"
        title="Qué puede hacer cada solución en un día normal"
        intro="Ejemplos ilustrativos para entender cada solución. No son testimonios ni resultados de clientes: cuando tengamos casos reales publicables, los verás aquí con su permiso."
      />
      <Section>
        <div className="grid gap-5 md:grid-cols-2">
          {ALL_SOLUTIONS.map((s) => (
            <Card key={s.key}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">{s.name}</p>
              <p className="mt-3 text-lg text-white">{s.useCase}</p>
              <p className="mt-3 text-sm text-slate-400">{s.description}</p>
              <p className="mt-4 text-xs text-slate-500">
                Ejemplo ilustrativo · Canales: {s.channels.map((c) => CHANNEL_LABEL[c] ?? c).join(", ")}
              </p>
            </Card>
          ))}
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
