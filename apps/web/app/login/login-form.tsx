"use client";

import { useActionState, useState } from "react";
import { signInWithMagicLink, signInWithPassword, type AuthState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"password" | "magic">("password");
  // Controlled: React 19 resets uncontrolled fields after a form action, which
  // would wipe the email after a failed attempt.
  const [email, setEmail] = useState("");
  const [pwState, pwAction, pwPending] = useActionState<AuthState, FormData>(signInWithPassword, {});
  const [mlState, mlAction, mlPending] = useActionState<AuthState, FormData>(signInWithMagicLink, {});
  const state = mode === "password" ? pwState : mlState;

  return (
    <form action={mode === "password" ? pwAction : mlAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {mode === "password" ? (
        <div className="space-y-1.5">
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} />
        </div>
      ) : null}
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state.message ? <p className="text-sm text-success">{state.message}</p> : null}
      <Button type="submit" className="w-full" disabled={pwPending || mlPending}>
        {mode === "password" ? "Entrar" : "Enviar enlace de acceso"}
      </Button>
      <button
        type="button"
        className="w-full text-center text-xs text-muted-foreground hover:underline"
        onClick={() => setMode(mode === "password" ? "magic" : "password")}
      >
        {mode === "password" ? "Entrar con enlace mágico por email" : "Entrar con contraseña"}
      </button>
    </form>
  );
}
