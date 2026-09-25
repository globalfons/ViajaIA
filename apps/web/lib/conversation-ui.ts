export const CONV_STATUS: Record<string, { label: string; variant: "success" | "warning" | "danger" | "secondary" | "default" }> = {
  open: { label: "IA atendiendo", variant: "success" },
  escalated: { label: "Escalada", variant: "warning" },
  human: { label: "Humano", variant: "default" },
  closed: { label: "Cerrada", variant: "secondary" },
};

export const PRIORITY: Record<string, { label: string; variant: "success" | "warning" | "danger" | "secondary" | "default" }> = {
  low: { label: "Baja", variant: "secondary" },
  normal: { label: "Normal", variant: "secondary" },
  high: { label: "Alta", variant: "warning" },
  urgent: { label: "Urgente", variant: "danger" },
};
