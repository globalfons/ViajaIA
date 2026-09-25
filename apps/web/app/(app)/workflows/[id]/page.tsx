import { notFound } from "next/navigation";
import { BUILTIN_TOOLS } from "@dtn/core/tools/builtin";
import { WorkflowBuilder } from "@/components/workflows/workflow-builder";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, s, supabase] = await Promise.all([params, requireOrg("workflows.read"), createSupabaseServerClient()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: wf } = await supabase
    .from("workflows")
    .select("id, name, status, latest_version, published_version")
    .eq("id", id)
    .eq("organization_id", s.org.id)
    .maybeSingle();
  if (!wf || wf.status === "archived") notFound();
  const [{ data: version }, { data: agents }] = await Promise.all([
    supabase.from("workflow_versions").select("graph").eq("workflow_id", id).eq("organization_id", s.org.id).eq("version", wf.latest_version).single(),
    supabase.from("agents").select("id, name").eq("organization_id", s.org.id).neq("status", "archived").order("name"),
  ]);
  return (
    <WorkflowBuilder
      workflowId={wf.id}
      name={wf.name}
      version={wf.latest_version}
      publishedVersion={wf.published_version}
      initialGraph={version?.graph ?? { nodes: [], edges: [] }}
      agents={agents ?? []}
      tools={BUILTIN_TOOLS.map((t) => ({ name: t.name, description: t.description }))}
      canEdit={s.can("workflows.write")}
      canRun={s.can("workflows.run")}
      isPlatformAdmin={s.isPlatformAdmin}
    />
  );
}
