import { NotFoundError } from "@dtn/db";
import { uuidParam, withApi } from "@/lib/api/http";
import { db } from "@/lib/db";

export const GET = withApi<{ id: string }>("workflows:read", async ({ principal }, { id }) => {
  const { rows } = await db().query(
    `select id, workflow_id, version, status, trigger, input, output, error, created_at, started_at, finished_at, next_wake_at,
            (select coalesce(jsonb_object_agg(k, jsonb_build_object('status', v->'status', 'error', v->'error')), '{}'::jsonb)
             from jsonb_each(state->'nodes') as n(k, v)) as nodes
     from public.workflow_runs where id = $1 and organization_id = $2`,
    [uuidParam(id), principal.organizationId],
  );
  if (!rows[0]) throw new NotFoundError("Workflow run");
  return { data: rows[0] };
});
