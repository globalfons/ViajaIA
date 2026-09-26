import type { LimitExceededError } from "@dtn/core";

/** User-facing text for a plan limit, distinguishing "blocked" from "waiting for admin approval". */
export function limitMessage(e: LimitExceededError): string {
  return e.name === "LimitApprovalRequiredError"
    ? `Límite del plan alcanzado (${e.key}). Se ha pedido aprobación al administrador de la plataforma.`
    : `Límite del plan alcanzado (${e.key}).`;
}
