import { resumeAgentRun } from "@dtn/db";
import { readJson, uuidParam, withApi } from "@/lib/api/http";
import { presentRun } from "@/lib/api/presenters";
import { decisionBody } from "@/lib/api/schemas";
import { db } from "@/lib/db";

export const maxDuration = 120;

/** Approves or rejects the pending tool call of a paused run. */
export const POST = withApi<{ id: string }>("agents:run", async ({ principal, req, requestId }, { id }) => {
  const body = await readJson(req, decisionBody);
  const { runId, result } = await resumeAgentRun({
    db: db(),
    organizationId: principal.organizationId,
    runId: uuidParam(id),
    approved: body.approved,
    note: body.note,
    runtime: { requestId },
  });
  return presentRun(runId, result);
});
