import { addFileDocument, addUrlDocument, getKnowledgeBase, listDocuments } from "@dtn/db";
import { ApiError, uuidParam, withApi } from "@/lib/api/http";
import { blobs } from "@/lib/blobs";
import { db } from "@/lib/db";

type P = { id: string };

export const GET = withApi<P>("knowledge:read", async ({ principal }, { id }) => {
  const kb = await getKnowledgeBase(db(), principal.organizationId, uuidParam(id));
  return { data: await listDocuments(db(), principal.organizationId, kb.id) };
});

/** multipart/form-data with `file`, or JSON {"url": "https://…"}. Indexing is asynchronous. */
export const POST = withApi<P>("knowledge:write", async ({ principal, req }, { id }) => {
  const kbId = uuidParam(id);
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "invalid_request", "Missing file field");
    const doc = await addFileDocument(db(), blobs(), principal.organizationId, kbId, { filename: file.name, mimeType: file.type || null, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json({ data: doc }, { status: 202 });
  }
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
    if (typeof body?.url !== "string") throw new ApiError(400, "invalid_request", "Expected {\"url\": \"https://…\"}");
    return Response.json({ data: await addUrlDocument(db(), principal.organizationId, kbId, body.url) }, { status: 202 });
  }
  throw new ApiError(415, "unsupported_media_type", "Use multipart/form-data (file) or application/json (url)");
});
