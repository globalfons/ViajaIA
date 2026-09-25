import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { AGENT_STATUS_VARIANT as STATUS_VARIANT } from "@/lib/status";

export const metadata = { title: "Agents" };

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [s, sp, supabase] = await Promise.all([requireOrg("agents.read"), searchParams, createSupabaseServerClient()]);
  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, description, status, template_key, version, config->>model, updated_at")
    .eq("organization_id", s.org.id)
    .neq("status", "archived")
    .order("updated_at", { ascending: false });

  return (
    <>
      <PageHeader
        title="Agents"
        description="Agentes de IA de esta organización."
        actions={
          s.can("agents.write") ? (
            <Link href="/agents/new" className={buttonVariants()}>
              <Plus className="h-4 w-4" /> Nuevo agente
            </Link>
          ) : null
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Agente</TH>
                <TH>Estado</TH>
                <TH>Modelo</TH>
                <TH>Plantilla</TH>
                <TH>Versión</TH>
                <TH>Actualizado</TH>
              </TR>
            </THead>
            <TBody>
              {(agents ?? []).map((a) => (
                <TR key={a.id}>
                  <TD>
                    <Link href={`/agents/${a.id}`} className="font-medium hover:underline">
                      {a.name}
                    </Link>
                    <div className="line-clamp-1 max-w-md text-xs text-muted-foreground">{a.description}</div>
                  </TD>
                  <TD>
                    <Badge variant={STATUS_VARIANT[a.status as keyof typeof STATUS_VARIANT] ?? "secondary"}>{a.status}</Badge>
                  </TD>
                  <TD className="font-mono text-xs">{a.model}</TD>
                  <TD className="text-xs text-muted-foreground">{a.template_key?.replace(/^custom:.*/, "personalizada") ?? "—"}</TD>
                  <TD>v{a.version}</TD>
                  <TD className="text-xs text-muted-foreground">{formatDate(a.updated_at)}</TD>
                </TR>
              ))}
              {agents?.length ? null : (
                <TR>
                  <TD colSpan={6} className="py-10 text-center text-muted-foreground">
                    Todavía no hay agentes. Crea el primero desde una plantilla.
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
