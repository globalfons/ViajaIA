import { getWorkflow, getWorkflowGraph } from "@dtn/db";
import { uuidParam, withApi } from "@/lib/api/http";
import { db } from "@/lib/db";

export const GET = withApi<{ id: string }>("workflows:read", async ({ principal }, { id }) => {
  const wf = await getWorkflow(db(), principal.organizationId, uuidParam(id));
  const graph = await getWorkflowGraph(db(), principal.organizationId, wf.id, wf.published_version ?? wf.latest_version);
  return { data: { ...wf, graph } };
});
