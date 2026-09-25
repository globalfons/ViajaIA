"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LimitExceededError, type RetrievedChunk } from "@dtn/core";
import {
  addFileDocument,
  addUrlDocument,
  createAgentRuntime,
  createKnowledgeBase,
  deleteDocument,
  KnowledgeError,
  NotFoundError,
  OrganizationSuspendedError,
  reindexDocument,
  searchKnowledge,
} from "@dtn/db";
import { blobs } from "@/lib/blobs";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/session";

const uuid = z.string().uuid();

function message(e: unknown): string {
  if (e instanceof KnowledgeError) return e.message;
  if (e instanceof LimitExceededError) return `Límite del plan alcanzado (${e.key}).`;
  if (e instanceof OrganizationSuspendedError) return "La organización está suspendida.";
  if (e instanceof NotFoundError) return "No encontrado.";
  return "Error inesperado.";
}

export async function createKnowledgeBaseAction(form: FormData) {
  const s = await requireOrg("knowledge.write");
  const parsed = z
    .object({ name: z.string().trim().min(1).max(120), description: z.string().max(1000).optional(), embeddingModel: z.string().min(3).max(200) })
    .safeParse({ name: form.get("name"), description: form.get("description") ?? undefined, embeddingModel: form.get("embeddingModel") });
  if (!parsed.success) redirect("/knowledge?error=Datos%20no%20v%C3%A1lidos");
  let id: string;
  try {
    id = (await createKnowledgeBase(db(), s.org.id, parsed.data, s.userId)).id;
  } catch (e) {
    redirect(`/knowledge?error=${encodeURIComponent(message(e))}`);
  }
  revalidatePath("/knowledge");
  redirect(`/knowledge/${id}`);
}

export interface UploadResult {
  uploaded: string[];
  errors: { file: string; error: string }[];
}

export async function uploadDocumentsAction(_: UploadResult | null, form: FormData): Promise<UploadResult> {
  const s = await requireOrg("knowledge.write");
  const kbId = uuid.parse(form.get("kbId"));
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const result: UploadResult = { uploaded: [], errors: [] };
  if (!files.length) return { uploaded: [], errors: [{ file: "—", error: "Selecciona al menos un fichero" }] };
  for (const file of files.slice(0, 20)) {
    try {
      await addFileDocument(db(), blobs(), s.org.id, kbId, { filename: file.name, mimeType: file.type || null, bytes: new Uint8Array(await file.arrayBuffer()) }, s.userId);
      result.uploaded.push(file.name);
    } catch (e) {
      result.errors.push({ file: file.name, error: message(e) });
    }
  }
  revalidatePath(`/knowledge/${kbId}`);
  return result;
}

export async function addUrlAction(form: FormData) {
  const s = await requireOrg("knowledge.write");
  const kbId = uuid.parse(form.get("kbId"));
  try {
    await addUrlDocument(db(), s.org.id, kbId, String(form.get("url") ?? "").trim(), s.userId);
  } catch (e) {
    redirect(`/knowledge/${kbId}?error=${encodeURIComponent(message(e))}`);
  }
  revalidatePath(`/knowledge/${kbId}`);
  redirect(`/knowledge/${kbId}?ok=url`);
}

export async function documentAction(form: FormData) {
  const s = await requireOrg("knowledge.write");
  const kbId = uuid.parse(form.get("kbId"));
  const docId = uuid.parse(form.get("documentId"));
  const op = form.get("op");
  try {
    if (op === "delete") await deleteDocument(db(), blobs(), s.org.id, docId);
    else await reindexDocument(db(), s.org.id, docId);
  } catch (e) {
    redirect(`/knowledge/${kbId}?error=${encodeURIComponent(message(e))}`);
  }
  revalidatePath(`/knowledge/${kbId}`);
  redirect(`/knowledge/${kbId}?ok=${op === "delete" ? "deleted" : "reindex"}`);
}

export async function searchKnowledgeAction(kbId: string, query: string): Promise<{ hits?: RetrievedChunk[]; error?: string }> {
  const s = await requireOrg("knowledge.read");
  const id = uuid.safeParse(kbId);
  if (!id.success || !query.trim()) return { error: "Consulta no válida" };
  try {
    const { router } = await createAgentRuntime({ db: db() });
    return { hits: await searchKnowledge(db(), router, s.org.id, [id.data], query.slice(0, 1000), { k: 8 }) };
  } catch (e) {
    return { error: e instanceof Error && /not configured/.test(e.message) ? "El proveedor de embeddings no está configurado (API key)." : message(e) };
  }
}
