import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { SOLUTION_CATEGORIES, SOLUTIONS } from "@dtn/core/solutions/catalog";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Soluciones" };

const CATEGORY_LABEL: Record<string, string> = {
  SALES: "Ventas",
  SUPPORT: "Soporte",
  MARKETING: "Marketing",
  OPERATIONS: "Operaciones",
  DOCUMENTS: "Documentos",
  COMMUNICATION: "Comunicación",
  AUTOMATION: "Automatización",
  KNOWLEDGE: "Conocimiento",
};

export default async function SolutionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [s, sp, supabase] = await Promise.all([requireOrg("agents.read"), searchParams, createSupabaseServerClient()]);
  const { data: instances } = await supabase
    .from("solution_instances")
    .select("id, name, solution_key, template_id, created_at, agent_ids, knowledge_base_id, workflow_id, channel_id, channels(public_key)")
    .eq("organization_id", s.org.id)
    .order("created_at", { ascending: false });
  const category = sp.category && (SOLUTION_CATEGORIES as readonly string[]).includes(sp.category) ? sp.category : null;
  const list = category ? SOLUTIONS.filter((x) => x.category === category) : SOLUTIONS;
  const activated = instances?.find((i) => i.id === sp.activated);

  return (
    <>
      <PageHeader title="Soluciones" description={`Productos listos para desplegar en ${s.org.name}. Al activarlos se crean el agente, la knowledge base, el workflow y el canal.`} />
      <Flash error={sp.error} />
      {activated ? (
        <Card className="mb-6 border-success/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-success">
              <CheckCircle2 className="h-5 w-5" /> {activated.name} activada
            </CardTitle>
            <CardDescription>Siguientes pasos para dejarla operativa:</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {activated.knowledge_base_id ? (
                <li>
                  <Link className="underline" href={`/knowledge/${activated.knowledge_base_id}`}>
                    Sube la documentación del negocio
                  </Link>
                </li>
              ) : null}
              {activated.agent_ids[0] ? (
                <li>
                  <Link className="underline" href={`/agents/${activated.agent_ids[0]}`}>
                    Revisa el agente y pruébalo en el playground
                  </Link>
                </li>
              ) : null}
              {activated.channel_id ? (
                <li>
                  <Link className="underline" href="/integrations">
                    Copia el código del chat web e insértalo en la web del cliente
                  </Link>
                </li>
              ) : null}
              {activated.workflow_id ? (
                <li>
                  <Link className="underline" href={`/workflows/${activated.workflow_id}`}>
                    Revisa el workflow publicado
                  </Link>
                </li>
              ) : null}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      {instances?.length ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Activas en esta organización</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {instances.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-medium">{i.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{i.template_id}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(i.created_at)}</span>
                  {i.agent_ids[0] ? (
                    <Link className="text-xs underline" href={`/agents/${i.agent_ids[0]}`}>
                      Agente
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/solutions" className={cn(buttonVariants({ variant: category ? "outline" : "default", size: "sm" }))}>
          Todas
        </Link>
        {SOLUTION_CATEGORIES.map((c) => (
          <Link key={c} href={`/solutions?category=${c}`} className={cn(buttonVariants({ variant: category === c ? "default" : "outline", size: "sm" }))}>
            {CATEGORY_LABEL[c]}
          </Link>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((sol) => (
          <Link key={sol.key} href={`/solutions/${sol.key}`}>
            <Card className="h-full transition-colors hover:bg-muted/40">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle>{sol.name}</CardTitle>
                  <Badge variant="secondary">{CATEGORY_LABEL[sol.category]}</Badge>
                </div>
                <CardDescription>{sol.tagline}</CardDescription>
                <div className="flex flex-wrap gap-1 pt-2">
                  {sol.channels.map((c) => (
                    <Badge key={c} variant="outline">
                      {c}
                    </Badge>
                  ))}
                  {sol.needsIntegrations.length ? <Badge variant="warning">requiere integración</Badge> : null}
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
