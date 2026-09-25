import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createClientOrganization } from "@/lib/actions/admin";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [s, sp, supabase] = await Promise.all([requireSession(), searchParams, createSupabaseServerClient()]);
  // RLS: platform admins see every org, everyone else only their own.
  const [{ data: orgs }, { data: plans }] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, slug, status, plan_code, created_at, memberships(count)")
      .order("created_at", { ascending: false }),
    supabase.from("plans").select("code, name").eq("active", true).order("sort_order"),
  ]);

  return (
    <>
      <PageHeader
        title="Clients"
        description={s.isPlatformAdmin ? "Todas las empresas cliente de la plataforma." : "Organizaciones a las que perteneces."}
      />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Empresa</TH>
                  <TH>Plan</TH>
                  <TH>Estado</TH>
                  <TH>Usuarios</TH>
                  <TH>Alta</TH>
                </TR>
              </THead>
              <TBody>
                {(orgs ?? []).map((o) => (
                  <TR key={o.id}>
                    <TD>
                      <Link href={`/clients/${o.id}`} className="font-medium hover:underline">
                        {o.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{o.slug}</div>
                    </TD>
                    <TD>{o.plan_code ?? "—"}</TD>
                    <TD>
                      <Badge variant={o.status === "active" ? "success" : "danger"}>{o.status}</Badge>
                    </TD>
                    <TD>{(o.memberships as unknown as { count: number }[])?.[0]?.count ?? 0}</TD>
                    <TD className="text-muted-foreground">{formatDate(o.created_at)}</TD>
                  </TR>
                ))}
                {orgs?.length ? null : (
                  <TR>
                    <TD colSpan={5} className="py-8 text-center text-muted-foreground">
                      Todavía no hay clientes.
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        {s.isPlatformAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo cliente</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createClientOrganization} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Empresa</Label>
                  <Input id="name" name="name" required maxLength={200} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="slug">Identificador (slug)</Label>
                  <Input id="slug" name="slug" required pattern="[a-z0-9][a-z0-9-]*[a-z0-9]" placeholder="clinica-sol" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="plan">Plan</Label>
                  <Select id="plan" name="plan" defaultValue="STARTER">
                    {(plans ?? []).map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contactEmail">Email del responsable (opcional)</Label>
                  <Input id="contactEmail" name="contactEmail" type="email" placeholder="gerencia@cliente.es" />
                  <p className="text-xs text-muted-foreground">Recibirá una invitación como administrador.</p>
                </div>
                <Button type="submit" className="w-full">
                  Crear cliente
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
