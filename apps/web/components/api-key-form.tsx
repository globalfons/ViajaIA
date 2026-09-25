"use client";

import { useActionState, useState } from "react";
import { createApiKeyAction, type CreateKeyState } from "@/lib/actions/api-keys";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

export function ApiKeyForm({ scopes }: { scopes: readonly string[] }) {
  const [state, action, pending] = useActionState<CreateKeyState, FormData>(createApiKeyAction, {});
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      {state.key ? (
        <div className="space-y-2 rounded-md border border-success/40 bg-success/5 p-3 text-sm">
          <p className="font-medium">Copia la clave ahora: no se volverá a mostrar.</p>
          <div className="flex gap-2">
            <Input readOnly value={state.key} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(state.key!);
                setCopied(true);
              }}
            >
              {copied ? "Copiada" : "Copiar"}
            </Button>
          </div>
        </div>
      ) : null}
      <form action={action} className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-52 flex-1 space-y-1.5">
            <Label htmlFor="k-name">Nombre</Label>
            <Input id="k-name" name="name" required maxLength={100} placeholder="Integración web" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="k-exp">Caducidad</Label>
            <Select id="k-exp" name="expiresInDays" defaultValue="365">
              <option value="30">30 días</option>
              <option value="90">90 días</option>
              <option value="365">1 año</option>
              <option value="0">Sin caducidad</option>
            </Select>
          </div>
          <Button type="submit" disabled={pending}>
            Crear clave
          </Button>
        </div>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="mb-1 text-xs text-muted-foreground">Permisos (scopes)</legend>
          {scopes.map((sc) => (
            <label key={sc} className="flex items-center gap-1.5 font-mono text-xs">
              <input type="checkbox" name="scopes" value={sc} defaultChecked={sc === "agents:read" || sc === "agents:run"} />
              {sc}
            </label>
          ))}
        </fieldset>
        {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      </form>
    </div>
  );
}
