import { notFound } from "next/navigation";
import { LIMIT_KEYS } from "@dtn/core/billing/limits";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createUserForOrganization, setOrganizationPlanAndLimits, setOrganizationStatus } from "@/lib/actions/admin";
import { switchOrganization } from "@/lib/actions/org";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, sp, s, supabase] = await Promise.all([params, searchParams, requireSession(), createSupabaseServerClient()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, status, suspended_reason, plan_code, limits, limit_policy, white_label_enabled, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!org) notFound();

  const [{ data: members }, { data: plans }, { data: audit }] = await Promise.all([
    supabase.from("memberships").select("role, created_at, profiles(email, full_name)").eq("organization_id", id),
    supabase.from("plans").select("code, name").order("sort_order"),
    supabase
      .from("audit_logs")
      .select("id, action, target_type, actor_type, created_at")
      .eq("organization_id", id)
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  return (
    <>
      <PageHeader
        title={org.name}
        description={`${org.slug} · alta ${formatDate(org.created_at)}`}
        actions={
          <form action={switchOrganization}>
            <input type="hidden" name="organizationId" value={org.id} />
            <Button type="submit" variant="outline">
              Abrir panel del cliente
            </Button>
          </form>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Estado</CardTitle>
            <CardDescription>
              <Badge variant={org.status === "active" ? "success" : "danger"}>{org.status}</Badge>
              {org.suspended_reason ? <span className="ml-2">{org.suspended_reason}</span> : null}
            </CardDescription>
          </CardHeader>
          {s.isPlatformAdmin ? (
            <CardContent>
              <form action={setOrganizationStatus} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="organizationId" value={org.id} />
                {org.status === "active" ? (
                  <>
                    <input type="hidden" name="status" value="suspended" />
                    <div className="flex-1 space-y-1.5">
                      <Label htmlFor="reason">Motivo del bloqueo</Label>
                      <Input id="reason" name="reason" maxLength={500} placeholder="Impago, fin de contrato…" />
                    </div>
                    <Button type="submit" variant="destructive">
                      Bloquear cliente
                    </Button>
                  </>
                ) : (
                  <>
                    <input type="hidden" name="status" value="active" />
                    <Button type="submit">Reactivar cliente</Button>
                  </>
                )}
              </form>
              <p className="mt-2 text-xs text-muted-foreground">
                Al bloquearlo, sus usuarios pierden el acceso a los datos y sus agentes dejan de responder. No se borra nada.
              </p>
            </CardContent>
          ) : null}
        </Card>

        {s.isPlatformAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle>Plan y límites</CardTitle>
              <CardDescription>Los límites de aquí sustituyen a los del plan. Una clave ausente o null significa ilimitado.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={setOrganizationPlanAndLimits} className="space-y-3">
                <input type="hidden" name="organizationId" value={org.id} />
                <div className="space-y-1.5">
                  <Label htmlFor="plan">Plan</Label>
                  <Select id="plan" name="plan" defaultValue={org.plan_code ?? "STARTER"}>
                    {(plans ?? []).map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="limits">Límites (JSON)</Label>
                  <Textarea id="limits" name="limits" rows={5} className="font-mono text-xs" defaultValue={JSON.stringify(org.limits ?? {}, null, 2)} />
                  <p className="text-xs text-muted-foreground">Claves: {Object.keys(LIMIT_KEYS).join(", ")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="policy">Al alcanzar un límite</Label>
                  <Select id="policy" name="limitPolicy" defaultValue={org.limit_policy}>
                    <option value="block">Bloquear</option>
                    <option value="require_approval">Pedir aprobación al administrador</option>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="whiteLabel" defaultChecked={org.white_label_enabled} /> White-label activado
                </label>
                <Button type="submit">Guardar</Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Usuarios</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Email</TH>
                  <TH>Rol</TH>
                </TR>
              </THead>
              <TBody>
                {(members ?? []).map((m, i) => {
                  const p = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { email: string | null } | null;
                  return (
                    <TR key={i}>
                      <TD>{p?.email ?? "—"}</TD>
                      <TD>
                        <Badge variant="secondary">{m.role}</Badge>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            {s.isPlatformAdmin ? (
              <form action={createUserForOrganization} className="grid gap-2 border-t p-4 sm:grid-cols-2">
                <input type="hidden" name="organizationId" value={org.id} />
                <p className="text-sm font-medium sm:col-span-2">Crear usuario</p>
                <Input name="email" type="email" required placeholder="persona@cliente.es" aria-label="Email" />
                <Input name="fullName" maxLength={120} placeholder="Nombre (opcional)" aria-label="Nombre" />
                <Input name="password" type="password" required minLength={12} autoComplete="new-password" placeholder="Contraseña temporal (mín. 12)" aria-label="Contraseña temporal" />
                <Select name="role" defaultValue="admin" aria-label="Rol">
                  <option value="owner">owner</option>
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                  <option value="viewer">viewer</option>
                </Select>
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm">
                    Crear y añadir
                  </Button>
                  <span className="ml-2 text-xs text-muted-foreground">Comparte la contraseña temporal por un canal seguro; el usuario puede cambiarla.</span>
                </div>
              </form>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actividad reciente (audit log)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TBody>
                {(audit ?? []).map((a) => (
                  <TR key={a.id}>
                    <TD className="font-mono text-xs">{a.action}</TD>
                    <TD className="text-xs text-muted-foreground">{a.target_type}</TD>
                    <TD className="text-xs text-muted-foreground">{a.actor_type}</TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(a.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
