import { listWorkflows } from "@dtn/db";
import { withApi } from "@/lib/api/http";
import { db } from "@/lib/db";

export const GET = withApi("workflows:read", async ({ principal }) => ({ data: await listWorkflows(db(), principal.organizationId) }));
