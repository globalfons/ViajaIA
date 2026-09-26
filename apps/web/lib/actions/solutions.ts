"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSolution, LimitExceededError } from "@dtn/core";
import { activateSolution, OrganizationSuspendedError, SolutionError, getPool } from "@dtn/db";
import { recordAudit } from "@/lib/audit";
import { requireOrg } from "@/lib/session";

export async function activateSolutionAction(form: FormData) {
  const s = await requireOrg("agents.write");
  const key = z.string().regex(/^[a-z_]{2,40}$/).parse(form.get("solutionKey"));
  const solution = getSolution(key);
  if (!solution) redirect("/solutions?error=Soluci%C3%B3n%20desconocida");
  const config: Record<string, string> = {};
  for (const f of solution.config) config[f.key] = String(form.get(`cfg_${f.key}`) ?? "");
  const origins = String(form.get("origins") ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);
  let result: Awaited<ReturnType<typeof activateSolution>>;
  try {
    for (const o of origins) if (new URL(o).protocol !== "https:") throw new SolutionError("Las webs permitidas deben ser https");
    result = await activateSolution(
      getPool(),
      s.org.id,
      {
        solutionKey: key,
        model: String(form.get("model") ?? ""),
        embeddingModel: (form.get("embeddingModel") as string | null) || null,
        config,
        name: String(form.get("name") ?? ""),
        allowedOrigins: origins,
      },
      s.userId,
    );
  } catch (e) {
    const msg =
      e instanceof SolutionError
        ? e.message
        : e instanceof LimitExceededError
          ? `Límite del plan alcanzado (${e.key})`
          : e instanceof OrganizationSuspendedError
            ? "La organización está suspendida"
            : "No se pudo activar la solución";
    redirect(`/solutions/${key}?error=${encodeURIComponent(msg)}`);
  }
  await recordAudit({ organizationId: s.org.id, actorId: s.userId, action: "solution.activate", targetType: "solution_instances", targetId: result.instanceId, metadata: { solution: key } });
  revalidatePath("/solutions");
  redirect(`/solutions?activated=${result.instanceId}`);
}
