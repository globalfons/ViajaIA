import { runAgent } from "@dtn/db";
import { readJson, uuidParam, withApi } from "@/lib/api/http";
import { presentRun } from "@/lib/api/presenters";
import { runAgentBody } from "@/lib/api/schemas";
import { db } from "@/lib/db";

export const maxDuration = 120;

/** Runs an ACTIVE agent. Paused runs (human approval) return status "needs_approval". */
export const POST = withApi<{ id: string }>("agents:run", async ({ principal, req, requestId }, { id }) => {
  const body = await readJson(req, runAgentBody);
  const { runId, result } = await runAgent({
    db: db(),
    organizationId: principal.organizationId,
    agentId: uuidParam(id),
    message: body.message,
    history: body.history,
    variables: body.variables,
    source: "api",
    runtime: { requestId },
  });
  return presentRun(runId, result);
});
