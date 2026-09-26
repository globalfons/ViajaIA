import { getSolution, SOLUTIONS, type SolutionDefinition } from "@dtn/core/solutions/catalog";

/**
 * Public website content. Every capability listed here maps to a solution of
 * the real catalog (packages/core/src/solutions/catalog.ts). No clients,
 * testimonials, figures or results are invented; examples are labelled as such.
 */

export interface SiteSolution {
  slug: string;
  title: string;
  kicker: string;
  headline: string;
  intro: string;
  catalogKeys: string[];
  problems: string[];
  howItWorks: string[];
  limits: string[];
}

export const SITE_SOLUTIONS: SiteSolution[] = [
  {
    slug: "customer-support",
    title: "Atención al cliente con IA",
    kicker: "Customer Support",
    headline: "Respuestas al momento, con la información de tu negocio.",
    intro: "Un asistente que responde con tu documentación, sabe cuándo no está seguro y pasa la conversación a tu equipo con todo el contexto.",
    catalogKeys: ["customer_support", "receptionist"],
    problems: ["Preguntas repetidas que consumen horas del equipo", "Clientes que escriben fuera de horario y no reciben respuesta", "Respuestas distintas según quién conteste"],
    howItWorks: [
      "Subes tu documentación (PDF, Word, web, FAQs) y queda indexada solo para tu empresa.",
      "El asistente responde citando la fuente y mide su confianza en cada respuesta.",
      "Si la confianza es baja, hay una reclamación o el cliente pide una persona, la conversación pasa a tu equipo.",
      "Ves cada conversación, su coste y lo que ha hecho el asistente.",
    ],
    limits: ["No inventa información que no esté en tu documentación: si no la tiene, lo dice y deriva.", "No toma decisiones sensibles (devoluciones, datos personales) sin una persona."],
  },
  {
    slug: "ventas",
    title: "Ventas y cualificación de leads",
    kicker: "Sales",
    headline: "Atiende a cada interesado y detecta a los que están listos para comprar.",
    intro: "Responde a quien te contacta, entiende qué necesita, puntúa el lead y lo registra en el CRM para que tu equipo comercial priorice.",
    catalogKeys: ["sales_agent", "lead_qualification"],
    problems: ["Leads que se enfrían porque nadie responde a tiempo", "Comerciales que dedican tiempo a contactos que no encajan", "Información del lead dispersa en correos y notas"],
    howItWorks: [
      "El asistente conversa con la persona que ha contactado y resuelve dudas con tu catálogo.",
      "Cualifica con criterios BANT (presupuesto, autoridad, necesidad y plazo) y asigna una puntuación.",
      "El lead queda en el pipeline con la conversación, las notas y las tareas para tu equipo.",
      "Los leads calientes se pueden pasar a un comercial con aprobación previa.",
    ],
    limits: ["Solo conversa con quien ha contactado o ha dado su consentimiento: no hace prospección en frío ni envíos masivos.", "Registra la base legal (RGPD) de cada lead."],
  },
  {
    slug: "whatsapp",
    title: "Agente de WhatsApp",
    kicker: "WhatsApp Business",
    headline: "Tu negocio responde por WhatsApp, también a las 11 de la noche.",
    intro: "Conectado a la API oficial de WhatsApp Business (Meta): responde con mensajes breves, reconoce cuándo hace falta una persona y tu equipo puede continuar la conversación desde el panel.",
    catalogKeys: ["whatsapp_agent"],
    problems: ["Mensajes de WhatsApp sin responder", "Teléfonos personales usados para atender a clientes", "Sin histórico ni control de lo que se contesta"],
    howItWorks: [
      "Conectamos tu número de WhatsApp Business mediante la API oficial de Meta.",
      "Cada mensaje entrante llega firmado y lo responde el agente con tu información.",
      "Las fotos, audios o casos delicados pasan directamente a tu equipo.",
      "Tu equipo responde desde el panel y el mensaje sale por WhatsApp.",
    ],
    limits: ["Solo responde a conversaciones iniciadas por el cliente (ventana de 24 h de WhatsApp): no envía campañas ni mensajes no solicitados.", "Necesita una cuenta de WhatsApp Business verificada en Meta."],
  },
  {
    slug: "documentos",
    title: "Asistente de documentos y conocimiento interno",
    kicker: "Documentos / RAG",
    headline: "Pregunta a tus documentos y obtén respuestas con la fuente.",
    intro: "Para clientes o para tu propio equipo: manuales, procedimientos, contratos y políticas consultables en lenguaje natural, con cita de cada fuente.",
    catalogKeys: ["document_assistant", "internal_knowledge"],
    problems: ["Información importante perdida en carpetas y PDFs", "Nuevos empleados que preguntan siempre lo mismo", "Tiempo buscando la versión correcta de un procedimiento"],
    howItWorks: [
      "Subes documentos (PDF con texto, DOCX, TXT, Markdown, CSV) o páginas web.",
      "Se trocean e indexan con búsqueda semántica y por palabras, aislados por empresa.",
      "El asistente responde solo con esos fragmentos y cita cada fuente como [n].",
      "Puedes reindexar o borrar documentos cuando cambien.",
    ],
    limits: ["Los PDFs escaneados (imagen sin texto) todavía no se leen: hace falta un PDF con texto.", "Si la respuesta no está en los documentos, lo dice."],
  },
  {
    slug: "marketing",
    title: "Contenido de marketing asistido",
    kicker: "Marketing",
    headline: "Borradores con la voz de tu marca, revisados siempre por una persona.",
    intro: "Genera borradores de publicaciones, correos y anuncios a partir de tu información y tono de marca. Nada se publica ni se envía solo.",
    catalogKeys: ["marketing_agent"],
    problems: ["Falta de tiempo para crear contenido con constancia", "Textos que no suenan a tu marca", "Ideas dispersas sin un punto de partida"],
    howItWorks: [
      "Describes tu marca, tu público y tu tono (o lo toma de tu documentación).",
      "Pides el borrador: publicación, correo, anuncio o artículo.",
      "Una persona revisa, edita y decide qué se usa.",
    ],
    limits: ["No publica en redes ni envía correos: todo es un borrador.", "Evita afirmaciones no verificables y no usa datos personales de clientes."],
  },
  {
    slug: "automatizacion",
    title: "Automatización de procesos y citas",
    kicker: "Workflows",
    headline: "Procesos que se ejecutan solos, con aprobación humana donde importa.",
    intro: "Flujos visuales que combinan agentes de IA, condiciones, esperas, webhooks y aprobaciones. También citas: el agente consulta tu Google Calendar y reserva en tu horario.",
    catalogKeys: ["workflow_automation", "appointment_agent"],
    problems: ["Tareas repetitivas entre herramientas", "Procesos que dependen de que alguien se acuerde", "Citas gestionadas a mano por teléfono"],
    howItWorks: [
      "Diseñamos el flujo en el editor visual: disparador, pasos de IA, condiciones y aprobaciones.",
      "Cada ejecución queda registrada paso a paso, con reintentos y trazabilidad.",
      "Los pasos sensibles esperan a que una persona los apruebe.",
      "Para citas: el agente ofrece huecos reales de tu calendario y reserva cuando el cliente confirma.",
    ],
    limits: ["Microsoft Calendar todavía no está disponible (sí Google Calendar).", "Las integraciones externas usan tus credenciales, guardadas cifradas."],
  },
];

export function getSiteSolution(slug: string) {
  return SITE_SOLUTIONS.find((s) => s.slug === slug);
}

export function catalogFor(site: SiteSolution): SolutionDefinition[] {
  return site.catalogKeys.map((k) => getSolution(k)).filter((s): s is SolutionDefinition => Boolean(s));
}

export const CHANNEL_LABEL: Record<string, string> = { web: "Chat web", whatsapp: "WhatsApp", email: "Email", voice: "Voz", internal: "Uso interno" };

export interface Sector {
  slug: string;
  name: string;
  intro: string;
  examples: string[];
  solutions: string[];
}

/** Illustrative scenarios per sector (not client references). */
export const SECTORS: Sector[] = [
  { slug: "salud", name: "Clínicas y salud", intro: "Centros médicos, dentales, fisioterapia y bienestar.", examples: ["Responder horarios, tratamientos y preparación de pruebas", "Reservar citas en el calendario del centro", "Pasar a recepción las consultas clínicas o delicadas"], solutions: ["customer-support", "automatizacion", "whatsapp"] },
  { slug: "formacion", name: "Academias y formación", intro: "Academias, centros de idiomas, formación profesional y online.", examples: ["Informar de cursos, precios publicados y calendarios", "Cualificar a los interesados y registrar el lead", "Resolver dudas de alumnos con la documentación del curso"], solutions: ["ventas", "customer-support", "documentos"] },
  { slug: "inmobiliaria", name: "Inmobiliarias", intro: "Agencias de compraventa y alquiler.", examples: ["Responder a interesados en un inmueble al momento", "Cualificar presupuesto y plazos antes de la visita", "Organizar visitas con el calendario del agente"], solutions: ["ventas", "whatsapp", "automatizacion"] },
  { slug: "despachos", name: "Despachos y servicios profesionales", intro: "Asesorías, gestorías, abogados y consultoras.", examples: ["Primera atención y recogida de datos del caso", "Consulta interna de procedimientos y plantillas", "Borradores de comunicaciones para revisión"], solutions: ["customer-support", "documentos", "marketing"] },
  { slug: "comercio", name: "Comercio y e-commerce", intro: "Tiendas físicas y online.", examples: ["Dudas sobre productos, envíos y devoluciones", "Atención por WhatsApp y email con el mismo criterio", "Borradores de campañas y fichas de producto"], solutions: ["customer-support", "whatsapp", "marketing"] },
  { slug: "hosteleria", name: "Hostelería y turismo", intro: "Restaurantes, alojamientos y actividades.", examples: ["Responder sobre horarios, menús y servicios", "Gestionar peticiones de reserva con confirmación", "Atender en varios idiomas"], solutions: ["customer-support", "whatsapp", "automatizacion"] },
];

export const ALL_SOLUTIONS = SOLUTIONS;
