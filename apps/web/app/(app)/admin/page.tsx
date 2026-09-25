import Link from "next/link";
import { LIMIT_KEYS } from "@dtn/core/billing/limits";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { SetupChecklist } from "@/components/setup-checklist";
import { updatePlatformSettings, upsertModel, upsertPlan } from "@/lib/actions/admin";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { requirePlatformAdmin } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Platform Admin" };

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const [sp, supabase] = await Promise.all([searchParams, createSupabaseServerClient()]);
  const [{ data: plans }, { data: settings }, { count: active }, { count: suspended }, { data: models }] = await Promise.all([
    supabase.from("plans").select("*").order("sort_order"),
    supabase.from("platform_settings").select("allow_self_signup").single(),
    supabase.from("organizations").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("organizations").select("id", { count: "exact", head: true }).eq("status", "suspended"),
    supabase.from("llm_models").select("*").order("provider").order("model"),
  ]);

  return (
    <>
      <PageHeader
        title="Platform Admin"
        description="Administración global de la plataforma."
        actions={
          <Link href="/clients">
            <Button variant="outline">Gestionar clientes</Button>
          </Link>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Clientes activos</CardDescription>
            <CardTitle className="text-2xl">{active ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Clientes bloqueados</CardDescription>
            <CardTitle className="text-2xl">{suspended ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Planes</CardTitle>
              <CardDescription>
                Los precios se configuran en Stripe; aquí solo se enlaza el <code>price_…</code> y se fijan los límites.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {[...(plans ?? []), null].map((p) => (
                <form key={p?.code ?? "new"} action={upsertPlan} className="space-y-2 border-b pb-6 last:border-0 last:pb-0">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>Código</Label>
                      <Input name="code" defaultValue={p?.code} readOnly={Boolean(p)} placeholder="NUEVO_PLAN" required />
                    </div>
                    <div className="space-y-1">
                      <Label>Nombre</Label>
                      <Input name="name" defaultValue={p?.name} required />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Stripe price ID</Label>
                    <Input name="stripe_price_id" defaultValue={p?.stripe_price_id ?? ""} placeholder="price_…" />
                  </div>
                  <div className="space-y-1">
                    <Label>Descripción</Label>
                    <Input name="description" defaultValue={p?.description ?? ""} />
                  </div>
                  <div className="space-y-1">
                    <Label>Límites (JSON)</Label>
                    <Textarea name="limits" rows={3} className="font-mono text-xs" defaultValue={JSON.stringify(p?.limits ?? {}, null, 2)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="active" defaultChecked={p ? p.active : true} /> Activo
                    </label>
                    <Button type="submit" size="sm">
                      {p ? "Guardar" : "Crear plan"}
                    </Button>
                  </div>
                </form>
              ))}
              <p className="text-xs text-muted-foreground">Claves de límites: {Object.keys(LIMIT_KEYS).join(", ")}</p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Registro</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={updatePlatformSettings} className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="allowSelfSignup" defaultChecked={settings?.allow_self_signup ?? false} />
                  Permitir que cualquier usuario cree su propia organización
                </label>
                <Button type="submit" size="sm">
                  Guardar
                </Button>
              </form>
            </CardContent>
          </Card>
          <SetupChecklist />
        </div>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Modelos</CardTitle>
            <CardDescription>
              Modelos disponibles en el Agent Builder y su precio en USD por millón de tokens. Sin precio, el consumo se marca como
              «sin precio» en lugar de contar 0. Referencia: <code>proveedor:modelo</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <THead>
                <TR>
                  <TH>Modelo</TH>
                  <TH>Tipo</TH>
                  <TH className="text-right">Input / 1M</TH>
                  <TH className="text-right">Output / 1M</TH>
                  <TH>Estado</TH>
                </TR>
              </THead>
              <TBody>
                {(models ?? []).map((m) => (
                  <TR key={`${m.provider}:${m.model}`}>
                    <TD className="font-mono text-xs">
                      {m.provider}:{m.model}
                      {m.display_name ? <div className="font-sans text-muted-foreground">{m.display_name}</div> : null}
                    </TD>
                    <TD>{m.kind}{m.embedding_dimensions ? ` · ${m.embedding_dimensions}d` : ""}</TD>
                    <TD className="text-right">{m.input_per_mtok ?? "—"}</TD>
                    <TD className="text-right">{m.output_per_mtok ?? "—"}</TD>
                    <TD>
                      <Badge variant={m.enabled ? "success" : "secondary"}>{m.enabled ? "activo" : "inactivo"}</Badge>
                    </TD>
                  </TR>
                ))}
                {models?.length ? null : (
                  <TR>
                    <TD colSpan={5} className="py-6 text-center text-muted-foreground">
                      Añade al menos un modelo de chat para poder crear agentes.
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
            <form action={upsertModel} className="grid gap-2 sm:grid-cols-8 sm:items-end">
              <div className="space-y-1 sm:col-span-1">
                <Label>Proveedor</Label>
                <Select name="provider" defaultValue="anthropic">
                  {["openai", "anthropic", "gemini", "xai", "deepseek", "openrouter"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Modelo (ID exacto del proveedor)</Label>
                <Input name="model" required placeholder="claude-sonnet-5" />
              </div>
              <div className="space-y-1">
                <Label>Tipo</Label>
                <Select name="kind" defaultValue="chat">
                  <option value="chat">chat</option>
                  <option value="embedding">embedding</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Input $/1M</Label>
                <Input name="input_per_mtok" inputMode="decimal" />
              </div>
              <div className="space-y-1">
                <Label>Output $/1M</Label>
                <Input name="output_per_mtok" inputMode="decimal" />
              </div>
              <div className="space-y-1">
                <Label>Dimensiones</Label>
                <Input name="embedding_dimensions" inputMode="numeric" placeholder="solo embeddings" />
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="enabled" defaultChecked /> Activo
                </label>
                <Button type="submit" size="sm">
                  Guardar
                </Button>
              </div>
              <input type="hidden" name="display_name" value="" />
            </form>
            <p className="text-xs text-muted-foreground">Para editar un modelo existente, vuelve a guardarlo con el mismo proveedor e ID.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
