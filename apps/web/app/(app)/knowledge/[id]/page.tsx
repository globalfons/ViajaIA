import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { SearchTester } from "@/components/knowledge/search-tester";
import { UploadForm } from "@/components/knowledge/upload-form";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addUrlAction, documentAction } from "@/lib/actions/knowledge";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, formatNumber } from "@/lib/utils";

const STATUS = { ready: "success", pending: "secondary", processing: "default", failed: "danger" } as const;
const OK: Record<string, string> = { url: "URL añadida a la cola.", deleted: "Documento eliminado.", reindex: "Documento en cola para reindexar." };
const size = (b: number | null) => (b == null ? "—" : b < 1024 ? `${b} B` : b < 1_048_576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1_048_576).toFixed(1)} MB`);

export default async function KnowledgeBasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp, s, supabase] = await Promise.all([params, searchParams, requireOrg("knowledge.read"), createSupabaseServerClient()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: kb } = await supabase.from("knowledge_bases").select("id, name, description, embedding_model").eq("id", id).eq("organization_id", s.org.id).maybeSingle();
  if (!kb) notFound();
  const { data: docs } = await supabase
    .from("documents")
    .select("id, title, source_type, source_uri, size_bytes, status, error, chunk_count, token_count, created_at, indexed_at")
    .eq("knowledge_base_id", id)
    .eq("organization_id", s.org.id)
    .order("created_at", { ascending: false });
  const busy = (docs ?? []).some((d) => d.status === "pending" || d.status === "processing");
  const canWrite = s.can("knowledge.write");

  return (
    <>
      <AutoRefresh active={busy} />
      <PageHeader title={kb.name} description={`${kb.description || "Knowledge base"} · embeddings ${kb.embedding_model}`} />
      <Flash ok={sp.ok ? OK[sp.ok] : undefined} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Documentos {busy ? <Badge>indexando…</Badge> : null}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Documento</TH>
                    <TH>Estado</TH>
                    <TH className="text-right">Tamaño</TH>
                    <TH className="text-right">Fragmentos</TH>
                    <TH>Fecha</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {(docs ?? []).map((d) => (
                    <TR key={d.id}>
                      <TD className="max-w-xs">
                        <div className="truncate font-medium">{d.title}</div>
                        <div className="text-xs uppercase text-muted-foreground">{d.source_type}</div>
                        {d.error ? <div className="text-xs text-danger">{d.error}</div> : null}
                      </TD>
                      <TD>
                        <Badge variant={STATUS[d.status as keyof typeof STATUS] ?? "secondary"}>{d.status}</Badge>
                      </TD>
                      <TD className="text-right text-xs">{size(d.size_bytes)}</TD>
                      <TD className="text-right text-xs">{formatNumber(d.chunk_count)}</TD>
                      <TD className="text-xs text-muted-foreground">{formatDate(d.indexed_at ?? d.created_at)}</TD>
                      <TD className="text-right">
                        {canWrite ? (
                          <div className="flex justify-end gap-1">
                            <form action={documentAction}>
                              <input type="hidden" name="kbId" value={kb.id} />
                              <input type="hidden" name="documentId" value={d.id} />
                              <Button type="submit" name="op" value="reindex" size="sm" variant="ghost">
                                Reindexar
                              </Button>
                            </form>
                            <form action={documentAction}>
                              <input type="hidden" name="kbId" value={kb.id} />
                              <input type="hidden" name="documentId" value={d.id} />
                              <Button type="submit" name="op" value="delete" size="sm" variant="ghost" className="text-danger">
                                Eliminar
                              </Button>
                            </form>
                          </div>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                  {docs?.length ? null : (
                    <TR>
                      <TD colSpan={6} className="py-10 text-center text-muted-foreground">
                        Sube el primer documento para que los agentes puedan usarlo.
                      </TD>
                    </TR>
                  )}
                </TBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Probar búsqueda</CardTitle>
              <CardDescription>Muestra los fragmentos que recibiría un agente para esa pregunta (búsqueda híbrida: semántica + palabras clave).</CardDescription>
            </CardHeader>
            <CardContent>
              <SearchTester kbId={kb.id} />
            </CardContent>
          </Card>
        </div>
        {canWrite ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Subir documentos</CardTitle>
              </CardHeader>
              <CardContent>
                <UploadForm kbId={kb.id} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Añadir URL</CardTitle>
                <CardDescription>Página pública (https). Se descarga con protección SSRF.</CardDescription>
              </CardHeader>
              <CardContent>
                <form action={addUrlAction} className="flex gap-2">
                  <input type="hidden" name="kbId" value={kb.id} />
                  <Input name="url" type="url" required placeholder="https://tuempresa.es/preguntas-frecuentes" aria-label="URL" />
                  <Button type="submit" variant="outline">
                    Añadir
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
