import { LIMIT_KEYS } from "@dtn/core/billing/limits";
import { formatMoney } from "@dtn/core/billing/stripe";
import { SetupChecklist } from "@/components/setup-checklist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addPlanPriceAction, deactivatePlanPriceAction } from "@/lib/actions/billing";
import { setDemoChannelAction, setOcrModelAction, updatePlatformSettings, upsertModel, upsertPlan } from "@/lib/actions/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Price = { stripe_price_id: string; plan_code: string; currency: string; unit_amount: number; interval: string; active: boolean };

/** Nested forms are invalid HTML: price actions use formAction buttons inside the plan form. */
function PlanPrices({ plan, prices, stripeOn }: { plan: string; prices: Price[]; stripeOn: boolean }) {
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-3">
      <p className="text-xs font-medium">Precios en Stripe</p>
      {prices.length ? (
        <ul className="space-y-1 text-xs">
          {prices.map((x) => (
            <li key={x.stripe_price_id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <code>{x.stripe_price_id}</code> · {formatMoney(Number(x.unit_amount), x.currency)} / {x.interval}
              </span>
              {x.active ? (
                <Button type="submit" size="sm" variant="ghost" className="h-6 px-2 text-xs" formAction={deactivatePlanPriceAction} name="priceId" value={x.stripe_price_id} formNoValidate>
                  Retirar
                </Button>
              ) : (
                <Badge variant="secondary">retirado</Badge>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Sin precio vinculado: el plan no se puede contratar online.</p>
      )}
      {stripeOn ? (
        <div className="flex gap-2">
          <input type="hidden" name="plan" value={plan} />
          <Input name="priceId" placeholder="price_…" className="h-8 font-mono text-xs" aria-label={`Stripe price ID para ${plan}`} />
          <Button type="submit" size="sm" variant="outline" formAction={addPlanPriceAction} formNoValidate>
            Vincular
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Configura STRIPE_SECRET_KEY para vincular precios.</p>
      )}
    </div>
  );
}

export async function SettingsTab() {
  const supabase = await createSupabaseServerClient();
  const [{ data: plans }, { data: settings }, { data: models }, { data: prices }] = await Promise.all([
    supabase.from("plans").select("*").order("sort_order"),
    supabase.from("platform_settings").select("allow_self_signup, demo_channel_key, ocr_model").single(),
    supabase.from("llm_models").select("*").order("provider").order("model"),
    supabase.from("plan_prices").select("stripe_price_id, plan_code, currency, unit_amount, interval, active").order("created_at"),
  ]);
  const stripeOn = Boolean(process.env.STRIPE_SECRET_KEY);
  return (
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Planes</CardTitle>
              <CardDescription>
                Los precios se crean en Stripe. Aquí se vincula cada plan con su <code>price_…</code> (importe, moneda y periodicidad se leen de
                Stripe) y se fijan los límites.
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
                  {p ? <PlanPrices plan={p.code} prices={(prices ?? []).filter((x) => x.plan_code === p.code)} stripeOn={stripeOn} /> : null}
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
          <Card>
            <CardHeader>
              <CardTitle>Demo pública</CardTitle>
              <CardDescription>
                Clave (<code>wc_…</code>) de un chat web activo con un agente y datos de un negocio ficticio. Con clave, <a href="/demo" className="underline">/demo</a> muestra la IA real;
                sin ella, un modo DEMO con conversaciones de ejemplo claramente etiquetado.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={setDemoChannelAction} className="flex gap-2">
                <Input name="demoKey" defaultValue={settings?.demo_channel_key ?? ""} placeholder="wc_… (vacío = modo DEMO)" aria-label="Clave del chat de demo" className="font-mono text-xs" />
                <Button type="submit" size="sm">
                  Guardar
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>OCR de documentos</CardTitle>
              <CardDescription>
                Modelo con visión para leer PDF escaneados e imágenes en las knowledge bases. Solo se usa cuando el documento no tiene texto; su coste se registra
                al cliente como consumo «ocr». Sin modelo, esos documentos quedan como fallidos con un aviso.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={setOcrModelAction} className="flex gap-2">
                <Select name="ocrModel" defaultValue={settings?.ocr_model ?? ""} aria-label="Modelo de OCR">
                  <option value="">Desactivado</option>
                  {(models ?? [])
                    .filter((m) => m.kind === "chat" && m.enabled)
                    .map((m) => (
                      <option key={`${m.provider}:${m.model}`} value={`${m.provider}:${m.model}`}>
                        {m.provider}:{m.model}
                      </option>
                    ))}
                </Select>
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
  );
}
