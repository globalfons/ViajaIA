import { createHash } from "node:crypto";
import {
  checkLimit,
  chunkText,
  detectKind,
  effectiveLimits,
  LimitExceededError,
  MAX_UPLOAD_BYTES,
  parseDocument,
  safeFetch,
  type LLMRouter,
  type OutboundPolicy,
  type RetrievedChunk,
  type UsageContext,
} from "@dtn/core";
import { assertOrgActive, NotFoundError } from "./agents";
import type { BlobStore } from "./blobstore";
import { enqueueJob } from "./jobs";
import type { Queryable } from "./pool";

/**
 * Knowledge bases (RAG). Pipeline:
 *   upload → store original → job "document.ingest" → parse → chunk → embed
 *   → pgvector + FTS → hybrid retrieval (app.search_chunks) → agent context.
 */

export const EMBEDDING_DIMENSIONS = 1536;

export class KnowledgeError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeError";
  }
}

export interface KnowledgeBaseRow {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  embedding_model: string;
  chunk_tokens: number;
  chunk_overlap: number;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  knowledge_base_id: string;
  title: string;
  source_type: string;
  source_uri: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  chunk_count: number;
  token_count: number;
  created_at: string;
  indexed_at: string | null;
}

async function limits(db: Queryable, organizationId: string) {
  const { rows } = await db.query<{ limits: unknown; plan_limits: unknown }>(
    "select o.limits, p.limits as plan_limits from public.organizations o left join public.plans p on p.code = o.plan_code where o.id = $1",
    [organizationId],
  );
  return effectiveLimits(rows[0]?.plan_limits, rows[0]?.limits);
}

export async function createKnowledgeBase(
  db: Queryable,
  organizationId: string,
  input: { name: string; description?: string; embeddingModel: string },
  userId?: string | null,
): Promise<KnowledgeBaseRow> {
  await assertOrgActive(db, organizationId);
  if (!/^(openai|anthropic|gemini|xai|deepseek|openrouter):.+/.test(input.embeddingModel)) throw new KnowledgeError("Invalid embedding model");
  const { rows: n } = await db.query<{ n: number }>("select count(*)::int n from public.knowledge_bases where organization_id = $1", [organizationId]);
  const l = checkLimit(await limits(db, organizationId), "max_knowledge_bases", n[0]!.n);
  if (!l.allowed) throw new LimitExceededError("max_knowledge_bases", l.limit!, l.used);
  const { rows } = await db.query<KnowledgeBaseRow>(
    `insert into public.knowledge_bases (organization_id, name, description, embedding_model, created_by)
     values ($1, $2, $3, $4, $5) returning id, organization_id, name, description, embedding_model, chunk_tokens, chunk_overlap, created_at`,
    [organizationId, input.name, input.description ?? "", input.embeddingModel, userId ?? null],
  );
  return rows[0]!;
}

export async function getKnowledgeBase(db: Queryable, organizationId: string, id: string): Promise<KnowledgeBaseRow> {
  const { rows } = await db.query<KnowledgeBaseRow>(
    "select id, organization_id, name, description, embedding_model, chunk_tokens, chunk_overlap, created_at from public.knowledge_bases where id = $1 and organization_id = $2",
    [id, organizationId],
  );
  if (!rows[0]) throw new NotFoundError("Knowledge base");
  return rows[0];
}

export async function listDocuments(db: Queryable, organizationId: string, kbId: string): Promise<DocumentRow[]> {
  const { rows } = await db.query<DocumentRow>(
    `select id, knowledge_base_id, title, source_type, source_uri, storage_path, mime_type, size_bytes, status, error, chunk_count, token_count, created_at, indexed_at
     from public.documents where organization_id = $1 and knowledge_base_id = $2 order by created_at desc`,
    [organizationId, kbId],
  );
  return rows;
}

const safeName = (name: string) => name.replace(/[^\w.\-() ]+/g, "_").replace(/\s+/g, " ").slice(0, 150) || "document";

async function assertDocumentLimits(db: Queryable, organizationId: string, addBytes: number) {
  const l = await limits(db, organizationId);
  const { rows } = await db.query<{ n: number; bytes: string }>(
    "select count(*)::int n, coalesce(sum(size_bytes), 0) bytes from public.documents where organization_id = $1",
    [organizationId],
  );
  const docs = checkLimit(l, "max_documents", rows[0]!.n);
  if (!docs.allowed) throw new LimitExceededError("max_documents", docs.limit!, docs.used);
  const mb = checkLimit(l, "max_storage_mb", Number(rows[0]!.bytes) / 1_048_576, addBytes / 1_048_576);
  if (!mb.allowed) throw new LimitExceededError("max_storage_mb", mb.limit!, Math.round(mb.used));
}

/** Stores an uploaded file and queues it for ingestion. Deduplicates identical files per KB. */
export async function addFileDocument(
  db: Queryable,
  blobs: BlobStore,
  organizationId: string,
  kbId: string,
  file: { filename: string; mimeType?: string | null; bytes: Uint8Array },
  userId?: string | null,
): Promise<DocumentRow> {
  await assertOrgActive(db, organizationId);
  await getKnowledgeBase(db, organizationId, kbId);
  if (file.bytes.byteLength === 0) throw new KnowledgeError("Empty file");
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) throw new KnowledgeError(`File too large (max ${MAX_UPLOAD_BYTES / 1_048_576} MB)`);
  const kind = detectKind(file.filename, file.mimeType);
  if (!kind || kind === "url") throw new KnowledgeError("Unsupported file type (PDF, DOCX, TXT, MD, CSV, HTML)");
  await assertDocumentLimits(db, organizationId, file.bytes.byteLength);

  const checksum = createHash("sha256").update(file.bytes).digest("hex");
  const dup = await db.query<DocumentRow>("select id, title, status from public.documents where knowledge_base_id = $1 and checksum = $2", [kbId, checksum]);
  if (dup.rows[0]) throw new KnowledgeError(`This file is already in the knowledge base ("${dup.rows[0].title}")`);

  const title = safeName(file.filename);
  const { rows } = await db.query<DocumentRow>(
    `insert into public.documents (organization_id, knowledge_base_id, title, source_type, mime_type, size_bytes, checksum, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [organizationId, kbId, title, kind, file.mimeType ?? null, file.bytes.byteLength, checksum, userId ?? null],
  );
  const doc = rows[0]!;
  const path = `${organizationId}/${doc.id}/${title}`;
  await blobs.put(path, file.bytes, file.mimeType || "application/octet-stream");
  await db.query("update public.documents set storage_path = $2 where id = $1", [doc.id, path]);
  await enqueueJob(db, { type: "document.ingest", organizationId, payload: { documentId: doc.id }, dedupeKey: `document.ingest:${doc.id}` });
  return { ...doc, storage_path: path };
}

export async function addUrlDocument(db: Queryable, organizationId: string, kbId: string, url: string, userId?: string | null): Promise<DocumentRow> {
  await assertOrgActive(db, organizationId);
  await getKnowledgeBase(db, organizationId, kbId);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new KnowledgeError("Invalid URL");
  }
  if (parsed.protocol !== "https:") throw new KnowledgeError("Only https:// URLs are allowed");
  await assertDocumentLimits(db, organizationId, 0);
  const { rows } = await db.query<DocumentRow>(
    `insert into public.documents (organization_id, knowledge_base_id, title, source_type, source_uri, created_by)
     values ($1, $2, $3, 'url', $4, $5) returning *`,
    [organizationId, kbId, parsed.hostname + parsed.pathname.slice(0, 200), parsed.toString(), userId ?? null],
  );
  await enqueueJob(db, { type: "document.ingest", organizationId, payload: { documentId: rows[0]!.id }, dedupeKey: `document.ingest:${rows[0]!.id}` });
  return rows[0]!;
}

export interface IngestDeps {
  router: LLMRouter;
  blobs: BlobStore;
  outbound?: OutboundPolicy;
  fetchImpl?: typeof fetch;
}

/** Worker job: parse → chunk → embed → store. Idempotent (replaces previous chunks). */
export async function ingestDocument(db: Queryable, documentId: string, deps: IngestDeps): Promise<{ chunks: number }> {
  const { rows } = await db.query<DocumentRow & { organization_id: string; embedding_model: string; chunk_tokens: number; chunk_overlap: number }>(
    `select d.*, kb.embedding_model, kb.chunk_tokens, kb.chunk_overlap
     from public.documents d join public.knowledge_bases kb on kb.id = d.knowledge_base_id where d.id = $1`,
    [documentId],
  );
  const doc = rows[0];
  if (!doc) throw new NotFoundError("Document");
  await db.query("update public.documents set status = 'processing', error = null where id = $1", [documentId]);

  try {
    let bytes: Uint8Array;
    let kind = doc.source_type as Parameters<typeof parseDocument>[0];
    if (doc.source_type === "url") {
      const res = await safeFetch(doc.source_uri!, { ...deps.outbound, maxBytes: 5 * 1024 * 1024, timeoutMs: 20_000, fetchImpl: deps.fetchImpl });
      if (res.status >= 400) throw new Error(`HTTP ${res.status} fetching URL`);
      bytes = res.body;
      const type = res.headers.get("content-type") ?? "";
      kind = type.includes("pdf") ? "pdf" : type.includes("html") ? "url" : "txt";
    } else {
      bytes = await deps.blobs.get(doc.storage_path!);
    }
    const parsed = await parseDocument(kind, bytes, doc.title);
    const chunks = chunkText(parsed.text, { chunkTokens: doc.chunk_tokens, overlapTokens: doc.chunk_overlap });
    if (chunks.length === 0) throw new Error("No text could be extracted from this document");
    if (chunks.length > 5000) throw new Error("Document too large (more than 5000 chunks)");

    const ctx: UsageContext = { organizationId: doc.organization_id, purpose: "embedding" };
    const inputs = chunks.map((c) => (c.heading ? `${c.heading}\n${c.content}` : c.content));
    const { vectors } = await deps.router.embed(doc.embedding_model, inputs, ctx, { dimensions: EMBEDDING_DIMENSIONS });
    if (vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
      throw new Error(`Embedding model must return ${EMBEDDING_DIMENSIONS} dimensions`);
    }

    await db.query("delete from public.document_chunks where document_id = $1", [documentId]);
    for (let i = 0; i < chunks.length; i += 100) {
      const batch = chunks.slice(i, i + 100);
      const values: unknown[] = [];
      const tuples = batch.map((c, j) => {
        const b = values.length;
        values.push(doc.organization_id, doc.knowledge_base_id, documentId, c.index, c.content, c.heading ?? null, c.tokens, `[${vectors[i + j]!.join(",")}]`);
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}::extensions.vector)`;
      });
      await db.query(
        `insert into public.document_chunks (organization_id, knowledge_base_id, document_id, chunk_index, content, heading, tokens, embedding) values ${tuples.join(",")}`,
        values,
      );
    }
    const tokens = chunks.reduce((a, c) => a + c.tokens, 0);
    await db.query(
      `update public.documents set status = 'ready', chunk_count = $2, token_count = $3, indexed_at = now(),
         title = case when source_type = 'url' and $4::text is not null then left($4, 300) else title end,
         metadata = metadata || $5::jsonb
       where id = $1`,
      [documentId, chunks.length, tokens, parsed.title ?? null, JSON.stringify(parsed.metadata)],
    );
    return { chunks: chunks.length };
  } catch (e) {
    await db.query("update public.documents set status = 'failed', error = $2 where id = $1", [documentId, (e as Error).message.slice(0, 500)]);
    throw e;
  }
}

export async function deleteDocument(db: Queryable, blobs: BlobStore, organizationId: string, documentId: string): Promise<void> {
  const { rows } = await db.query<{ storage_path: string | null }>(
    "delete from public.documents where id = $1 and organization_id = $2 returning storage_path",
    [documentId, organizationId],
  );
  if (!rows[0]) throw new NotFoundError("Document");
  if (rows[0].storage_path) await blobs.remove([rows[0].storage_path]);
}

export async function reindexDocument(db: Queryable, organizationId: string, documentId: string): Promise<void> {
  const res = await db.query("update public.documents set status = 'pending', error = null where id = $1 and organization_id = $2", [documentId, organizationId]);
  if (!res.rowCount) throw new NotFoundError("Document");
  await enqueueJob(db, { type: "document.ingest", organizationId, payload: { documentId }, dedupeKey: `document.ingest:${documentId}` });
}

/**
 * Hybrid retrieval across knowledge bases of ONE organization. KBs are
 * grouped by embedding model so each query vector matches its index.
 */
export async function searchKnowledge(
  db: Queryable,
  router: LLMRouter,
  organizationId: string,
  kbIds: string[],
  query: string,
  opts: { k?: number; ctx?: Partial<UsageContext> } = {},
): Promise<RetrievedChunk[]> {
  if (!kbIds.length || !query.trim()) return [];
  const { rows: kbs } = await db.query<{ id: string; embedding_model: string }>(
    "select id, embedding_model from public.knowledge_bases where organization_id = $1 and id = any($2::uuid[])",
    [organizationId, kbIds],
  );
  const byModel = new Map<string, string[]>();
  for (const kb of kbs) byModel.set(kb.embedding_model, [...(byModel.get(kb.embedding_model) ?? []), kb.id]);
  const k = opts.k ?? 6;
  const results: RetrievedChunk[] = [];
  for (const [model, ids] of byModel) {
    const { vectors } = await router.embed(model, [query.slice(0, 8000)], { ...opts.ctx, organizationId, purpose: "embedding" }, { dimensions: EMBEDDING_DIMENSIONS });
    const { rows } = await db.query<{ id: string; document_id: string; title: string; heading: string | null; content: string; score: number }>(
      "select id, document_id, title, heading, content, score from app.search_chunks($1, $2::uuid[], $3::extensions.vector, $4, $5)",
      [organizationId, ids, `[${vectors[0]!.join(",")}]`, query, k],
    );
    results.push(...rows.map((r) => ({ id: r.id, documentId: r.document_id, title: r.heading ? `${r.title} · ${r.heading}` : r.title, content: r.content, score: Number(r.score) })));
  }
  return results.sort((a, b) => b.score - a.score).slice(0, k);
}
