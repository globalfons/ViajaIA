import { z } from "zod";
import { createAgentRuntime, getKnowledgeBase, searchKnowledge } from "@dtn/db";
import { readJson, uuidParam, withApi } from "@/lib/api/http";
import { db } from "@/lib/db";

export const POST = withApi<{ id: string }>("knowledge:read", async ({ principal, req }, { id }) => {
  const body = await readJson(req, z.object({ query: z.string().min(1).max(1000), k: z.number().int().min(1).max(20).optional() }));
  const kb = await getKnowledgeBase(db(), principal.organizationId, uuidParam(id));
  const { router } = await createAgentRuntime({ db: db() });
  const hits = await searchKnowledge(db(), router, principal.organizationId, [kb.id], body.query, { k: body.k });
  return { data: hits.map((h) => ({ id: h.id, document_id: h.documentId, title: h.title, content: h.content, score: h.score })) };
});
