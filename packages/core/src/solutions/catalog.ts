import type { WorkflowGraph } from "../workflows/schema";

/**
 * Solutions catalog: sellable products built from reusable pieces.
 * "Activating" a solution for an organization provisions its agent(s),
 * knowledge base, workflow and channel from this definition; per-client
 * customization lives in configuration (variables), never in code.
 */

export const SOLUTION_CATEGORIES = ["SALES", "SUPPORT", "MARKETING", "OPERATIONS", "DOCUMENTS", "COMMUNICATION", "AUTOMATION", "KNOWLEDGE"] as const;
export type SolutionCategory = (typeof SOLUTION_CATEGORIES)[number];

export interface SolutionConfigField {
  key: string; // becomes a prompt variable: {{key}}
  label: string;
  type: "text" | "textarea";
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface SolutionDefinition {
  key: string;
  /** Stable identifier for sales/ops: SOL-<KEY>-v<version>. */
  templateId: string;
  version: number;
  name: string;
  category: SolutionCategory;
  tagline: string;
  description: string;
  useCase: string;
  agents: { role: string; templateKey: string; name: string }[];
  knowledgeBase: boolean;
  workflow?: { name: string; description: string; build: (agents: Record<string, string>) => WorkflowGraph };
  tools: string[];
  channels: ("web" | "whatsapp" | "email" | "api" | "internal")[];
  /** Channel created on activation (only channels implemented today). */
  provisionChannel?: "web";
  requirements: string[];
  /** Integrations that must be configured before the solution is fully operational. */
  needsIntegrations: ("whatsapp" | "email" | "calendar")[];
  config: SolutionConfigField[];
}

const BUSINESS: SolutionConfigField[] = [
  { key: "business_description", label: "¿Qué hace el negocio?", type: "textarea", required: true, placeholder: "Clínica dental en Valencia: implantes, ortodoncia invisible, limpiezas…" },
  { key: "business_hours", label: "Horario", type: "text", required: false, placeholder: "L-V 9:00-14:00 y 16:00-20:00" },
  { key: "contact_channel", label: "Cómo contactar con una persona", type: "text", required: false, placeholder: "Teléfono 96 000 00 00 o recepcion@clinica.es" },
];

const node = (id: string, type: string, data: Record<string, unknown>, x: number, y: number) => ({ id, type: type as never, position: { x, y }, data });
const edge = (source: string, target: string, sourceHandle: string | null = null) => ({ id: `${source}-${target}${sourceHandle ? `-${sourceHandle}` : ""}`, source, target, sourceHandle });

export const SOLUTIONS: SolutionDefinition[] = [
  {
    key: "customer_support",
    templateId: "SOL-CUSTOMER-SUPPORT-v1",
    version: 1,
    name: "AI Customer Support",
    category: "SUPPORT",
    tagline: "Responde consultas con la documentación del cliente y escala a su equipo cuando no está seguro.",
    description:
      "Agente de soporte con knowledge base propia, control de confianza y escalado a una persona. Incluye chat web listo para incrustar y un workflow de revisión humana para consultas delicadas.",
    useCase: "Una clínica recibe cada día preguntas sobre horarios, tratamientos y citas: el agente responde las habituales y pasa el resto a recepción.",
    agents: [{ role: "support", templateKey: "customer_support", name: "Soporte" }],
    knowledgeBase: true,
    workflow: {
      name: "Revisión de consultas delicadas",
      description: "El agente responde; si la confianza es baja, una persona revisa antes de cerrar.",
      build: (a) => ({
        nodes: [
          node("start", "start", { label: "Consulta" }, 0, 120),
          node("answer", "agent", { label: "Responder", agentId: a.support, message: "{{input.message}}" }, 220, 120),
          node("confident", "condition", { label: "¿Confianza suficiente?", rules: [{ left: "{{nodes.answer.output.structured.confidence}}", op: "gte", right: 0.6 }] }, 460, 120),
          node("review", "approval", { label: "Revisión humana", title: "Revisar respuesta a: {{input.message}}", payload: "{{nodes.answer.output.structured.answer}}" }, 700, 220),
          node("done", "end", { label: "Respondida", output: { answer: "{{nodes.answer.output.structured.answer}}" } }, 940, 120),
        ],
        edges: [edge("start", "answer"), edge("answer", "confident"), edge("confident", "done", "true"), edge("confident", "review", "false"), edge("review", "done", "approved")],
      }),
    },
    tools: ["current_datetime"],
    channels: ["web", "whatsapp", "email"],
    provisionChannel: "web",
    requirements: ["Un modelo de chat activo", "Un modelo de embeddings activo (1536 dimensiones)", "Documentación del negocio para la knowledge base"],
    needsIntegrations: [],
    config: BUSINESS,
  },
  {
    key: "receptionist",
    templateId: "SOL-RECEPTIONIST-v1",
    version: 1,
    name: "AI Receptionist",
    category: "OPERATIONS",
    tagline: "Recepción virtual 24/7: horarios, servicios, ubicación y recogida de datos para devolver la llamada.",
    description: "Informa con la documentación del negocio y recoge nombre, motivo y contacto cuando la persona quiere hablar con alguien.",
    useCase: "Una peluquería deja de perder consultas fuera de horario: el asistente informa y deja los datos al equipo.",
    agents: [{ role: "reception", templateKey: "receptionist", name: "Recepción" }],
    knowledgeBase: true,
    tools: ["current_datetime", "crm_capture_lead", "crm_create_task"],
    channels: ["web", "whatsapp"],
    provisionChannel: "web",
    requirements: ["Un modelo de chat activo", "Un modelo de embeddings activo (1536 dimensiones)"],
    needsIntegrations: [],
    config: BUSINESS,
  },
  {
    key: "sales_agent",
    templateId: "SOL-SALES-AGENT-v1",
    version: 1,
    name: "AI Sales Agent",
    category: "SALES",
    tagline: "Atiende leads entrantes, explica la oferta y propone el siguiente paso. Nunca contacta sin consentimiento.",
    description: "Ventas consultivas para leads inbound con cualificación, puntuación y derivación a un comercial.",
    useCase: "Una academia responde al momento a quien pide información desde la web y deriva los interesados a un asesor.",
    agents: [{ role: "sales", templateKey: "sales_agent", name: "Ventas" }],
    knowledgeBase: true,
    workflow: {
      name: "Cualificación y derivación",
      description: "Puntúa el lead y, si es caliente, pide aprobación para pasarlo a un comercial.",
      build: (a) => ({
        nodes: [
          node("start", "start", { label: "Lead" }, 0, 120),
          node("qualify", "agent", { label: "Cualificar", agentId: a.sales, message: "Lead: {{input.name}} ({{input.email}}). Mensaje: {{input.message}}" }, 220, 120),
          node("hot", "condition", { label: "¿Puntuación ≥ 70?", rules: [{ left: "{{nodes.qualify.output.structured.score}}", op: "gte", right: 70 }] }, 460, 120),
          node("handoff", "approval", { label: "Pasar a comercial", title: "Lead caliente: {{input.name}}", payload: "{{nodes.qualify.output.structured}}" }, 700, 40),
          node("won", "end", { label: "Derivado", output: { stage: "handoff" } }, 940, 40),
          node("nurture", "end", { label: "Seguimiento", output: { stage: "nurture" } }, 700, 220),
        ],
        edges: [edge("start", "qualify"), edge("qualify", "hot"), edge("hot", "handoff", "true"), edge("hot", "nurture", "false"), edge("handoff", "won", "approved")],
      }),
    },
    tools: ["current_datetime", "crm_capture_lead", "crm_add_note", "crm_create_task"],
    channels: ["web", "whatsapp", "email"],
    provisionChannel: "web",
    requirements: ["Un modelo de chat activo", "Un modelo de embeddings activo (1536 dimensiones)", "Catálogo o servicios del cliente en la knowledge base"],
    needsIntegrations: [],
    config: [
      ...BUSINESS,
      { key: "ideal_customer", label: "Cliente ideal", type: "textarea", required: false, placeholder: "Empresas de 10-50 empleados en España que…" },
    ],
  },
  {
    key: "lead_qualification",
    templateId: "SOL-LEAD-QUALIFICATION-v1",
    version: 1,
    name: "AI Lead Qualification",
    category: "SALES",
    tagline: "Cualifica leads con BANT (presupuesto, autoridad, necesidad y plazo) y los puntúa de 0 a 100.",
    description: "Hace pocas preguntas por mensaje, puntúa el encaje y prepara la ficha para el comercial.",
    useCase: "Una consultora recibe 200 formularios al mes y quiere que sus comerciales solo llamen a los cualificados.",
    agents: [{ role: "qualifier", templateKey: "lead_qualification", name: "Cualificación" }],
    knowledgeBase: false,
    tools: ["crm_capture_lead", "crm_add_note"],
    channels: ["web", "email", "api"],
    provisionChannel: "web",
    requirements: ["Un modelo de chat activo"],
    needsIntegrations: [],
    config: [BUSINESS[0]!, { key: "ideal_customer", label: "Cliente ideal", type: "textarea", required: true, placeholder: "Sector, tamaño, presupuesto mínimo…" }],
  },
  {
    key: "whatsapp_agent",
    templateId: "SOL-WHATSAPP-AGENT-v1",
    version: 1,
    name: "AI WhatsApp Agent",
    category: "COMMUNICATION",
    tagline: "Atención por WhatsApp Business con mensajes breves y escalado a humano.",
    description: "El mismo motor de soporte con knowledge base, adaptado al estilo de WhatsApp. Requiere conectar un número de WhatsApp Business.",
    useCase: "Una tienda atiende pedidos y dudas por WhatsApp sin tener a alguien pendiente del móvil todo el día.",
    agents: [{ role: "whatsapp", templateKey: "whatsapp_agent", name: "WhatsApp" }],
    knowledgeBase: true,
    tools: ["current_datetime"],
    channels: ["whatsapp"],
    requirements: ["Un modelo de chat activo", "Un modelo de embeddings activo (1536 dimensiones)", "Número de WhatsApp Business (Cloud API de Meta)"],
    needsIntegrations: ["whatsapp"],
    config: BUSINESS,
  },
  {
    key: "document_assistant",
    templateId: "SOL-DOCUMENT-ASSISTANT-v1",
    version: 1,
    name: "AI Document Assistant",
    category: "DOCUMENTS",
    tagline: "Preguntas y respuestas sobre los documentos del cliente, siempre con la fuente citada.",
    description: "Sube contratos, manuales o normativas y consulta en lenguaje natural con citas a los fragmentos usados.",
    useCase: "Un despacho consulta rápidamente cláusulas de sus plantillas de contrato.",
    agents: [{ role: "docs", templateKey: "document_assistant", name: "Documentos" }],
    knowledgeBase: true,
    tools: [],
    channels: ["web", "internal"],
    requirements: ["Un modelo de chat activo", "Un modelo de embeddings activo (1536 dimensiones)"],
    needsIntegrations: [],
    config: [BUSINESS[0]!],
  },
  {
    key: "internal_knowledge",
    templateId: "SOL-INTERNAL-KNOWLEDGE-v1",
    version: 1,
    name: "AI Internal Knowledge Assistant",
    category: "KNOWLEDGE",
    tagline: "El asistente interno de la empresa: procedimientos, políticas y FAQs para el equipo.",
    description: "Responde a empleados con los procedimientos internos y deriva a RR. HH. los temas sensibles.",
    useCase: "Una empresa de 40 personas centraliza su manual de procesos y deja de responder las mismas dudas.",
    agents: [{ role: "internal", templateKey: "internal_knowledge", name: "Conocimiento interno" }],
    knowledgeBase: true,
    tools: [],
    channels: ["internal"],
    requirements: ["Un modelo de chat activo", "Un modelo de embeddings activo (1536 dimensiones)"],
    needsIntegrations: [],
    config: [BUSINESS[0]!],
  },
  {
    key: "appointment_agent",
    templateId: "SOL-APPOINTMENT-AGENT-v1",
    version: 1,
    name: "AI Appointment Agent",
    category: "OPERATIONS",
    tagline: "Gestiona peticiones de cita confirmando fecha, hora y servicio antes de actuar.",
    description: "Hoy recoge y confirma los datos de la cita y requiere aprobación para cualquier acción; la reserva directa en Google/Microsoft Calendar llegará con esa integración.",
    useCase: "Un fisioterapeuta recibe peticiones de cita por la web con todos los datos ya confirmados.",
    agents: [{ role: "appointments", templateKey: "appointment_agent", name: "Citas" }],
    knowledgeBase: true,
    tools: ["current_datetime"],
    channels: ["web", "whatsapp"],
    provisionChannel: "web",
    requirements: ["Un modelo de chat activo", "Un modelo de embeddings activo (1536 dimensiones)"],
    needsIntegrations: ["calendar"],
    config: BUSINESS,
  },
  {
    key: "marketing_agent",
    templateId: "SOL-MARKETING-AGENT-v1",
    version: 1,
    name: "AI Marketing Agent",
    category: "MARKETING",
    tagline: "Borradores de posts, emails y anuncios con la voz de la marca, siempre para revisión humana.",
    description: "Genera contenido a partir de la guía de marca y la documentación del cliente. Nada se publica automáticamente.",
    useCase: "Un restaurante prepara cada semana sus posts y su newsletter en minutos.",
    agents: [{ role: "marketing", templateKey: "marketing_agent", name: "Marketing" }],
    knowledgeBase: true,
    tools: [],
    channels: ["internal"],
    requirements: ["Un modelo de chat activo", "Un modelo de embeddings activo (1536 dimensiones)", "Guía de marca o ejemplos en la knowledge base"],
    needsIntegrations: [],
    config: [BUSINESS[0]!, { key: "brand_voice", label: "Tono de marca", type: "textarea", required: false, placeholder: "Cercano, sin tecnicismos, tuteando…" }],
  },
  {
    key: "workflow_automation",
    templateId: "SOL-WORKFLOW-AUTOMATION-v1",
    version: 1,
    name: "AI Workflow Automation",
    category: "AUTOMATION",
    tagline: "Clasifica solicitudes entrantes, pide aprobación cuando toca y avisa a otros sistemas por webhook.",
    description: "Workflow base: el agente clasifica la solicitud, una persona aprueba las importantes y el resultado se envía al sistema del cliente.",
    useCase: "Una gestoría recibe solicitudes por API y las enruta según su tipo, con aprobación para las urgentes.",
    agents: [{ role: "classifier", templateKey: "customer_support", name: "Clasificador" }],
    knowledgeBase: false,
    workflow: {
      name: "Clasificación y enrutado",
      description: "Clasifica, pide aprobación si es una reclamación y termina con la categoría.",
      build: (a) => ({
        nodes: [
          node("start", "start", { label: "Solicitud" }, 0, 120),
          node("classify", "agent", { label: "Clasificar", agentId: a.classifier, message: "Clasifica y responde: {{input.message}}" }, 220, 120),
          node("claim", "condition", { label: "¿Reclamación?", rules: [{ left: "{{nodes.classify.output.structured.category}}", op: "eq", right: "reclamacion" }] }, 460, 120),
          node("approve", "approval", { label: "Aprobar", title: "Reclamación recibida", payload: "{{input.message}}" }, 700, 40),
          node("end", "end", { label: "Fin", output: { category: "{{nodes.classify.output.structured.category}}" } }, 940, 120),
        ],
        edges: [edge("start", "classify"), edge("classify", "claim"), edge("claim", "approve", "true"), edge("claim", "end", "false"), edge("approve", "end", "approved")],
      }),
    },
    tools: [],
    channels: ["api"],
    requirements: ["Un modelo de chat activo"],
    needsIntegrations: [],
    config: [BUSINESS[0]!],
  },
];

export function getSolution(key: string): SolutionDefinition | undefined {
  return SOLUTIONS.find((s) => s.key === key);
}
