import "server-only";
import { headers } from "next/headers";
import { captureError } from "@dtn/core";
import { createSupabaseAdminClient } from "./supabase/admin";

export interface AuditEntry {
  organizationId: string | null;
  actorId: string | null;
  actorType?: "user" | "system" | "agent" | "platform_admin";
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Explicit audit entries for privileged actions performed with the service
 * role (row triggers cannot see the acting user in that case).
 */
export async function recordAudit(e: AuditEntry): Promise<void> {
  try {
    const requestId = (await headers()).get("x-request-id");
    const { error } = await createSupabaseAdminClient()
      .from("audit_logs")
      .insert({
        organization_id: e.organizationId,
        actor_id: e.actorId,
        actor_type: e.actorType ?? "user",
        action: e.action,
        target_type: e.targetType ?? null,
        target_id: e.targetId ?? null,
        metadata: e.metadata ?? {},
        request_id: requestId,
      });
    if (error) throw new Error(error.message);
  } catch (err) {
    captureError(err, { organizationId: e.organizationId ?? undefined, action: e.action });
  }
}
