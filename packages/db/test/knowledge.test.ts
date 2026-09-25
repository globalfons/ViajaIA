import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { LLMRouter } from "@dtn/core";
import { FakeProvider, mockFetch } from "@dtn/core/testing/fake-llm";
import { as, createTestDb, createUser, TEST_DATABASE_URL, type TestDb, type TestUser } from "./harness";
import {
  addFileDocument,
  addUrlDocument,
  createAgent,
  createKnowledgeBase,
  deleteDocument,
  ingestDocument,
  KnowledgeError,
  listDocuments,
  memoryBlobStore,
  NotFoundError,
  runAgent,
  searchKnowledge,
} from "../src";

const fixture = (f: string) => new Uint8Array(readFileSync(join(__dirname, "../../core/test/fixtures", f)));
const enc = (s: string) => new TextEncoder().encode(s);

describe.skipIf(!TEST_DATABASE_URL)("knowledge / RAG", () => {
  let db: TestDb;
  let pool: pg.Pool;
  let orgA: string;
  let orgB: string;
  let kbA: string;
  let userB: TestUser;
  const blobs = memoryBlobStore();
  const embedder = new FakeProvider("openai");
  const router = new LLMRouter({ providers: { openai: embedder } });
  const drainIngest = async () => {
    const { rows } = await pool.query("select payload->>'documentId' id from public.jobs where type = 'document.ingest' and status = 'queued'");
    for (const r of rows) {
      await ingestDocument(pool, r.id, { router, blobs, fetchImpl: FETCH }).catch(() => undefined);
      await pool.query("update public.jobs set status = 'done' where payload->>'documentId' = $1", [r.id]);
    }
  };
  const FETCH = mockFetch((url) => ({ body: `<html><head><title>Tarifas</title></head><body><p>El corte de pelo cuesta 18 euros. ${url}</p></body></html>`, headers: { "content-type": "text/html" } }));

  beforeAll(async () => {
    db = await createTestDb();
    pool = new pg.Pool({ connectionString: db.url });
    orgA = (await db.admin.query("insert into public.organizations (name, slug) values ('Clínica', 'clinica') returning id")).rows[0].id;
    orgB = (await db.admin.query("insert into public.organizations (name, slug, limits) values ('B', 'b', '{\"max_documents\": 1}') returning id")).rows[0].id;
    userB = await createUser(db, "b@b.test");
    await db.admin.query("insert into public.memberships values ($1, $2, 'owner')", [orgB, userB.id]);
    kbA = (await createKnowledgeBase(pool, orgA, { name: "Docs", embeddingModel: "openai:emb" })).id;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.close();
  });

  it("ingests a real PDF, Markdown and a URL into searchable chunks", async () => {
    await addFileDocument(pool, blobs, orgA, kbA, { filename: "horario.pdf", mimeType: "application/pdf", bytes: fixture("horario.pdf") });
    await addFileDocument(pool, blobs, orgA, kbA, {
      filename: "servicios.md",
      mimeType: "text/markdown",
      bytes: enc("# Servicios\nOfrecemos limpieza dental, ortodoncia invisible y blanqueamiento.\n\n# Pagos\nAceptamos tarjeta y Bizum."),
    });
    await addUrlDocument(pool, orgA, kbA, "https://example.com/tarifas");
    await drainIngest();
    const docs = await listDocuments(pool, orgA, kbA);
    expect(docs.map((d) => [d.source_type, d.status])).toEqual(expect.arrayContaining([["pdf", "ready"], ["md", "ready"], ["url", "ready"]]));
    expect(docs.find((d) => d.source_type === "url")!.title).toBe("Tarifas");
    expect(docs.every((d) => d.chunk_count > 0)).toBe(true);
  });

  it("hybrid search ranks the relevant document first", async () => {
    const hits = await searchKnowledge(pool, router, orgA, [kbA], "¿Cuál es el horario de apertura?");
    expect(hits[0]!.content).toContain("lunes a viernes");
    const pay = await searchKnowledge(pool, router, orgA, [kbA], "Bizum");
    expect(pay[0]!.title).toContain("Pagos");
  });

  it("agents answer with knowledge-base sources in context", async () => {
    const agent = await createAgent(pool, orgA, { name: "Recepción", status: "active", config: { model: "openai:chat", knowledgeBaseIds: [kbA] } });
    embedder.push({ content: "Abrimos de lunes a viernes de 9 a 14h [1]." });
    const { result } = await runAgent({ db: pool, organizationId: orgA, agentId: agent.id, message: "¿Qué horario tenéis?", source: "api", runtime: { providers: { openai: embedder } } });
    expect(result.status).toBe("completed");
    expect(result.sources[0]!.content).toContain("lunes a viernes");
    const system = embedder.requests.at(-1)!.messages[0]!.content;
    expect(system).toContain("<untrusted source=\"kb:");
    const { rows } = await pool.query("select sources from public.agent_runs where agent_id = $1", [agent.id]);
    expect(rows[0].sources[0].title).toMatch(/horario/);
  });

  it("isolates tenants: another org can neither search nor write into this KB", async () => {
    expect(await searchKnowledge(pool, router, orgB, [kbA], "horario")).toEqual([]);
    await expect(addFileDocument(pool, blobs, orgB, kbA, { filename: "x.txt", bytes: enc("x") })).rejects.toBeInstanceOf(NotFoundError);
    const visible = await as(db, userB, async (c) => (await c.query("select count(*)::int n from public.document_chunks")).rows[0].n);
    expect(visible).toBe(0);
  });

  it("rejects duplicates, unsupported types and oversized plans", async () => {
    await expect(addFileDocument(pool, blobs, orgA, kbA, { filename: "horario.pdf", bytes: fixture("horario.pdf") })).rejects.toThrow(/already in the knowledge base/);
    await expect(addFileDocument(pool, blobs, orgA, kbA, { filename: "malware.exe", bytes: enc("MZ") })).rejects.toBeInstanceOf(KnowledgeError);
    await expect(addUrlDocument(pool, orgA, kbA, "http://insecure.test")).rejects.toThrow(/https/);
    const kbB = (await createKnowledgeBase(pool, orgB, { name: "B", embeddingModel: "openai:emb" })).id;
    await addFileDocument(pool, blobs, orgB, kbB, { filename: "a.txt", bytes: enc("uno") });
    await expect(addFileDocument(pool, blobs, orgB, kbB, { filename: "b.txt", bytes: enc("dos") })).rejects.toThrow(/max_documents/);
  });

  it("marks documents that cannot be parsed as failed with a clear error", async () => {
    const doc = await addFileDocument(pool, blobs, orgA, kbA, { filename: "fake.pdf", mimeType: "application/pdf", bytes: enc("not really a pdf") });
    await drainIngest();
    const { rows } = await pool.query("select status, error from public.documents where id = $1", [doc.id]);
    expect(rows[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/does not look like PDF/) });
  });

  it("deleting a document removes its chunks and the stored file", async () => {
    const [doc] = (await listDocuments(pool, orgA, kbA)).filter((d) => d.source_type === "md");
    await deleteDocument(pool, blobs, orgA, doc!.id);
    const { rows } = await pool.query("select count(*)::int n from public.document_chunks where document_id = $1", [doc!.id]);
    expect(rows[0].n).toBe(0);
    expect(blobs.files.has(doc!.storage_path!)).toBe(false);
    expect(await searchKnowledge(pool, router, orgA, [kbA], "Bizum")).not.toEqual(expect.arrayContaining([expect.objectContaining({ title: expect.stringContaining("Pagos") })]));
  });

  it("records embedding usage for the tenant", async () => {
    const { rows } = await pool.query("select count(*)::int n from public.usage_events where organization_id = $1 and purpose = 'embedding'", [orgA]);
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
