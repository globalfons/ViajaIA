import Link from "next/link";
import { BookOpen } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { createKnowledgeBaseAction } from "@/lib/actions/knowledge";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, formatNumber } from "@/lib/utils";

export const metadata = { title: "Knowledge" };

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [s, sp, supabase] = await Promise.all([requireOrg("knowledge.read"), searchParams, createSupabaseServerClient()]);
  const [{ data: kbs }, { data: docs }, { data: models }] = await Promise.all([
    supabase.from("knowledge_bases").select("id, name, description, embedding_model, created_at").eq("organization_id", s.org.id).order("created_at", { ascending: false }),
    supabase.from("documents").select("knowledge_base_id, status, chunk_count").eq("organization_id", s.org.id),
    supabase.from("llm_models").select("provider, model").eq("kind", "embedding").eq("enabled", true),
  ]);
  const stats = new Map<string, { docs: number; ready: number; chunks: number }>();
  for (const d of docs ?? []) {
    const st = stats.get(d.knowledge_base_id) ?? { docs: 0, ready: 0, chunks: 0 };
    st.docs++;
    if (d.status === "ready") st.ready++;
    st.chunks += d.chunk_count;
    stats.set(d.knowledge_base_id, st);
  }
  const embeddingModels = [...new Set([...(models ?? []).map((m) => `${m.provider}:${m.model}`), ...(process.env.DEFAULT_EMBEDDING_MODEL ? [process.env.DEFAULT_EMBEDDING_MODEL] : [])])];

  return (
    <>
      <PageHeader title="Knowledge" description="Documentación que tus agentes consultan antes de responder." />
      <Flash error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          {(kbs ?? []).map((kb) => {
            const st = stats.get(kb.id) ?? { docs: 0, ready: 0, chunks: 0 };
            return (
              <Link key={kb.id} href={`/knowledge/${kb.id}`}>
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-primary" /> {kb.name}
                    </CardTitle>
                    <CardDescription className="line-clamp-2">{kb.description || "Sin descripción"}</CardDescription>
                    <p className="pt-2 text-xs text-muted-foreground">
                      {st.ready}/{st.docs} documentos listos · {formatNumber(st.chunks)} fragmentos · {formatDate(kb.created_at)}
                    </p>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
          {kbs?.length ? null : (
            <Card className="sm:col-span-2">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Aún no hay knowledge bases. Crea una y sube la documentación del negocio: horarios, servicios, precios, políticas…
              </CardContent>
            </Card>
          )}
        </div>
        {s.can("knowledge.write") ? (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Nueva knowledge base</CardTitle>
            </CardHeader>
            <CardContent>
              {embeddingModels.length ? (
                <form action={createKnowledgeBaseAction} className="space-y-3">
                  <Input name="name" required maxLength={120} placeholder="Documentación de atención al cliente" aria-label="Nombre" />
                  <Input name="description" maxLength={1000} placeholder="Descripción (opcional)" aria-label="Descripción" />
                  <Select name="embeddingModel" aria-label="Modelo de embeddings">
                    {embeddingModels.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </Select>
                  <Button type="submit" className="w-full">
                    Crear
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No hay modelos de embeddings activos. El administrador de la plataforma debe añadir uno (tipo «embedding», 1536 dimensiones) en Platform
                  Admin → Modelos.
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
