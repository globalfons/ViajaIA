import { getDemoChannelKey } from "@dtn/db";
import { ScriptedDemo } from "@/components/site/scripted-demo";
import { ButtonLink, Card, PageHero, Section } from "@/components/site/ui";
import { db } from "@/lib/db";

export const metadata = { title: "Demo", description: "Prueba un agente de IA de atención al cliente." };
export const dynamic = "force-dynamic";

async function demoKey() {
  try {
    return await getDemoChannelKey(db());
  } catch {
    return null;
  }
}

export default async function DemoPage() {
  const key = await demoKey();
  return (
    <>
      <PageHero
        eyebrow="Demo"
        title={key ? "Habla con un agente de IA real" : "Así trabaja un agente, paso a paso"}
        intro={
          key
            ? "Este chat usa la plataforma de verdad: un agente de IA configurado con la información de un negocio ficticio de ejemplo. Pregúntale por horarios, servicios o precios de ese negocio y pide hablar con una persona."
            : "Recorre tres conversaciones de ejemplo y mira qué hace el sistema en cada paso. Si quieres ver un agente real con tu propia información, te preparamos una demo."
        }
      />
      <Section>
        {key ? (
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white">
              <iframe src={`/chat/${key}`} title="Chat de demostración con un agente de IA" className="h-[560px] w-full" />
            </div>
            <div className="space-y-4">
              <Card>
                <p className="text-sm font-semibold text-emerald-300">Demo en vivo · IA real</p>
                <p className="mt-2 text-sm text-slate-300">Las respuestas las genera un modelo de IA en el momento, solo con la documentación del negocio de ejemplo. Puede equivocarse: por eso deriva a una persona cuando no está seguro.</p>
              </Card>
              <Card>
                <p className="text-sm text-slate-300">No escribas datos personales reales. Las conversaciones de la demo se guardan para mejorar el servicio.</p>
              </Card>
              <ButtonLink href="/contacto">Quiero uno con mi información</ButtonLink>
            </div>
          </div>
        ) : (
          <>
            <ScriptedDemo />
            <div className="mt-10">
              <ButtonLink href="/contacto">Quiero ver una demo con mi información</ButtonLink>
            </div>
          </>
        )}
      </Section>
    </>
  );
}
