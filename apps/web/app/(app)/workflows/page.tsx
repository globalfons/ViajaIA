import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createWorkflowAction } from "@/lib/actions/workflows";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Workflows" };

export default async function WorkflowsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [s, sp, supabase] = await Promise.all([requireOrg("workflows.read"), searchParams, createSupabaseServerClient()]);
  const { data: templates } = await supabase.from("templates").select("id, name, organization_id").eq("kind", "workflow").order("name");
  const { data: workflows } = await supabase
    .from("workflows")
    .select("id, name, description, status, latest_version, published_version, updated_at")
    .eq("organization_id", s.org.id)
    .neq("status", "archived")
    .order("updated_at", { ascending: false });

  return (
    <>
      <PageHeader title="Workflows" description="Automatizaciones visuales con agentes, tools, condiciones y aprobación humana." />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Workflow</TH>
                  <TH>Estado</TH>
                  <TH>Versión</TH>
                  <TH>Actualizado</TH>
                </TR>
              </THead>
              <TBody>
                {(workflows ?? []).map((w) => (
                  <TR key={w.id}>
                    <TD>
                      <Link href={`/workflows/${w.id}`} className="font-medium hover:underline">
                        {w.name}
                      </Link>
                      <div className="line-clamp-1 text-xs text-muted-foreground">{w.description}</div>
                    </TD>
                    <TD>
                      <Badge variant={w.status === "active" ? "success" : "secondary"}>{w.status}</Badge>
                    </TD>
                    <TD className="text-xs">
                      v{w.latest_version}
                      {w.published_version ? ` · publicada v${w.published_version}` : ""}
                    </TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(w.updated_at)}</TD>
                  </TR>
                ))}
                {workflows?.length ? null : (
                  <TR>
                    <TD colSpan={4} className="py-10 text-center text-muted-foreground">
                      Todavía no hay workflows.
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        {s.can("workflows.write") ? (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Nuevo workflow</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createWorkflowAction} className="space-y-3">
                <Input name="name" required maxLength={120} placeholder="Cualificación de leads" aria-label="Nombre" />
                <Input name="description" maxLength={1000} placeholder="Descripción (opcional)" aria-label="Descripción" />
                <Select name="template" defaultValue="" aria-label="Plantilla">
                  <option value="">En blanco</option>
                  {(templates ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.organization_id ? "(organización)" : "(agencia)"}
                    </option>
                  ))}
                </Select>
                <Button type="submit" className="w-full">
                  Crear y abrir el editor
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
