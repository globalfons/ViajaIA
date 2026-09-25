import { archiveAgent, getAgent, updateAgent } from "@dtn/db";
import { readJson, uuidParam, withApi } from "@/lib/api/http";
import { presentAgent } from "@/lib/api/presenters";
import { updateAgentBody } from "@/lib/api/schemas";
import { db } from "@/lib/db";

type P = { id: string };

export const GET = withApi<P>("agents:read", async ({ principal }, { id }) => ({
  data: presentAgent(await getAgent(db(), principal.organizationId, uuidParam(id))),
}));

export const PATCH = withApi<P>("agents:write", async ({ principal, req }, { id }) => {
  const body = await readJson(req, updateAgentBody);
  const agentId = uuidParam(id);
  const current = await getAgent(db(), principal.organizationId, agentId);
  const agent = await updateAgent(db(), principal.organizationId, agentId, {
    name: body.name,
    description: body.description,
    status: body.status,
    config: body.config ? { ...current.config, ...body.config } : undefined,
  });
  return { data: presentAgent(agent) };
});

export const DELETE = withApi<P>("agents:write", async ({ principal }, { id }) => {
  await archiveAgent(db(), principal.organizationId, uuidParam(id));
  return new Response(null, { status: 204 });
});
