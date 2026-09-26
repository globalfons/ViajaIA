import { ContactForm } from "@/components/site/contact-form";
import { Card, PageHero, Section } from "@/components/site/ui";
import { SITE_SOLUTIONS } from "@/lib/site-content";

export const metadata = { title: "Contacto", description: "Cuéntanos tu caso y te proponemos una solución de IA concreta." };

export default async function ContactPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const interests = [...SITE_SOLUTIONS.map((s) => ({ value: s.slug, label: s.title })), { value: "otro", label: "Otro / varias soluciones" }];
  const def = interests.some((i) => i.value === sp.interes) ? sp.interes : undefined;
  const contactEmail = process.env.CONTACT_EMAIL;
  return (
    <>
      <PageHero eyebrow="Contacto" title="Hablemos de tu caso" intro="Explícanos qué quieres resolver. Te respondemos con una propuesta concreta: qué solución, qué necesitamos de ti y cómo medimos si funciona." />
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr]">
          <Card className="p-6 sm:p-8">
            <ContactForm interests={interests} defaultInterest={def} />
          </Card>
          <div className="space-y-4">
            <Card>
              <h2 className="font-semibold text-white">Qué pasa después</h2>
              <ol className="mt-3 space-y-2 text-sm text-slate-300">
                <li>1. Leemos tu mensaje y, si hace falta, te pedimos detalles.</li>
                <li>2. Te proponemos la solución y el plan adecuados.</li>
                <li>3. Si te encaja, la configuramos con tu información y la probamos contigo.</li>
              </ol>
            </Card>
            {contactEmail ? (
              <Card>
                <h2 className="font-semibold text-white">¿Prefieres email?</h2>
                <a href={`mailto:${contactEmail}`} className="mt-2 inline-block text-cyan-300 underline">
                  {contactEmail}
                </a>
              </Card>
            ) : null}
          </div>
        </div>
      </Section>
    </>
  );
}
