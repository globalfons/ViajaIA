export const SUB_STATUS: Record<string, { label: string; variant: "success" | "warning" | "danger" | "secondary" }> = {
  active: { label: "Activa", variant: "success" },
  trialing: { label: "En prueba", variant: "success" },
  past_due: { label: "Pago pendiente", variant: "warning" },
  unpaid: { label: "Impagada", variant: "danger" },
  canceled: { label: "Cancelada", variant: "secondary" },
  incomplete: { label: "Incompleta", variant: "warning" },
  incomplete_expired: { label: "Caducada", variant: "secondary" },
};
