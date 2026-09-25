"use client";

import { useActionState, useMemo, useState } from "react";
import type { AgentConfig } from "@dtn/core/agents/config";
import { saveAgentAction, type SaveState } from "@/lib/actions/agents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";

export interface ToolInfo {
  name: string;
  description: string;
  risk: "read" | "write" | "external";
  alwaysRequireApproval: boolean;
}

export interface KnowledgeBaseInfo {
  id: string;
  name: string;
}

const RISK_LABEL = { read: "lectura", write: "escritura", external: "externa" } as const;

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const num = (v: string, fallback: number | null) => (v.trim() === "" ? fallback : Number(v));

export function AgentEditor({
  agentId,
  initial,
  status: initialStatus,
  models,
  tools,
  knowledgeBases,
  canEdit,
}: {
  agentId: string;
  initial: AgentConfig;
  status: "draft" | "active" | "paused" | "archived";
  models: string[];
  tools: ToolInfo[];
  knowledgeBases: KnowledgeBaseInfo[];
  canEdit: boolean;
}) {
  const [c, setC] = useState<AgentConfig>(initial);
  const [status, setStatus] = useState(initialStatus === "archived" ? "draft" : initialStatus);
  const [schemaText, setSchemaText] = useState(initial.outputSchema ? JSON.stringify(initial.outputSchema, null, 2) : "");
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [state, action, pending] = useActionState<SaveState, FormData>(saveAgentAction, {});
  const modelOptions = useMemo(() => [...new Set([c.model, ...models])], [c.model, models]);
  const set = <K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) => setC((prev) => ({ ...prev, [k]: v }));
  const setNested = <K extends "limits" | "guardrails" | "humanApproval" | "memory">(k: K, patch: Partial<AgentConfig[K]>) =>
    setC((prev) => ({ ...prev, [k]: { ...prev[k], ...patch } }));

  const payload = useMemo(() => {
    let outputSchema: Record<string, unknown> | null = null;
    if (schemaText.trim()) {
      try {
        outputSchema = JSON.parse(schemaText);
      } catch {
        outputSchema = c.outputSchema;
      }
    }
    return JSON.stringify({ ...c, outputSchema });
  }, [c, schemaText]);

  const toggleTool = (name: string, on: boolean) => set("tools", on ? [...c.tools, name] : c.tools.filter((t) => t !== name));
  const toggleApproval = (name: string, on: boolean) =>
    setNested("humanApproval", { tools: on ? [...c.humanApproval.tools, name] : c.humanApproval.tools.filter((t) => t !== name) });
  const httpHosts = ((c.toolConfig.http_get?.allowedHosts as string[] | undefined) ?? []).join("\n");

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="config" value={payload} />
      <input type="hidden" name="status" value={status} />
      <fieldset disabled={!canEdit || pending} className="space-y-6">
        <Section title="General">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" htmlFor="a-name">
              <Input id="a-name" value={c.name} maxLength={120} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Estado" htmlFor="a-status" hint="Solo los agentes activos responden en canales y API.">
              <Select id="a-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="draft">Borrador</option>
                <option value="active">Activo</option>
                <option value="paused">Pausado</option>
              </Select>
            </Field>
          </div>
          <Field label="Descripción" htmlFor="a-desc">
            <Input id="a-desc" value={c.description} maxLength={1000} onChange={(e) => set("description", e.target.value)} />
          </Field>
        </Section>

        <Section title="Prompt e instrucciones" description="Puedes usar {{company_name}} y las variables definidas en la organización.">
          <Field label="System prompt" htmlFor="a-sys">
            <Textarea id="a-sys" rows={4} value={c.systemPrompt} maxLength={20000} onChange={(e) => set("systemPrompt", e.target.value)} />
          </Field>
          <Field label="Instrucciones" htmlFor="a-ins">
            <Textarea id="a-ins" rows={10} value={c.instructions} maxLength={20000} onChange={(e) => set("instructions", e.target.value)} />
          </Field>
        </Section>

        <Section title="Modelo">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Modelo principal" htmlFor="a-model">
              <Select id="a-model" value={c.model} onChange={(e) => set("model", e.target.value)}>
                {modelOptions.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label={`Temperatura: ${c.temperature.toFixed(1)}`} htmlFor="a-temp">
              <input
                id="a-temp"
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={c.temperature}
                onChange={(e) => set("temperature", Number(e.target.value))}
                className="w-full accent-[hsl(var(--brand-primary))]"
              />
            </Field>
            <Field label="Máx. tokens de respuesta" htmlFor="a-maxtok">
              <Input
                id="a-maxtok"
                type="number"
                min={16}
                max={64000}
                value={c.limits.maxOutputTokens}
                onChange={(e) => setNested("limits", { maxOutputTokens: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="Modelos de fallback (máx. 3, en orden)" htmlFor="a-fb" hint="Se usan si el principal falla o no está disponible.">
            <div id="a-fb" className="flex flex-wrap gap-3">
              {modelOptions
                .filter((m) => m !== c.model)
                .map((m) => (
                  <label key={m} className="flex items-center gap-1.5 font-mono text-xs">
                    <input
                      type="checkbox"
                      checked={c.fallbackModels.includes(m)}
                      disabled={!c.fallbackModels.includes(m) && c.fallbackModels.length >= 3}
                      onChange={(e) => set("fallbackModels", e.target.checked ? [...c.fallbackModels, m] : c.fallbackModels.filter((x) => x !== m))}
                    />
                    {m}
                  </label>
                ))}
            </div>
          </Field>
        </Section>

        <Section title="Tools" description="Allowlist: el agente solo puede usar las tools marcadas aquí.">
          <ul className="divide-y">
            {tools.map((t) => {
              const on = c.tools.includes(t.name);
              return (
                <li key={t.name} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <label className="flex flex-1 items-center gap-2">
                    <input type="checkbox" checked={on} onChange={(e) => toggleTool(t.name, e.target.checked)} />
                    <span className="font-mono text-xs">{t.name}</span>
                    <Badge variant={t.risk === "read" ? "secondary" : "warning"}>{RISK_LABEL[t.risk]}</Badge>
                    <span className="text-xs text-muted-foreground">{t.description}</span>
                  </label>
                  {on ? (
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={t.alwaysRequireApproval || c.humanApproval.tools.includes(t.name)}
                        disabled={t.alwaysRequireApproval}
                        onChange={(e) => toggleApproval(t.name, e.target.checked)}
                      />
                      Requiere aprobación humana
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {c.tools.includes("http_get") ? (
            <Field label="Hosts permitidos para http_get (uno por línea, admite *.dominio.com)" htmlFor="a-hosts">
              <Textarea
                id="a-hosts"
                rows={3}
                value={httpHosts}
                onChange={(e) =>
                  set("toolConfig", {
                    ...c.toolConfig,
                    http_get: { allowedHosts: e.target.value.split("\n").map((h) => h.trim()).filter(Boolean).slice(0, 50) },
                  })
                }
              />
            </Field>
          ) : null}
        </Section>

        {knowledgeBases.length ? (
          <Section title="Conocimiento" description="Knowledge bases que el agente consulta antes de responder.">
            <div className="flex flex-wrap gap-4">
              {knowledgeBases.map((kb) => (
                <label key={kb.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={c.knowledgeBaseIds.includes(kb.id)}
                    onChange={(e) =>
                      set("knowledgeBaseIds", e.target.checked ? [...c.knowledgeBaseIds, kb.id] : c.knowledgeBaseIds.filter((x) => x !== kb.id))
                    }
                  />
                  {kb.name}
                </label>
              ))}
            </div>
          </Section>
        ) : null}

        <Section title="Memoria">
          <div className="flex flex-wrap items-end gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={c.memory.enabled} onChange={(e) => setNested("memory", { enabled: e.target.checked })} />
              Recordar la conversación
            </label>
            <Field label="Mensajes recordados" htmlFor="a-mem">
              <Input id="a-mem" type="number" min={0} max={100} className="w-28" value={c.memory.maxMessages} onChange={(e) => setNested("memory", { maxMessages: Number(e.target.value) })} />
            </Field>
          </div>
        </Section>

        <Section title="Guardrails">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prompt injection" htmlFor="a-inj" hint="«Marcar» registra el intento; «Bloquear» no responde.">
              <Select id="a-inj" value={c.guardrails.injectionDetection} onChange={(e) => setNested("guardrails", { injectionDetection: e.target.value as "off" | "flag" | "block" })}>
                <option value="flag">Marcar</option>
                <option value="block">Bloquear</option>
                <option value="off">Desactivado</option>
              </Select>
            </Field>
            <Field label="Longitud máxima del mensaje" htmlFor="a-maxin">
              <Input id="a-maxin" type="number" min={100} max={100000} value={c.guardrails.maxInputChars} onChange={(e) => setNested("guardrails", { maxInputChars: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Temas bloqueados (separados por comas)" htmlFor="a-topics">
            <Input
              id="a-topics"
              value={c.guardrails.blockedTopics.join(", ")}
              onChange={(e) => setNested("guardrails", { blockedTopics: e.target.value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 50) })}
            />
          </Field>
          <Field label="Respuesta ante tema bloqueado" htmlFor="a-topicreply">
            <Input id="a-topicreply" value={c.guardrails.blockedTopicReply} maxLength={1000} onChange={(e) => setNested("guardrails", { blockedTopicReply: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={c.guardrails.aiDisclosure} onChange={(e) => setNested("guardrails", { aiDisclosure: e.target.checked })} />
            Identificarse como IA (recomendado; obligación de transparencia del Reglamento de IA de la UE)
          </label>
        </Section>

        <Section title="Aprobación humana y escalado">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={c.humanApproval.allWriteTools} onChange={(e) => setNested("humanApproval", { allWriteTools: e.target.checked })} />
            Pedir aprobación para toda tool de escritura o externa
          </label>
          <Field
            label="Escalar si la confianza es menor que"
            htmlFor="a-conf"
            hint="Requiere un schema de salida con el campo numérico «confidence». Vacío = no escalar por confianza."
          >
            <Input
              id="a-conf"
              type="number"
              min={0}
              max={1}
              step={0.05}
              className="w-28"
              value={c.humanApproval.confidenceThreshold ?? ""}
              onChange={(e) => setNested("humanApproval", { confidenceThreshold: num(e.target.value, null) })}
            />
          </Field>
        </Section>

        <Section title="Límites">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Pasos máx. por ejecución" htmlFor="a-steps">
              <Input id="a-steps" type="number" min={1} max={25} value={c.limits.maxSteps} onChange={(e) => setNested("limits", { maxSteps: Number(e.target.value) })} />
            </Field>
            <Field label="Coste máx. por ejecución (USD)" htmlFor="a-runcost">
              <Input id="a-runcost" type="number" min={0} step={0.01} value={c.limits.maxCostUsdPerRun ?? ""} onChange={(e) => setNested("limits", { maxCostUsdPerRun: num(e.target.value, null) })} />
            </Field>
            <Field label="Presupuesto mensual (USD)" htmlFor="a-month">
              <Input id="a-month" type="number" min={0} step={1} value={c.limits.monthlyCostUsd ?? ""} onChange={(e) => setNested("limits", { monthlyCostUsd: num(e.target.value, null) })} />
            </Field>
            <Field label="Timeout (ms)" htmlFor="a-timeout">
              <Input id="a-timeout" type="number" min={1000} max={300000} step={1000} value={c.limits.timeoutMs} onChange={(e) => setNested("limits", { timeoutMs: Number(e.target.value) })} />
            </Field>
          </div>
        </Section>

        <Section title="Structured output" description="JSON Schema opcional. Si se define, el agente responde con un objeto JSON validable.">
          <Textarea
            aria-label="JSON Schema de salida"
            rows={8}
            className="font-mono text-xs"
            value={schemaText}
            onChange={(e) => {
              setSchemaText(e.target.value);
              try {
                if (e.target.value.trim()) JSON.parse(e.target.value);
                setSchemaError(null);
              } catch {
                setSchemaError("JSON no válido");
              }
            }}
          />
          {schemaError ? <p className="text-xs text-danger">{schemaError}</p> : null}
        </Section>
      </fieldset>

      {canEdit ? (
        <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background/95 py-3 backdrop-blur">
          <Button type="submit" disabled={pending || Boolean(schemaError)}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
          {state.ok ? <span className="text-sm text-success">Guardado (v{state.version}).</span> : null}
          {state.error ? <span className="text-sm text-danger">{state.error}</span> : null}
        </div>
      ) : null}
    </form>
  );
}
