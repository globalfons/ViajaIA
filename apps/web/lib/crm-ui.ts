export const STAGE_LABEL: Record<string, string> = {
  NEW: "Nuevo",
  QUALIFIED: "Cualificado",
  CONTACTED: "Contactado",
  MEETING: "Reunión",
  PROPOSAL: "Propuesta",
  WON: "Ganado",
  LOST: "Perdido",
};
export const LAWFUL_BASIS_LABEL: Record<string, string> = {
  inbound_request: "Solicitud del propio interesado",
  consent: "Consentimiento",
  contract: "Relación contractual",
  legitimate_interest: "Interés legítimo (documentado)",
};
export const SOURCE_LABEL: Record<string, string> = { web: "Web", whatsapp: "WhatsApp", email: "Email", api: "API", manual: "Manual", agent: "Agente IA", import: "Importación" };
export const OPPORTUNITY_STATUS_LABEL: Record<string, string> = { open: "Abierta", won: "Ganada", lost: "Perdida" };
export const eur = (v: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
