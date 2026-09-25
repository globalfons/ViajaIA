import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { SetupChecklist } from "@/components/setup-checklist";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [s, sp, supabase] = await Promise.all([requireOrg(), searchParams, createSupabaseServerClient()]);
  const [{ count: members }, { count: projects }] = await Promise.all([
    supabase.from("memberships").select("user_id", { count: "exact", head: true }).eq("organization_id", s.org.id),
    supabase.from("projects").select("id", { count: "exact", head: true }).eq("organization_id", s.org.id),
  ]);

  const kpis = [
    { label: "Usuarios", value: members ?? 0 },
    { label: "Proyectos", value: projects ?? 0 },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description={`Resumen de ${s.org.name}`} />
      <Flash ok={sp.ok} error={sp.error} />
      {s.org.status === "suspended" ? (
        <div className="mb-6 rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          Esta organización está suspendida. Contacta con tu proveedor para reactivarla.
        </div>
      ) : null}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader>
              <CardDescription>{k.label}</CardDescription>
              <CardTitle className="text-2xl">{k.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      {s.isPlatformAdmin ? <SetupChecklist /> : null}
    </>
  );
}
