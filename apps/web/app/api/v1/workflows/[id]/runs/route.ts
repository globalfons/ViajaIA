import { startWorkflowRun } from "@dtn/db";
import { readJson, uuidParam, withApi } from "@/lib/api/http";
import { startWorkflowRunBody } from "@/lib/api/schemas";
import { db } from "@/lib/db";

/** Starts the PUBLISHED version asynchronously. Poll GET /workflow-runs/{id}. */
export const POST = withApi<{ id: string }>("workflows:run", async ({ principal, req }, { id }) => {
  const body = await readJson(req, startWorkflowRunBody);
  const { runId, version } = await startWorkflowRun(db(), principal.organizationId, uuidParam(id), body.input ?? {}, { trigger: "api" });
  return Response.json({ run_id: runId, version, status: "queued" }, { status: 202 });
});
