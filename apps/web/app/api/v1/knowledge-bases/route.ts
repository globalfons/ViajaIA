import { withApi } from "@/lib/api/http";
import { db } from "@/lib/db";

export const GET = withApi("knowledge:read", async ({ principal }) => {
  const { rows } = await db().query(
    `select kb.id, kb.name, kb.description, kb.embedding_model, kb.created_at,
            count(d.id)::int as documents, count(d.id) filter (where d.status = 'ready')::int as ready
     from public.knowledge_bases kb left join public.documents d on d.knowledge_base_id = kb.id
     where kb.organization_id = $1 group by kb.id order by kb.created_at desc`,
    [principal.organizationId],
  );
  return { data: rows };
});
