import { Prose } from "@/components/site/prose";
import { PageHero, Section } from "@/components/site/ui";
import { legalInfo } from "@/lib/legal";

export const metadata = { title: "Política de privacidad" };

export default function PrivacyPage() {
  const l = legalInfo();
  return (
    <>
      <PageHero eyebrow="Legal" title="Política de privacidad" intro="Cómo tratamos los datos que nos facilitas en esta web y en la plataforma." />
      <Section>
        <Prose>
          <h2>Responsable del tratamiento</h2>
          <p>
            <strong>{l.company}</strong> · NIF {l.taxId} · {l.address} · Contacto: {l.email}
          </p>
          <h2>Formulario de contacto</h2>
          <ul>
            <li>Finalidad: responder a tu solicitud y, en su caso, preparar una propuesta.</li>
            <li>Base jurídica: tu consentimiento y la aplicación de medidas precontractuales a petición tuya.</li>
            <li>Datos: nombre, email y, si los indicas, empresa, teléfono y mensaje. Guardamos solo un hash de tu IP para prevenir abusos.</li>
            <li>Comunicaciones comerciales: solo si marcas la casilla correspondiente, y puedes retirar el consentimiento en cualquier momento.</li>
            <li>Conservación: el tiempo necesario para atender la solicitud y los plazos legales aplicables.</li>
          </ul>
          <h2>Demo y chat</h2>
          <p>Las conversaciones del chat de demostración se guardan para prestar y mejorar el servicio. No introduzcas datos personales reales en la demo.</p>
          <h2>Clientes de la plataforma</h2>
          <p>
            Cuando una empresa usa la plataforma con sus clientes, esa empresa es responsable de esos datos y nosotros actuamos como encargados del tratamiento según el
            contrato correspondiente. Los datos de cada empresa están aislados de los del resto.
          </p>
          <h2>Proveedores</h2>
          <p>Para prestar el servicio usamos proveedores de alojamiento, base de datos y modelos de IA con las garantías exigidas por la normativa. La lista actualizada está disponible a petición.</p>
          <h2>Tus derechos</h2>
          <p>Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a {l.email}. También puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).</p>
        </Prose>
      </Section>
    </>
  );
}
