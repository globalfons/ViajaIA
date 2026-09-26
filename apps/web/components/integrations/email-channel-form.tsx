"use client";

import { useActionState } from "react";
import { createEmailChannelAction, type EmailChannelState } from "@/lib/actions/channels";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

export function EmailChannelForm({ agents, secrets, appUrl }: { agents: { id: string; name: string; status: string }[]; secrets: string[]; appUrl: string }) {
  const [state, action, pending] = useActionState<EmailChannelState, FormData>(createEmailChannelAction, {});
  return (
    <div className="space-y-3">
      {state.token ? (
        <div className="space-y-2 rounded-md border border-success/40 bg-success/5 p-3 text-sm">
          <p className="font-medium">Canal creado. Copia el token ahora: no se volverá a mostrar.</p>
          <Label htmlFor="em-url">URL del webhook de entrada</Label>
          <Input id="em-url" readOnly value={`${appUrl}${state.webhookPath}`} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <Label htmlFor="em-token">Cabecera Authorization</Label>
          <Input id="em-token" readOnly value={`Bearer ${state.token}`} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        </div>
      ) : null}
      <form action={action} className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="em-name">Nombre</Label>
          <Input id="em-name" name="name" required maxLength={120} placeholder="Correo de atención" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="em-agent">Agente</Label>
          <Select id="em-agent" name="agentId" required>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} {a.status !== "active" ? "(no activo)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="em-from">Remitente (dominio verificado en Resend)</Label>
          <Input id="em-from" name="fromAddress" required maxLength={320} placeholder="Clínica Sol <hola@clinicasol.es>" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="em-key">Credencial con la API key de Resend</Label>
          <Select id="em-key" name="apiKeySecret" required defaultValue={secrets.includes("RESEND_API_KEY") ? "RESEND_API_KEY" : undefined}>
            {secrets.length ? null : <option value="RESEND_API_KEY">RESEND_API_KEY (guárdala en Credenciales)</option>}
            {secrets.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="autoSend" className="mt-1" />
          <span>
            Enviar automáticamente las respuestas del agente. Si no lo marcas, cada respuesta queda como <strong>borrador</strong> y una persona la revisa y envía
            desde Conversations. Nunca se responde a correos automáticos (fuera de oficina, rebotes, listas).
          </span>
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending}>
            Crear canal de email
          </Button>
          {state.error ? <p className="mt-2 text-sm text-danger">{state.error}</p> : null}
        </div>
      </form>
    </div>
  );
}
