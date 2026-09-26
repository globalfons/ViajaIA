import { Prose } from "@/components/site/prose";
import { PageHero, Section } from "@/components/site/ui";
import { legalInfo } from "@/lib/legal";

export const metadata = { title: "Aviso legal" };

export default function LegalNoticePage() {
  const l = legalInfo();
  return (
    <>
      <PageHero eyebrow="Legal" title="Aviso legal" intro="Información del titular de este sitio web (LSSI-CE)." />
      <Section>
        <Prose>
          <h2>Titular</h2>
          <ul>
            <li>Denominación: {l.company}</li>
            <li>NIF: {l.taxId}</li>
            <li>Domicilio: {l.address}</li>
            <li>Contacto: {l.email}</li>
          </ul>
          <h2>Uso del sitio</h2>
          <p>El acceso a esta web es gratuito. Los contenidos describen servicios de la agencia y ejemplos ilustrativos de uso; no constituyen una oferta vinculante hasta la aceptación de una propuesta.</p>
          <h2>Inteligencia artificial</h2>
          <p>Los asistentes de IA pueden cometer errores. Las respuestas generadas en demostraciones no sustituyen el asesoramiento profesional.</p>
          <h2>Propiedad intelectual</h2>
          <p>Los textos, el diseño y el software de este sitio pertenecen a su titular o se usan con licencia. Los componentes de código abierto se listan en el aviso de terceros del proyecto.</p>
        </Prose>
      </Section>
    </>
  );
}
