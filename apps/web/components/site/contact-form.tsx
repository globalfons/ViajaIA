"use client";

import Link from "next/link";
import { useActionState } from "react";
import { submitContactAction, type ContactState } from "@/lib/actions/contact";

const field = "h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/60 focus:outline-none";

function Err({ msg }: { msg?: string }) {
  return msg ? <p className="mt-1 text-xs text-rose-300">{msg}</p> : null;
}

export function ContactForm({ interests, defaultInterest }: { interests: { value: string; label: string }[]; defaultInterest?: string }) {
  const [state, action, pending] = useActionState<ContactState, FormData>(submitContactAction, {});
  if (state.ok) {
    return (
      <div role="status" className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-6">
        <p className="text-lg font-semibold text-emerald-200">Mensaje recibido. Gracias.</p>
        <p className="mt-2 text-sm text-slate-300">Te responderemos por email en horario laboral. No te añadiremos a ninguna lista sin tu permiso.</p>
      </div>
    );
  }
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <div>
        <label htmlFor="c-name" className="mb-1.5 block text-sm text-slate-300">
          Nombre *
        </label>
        <input id="c-name" name="name" required maxLength={120} autoComplete="name" className={field} aria-invalid={Boolean(fe.name)} />
        <Err msg={fe.name} />
      </div>
      <div>
        <label htmlFor="c-email" className="mb-1.5 block text-sm text-slate-300">
          Email *
        </label>
        <input id="c-email" name="email" type="email" required maxLength={320} autoComplete="email" className={field} aria-invalid={Boolean(fe.email)} />
        <Err msg={fe.email} />
      </div>
      <div>
        <label htmlFor="c-company" className="mb-1.5 block text-sm text-slate-300">
          Empresa
        </label>
        <input id="c-company" name="company" maxLength={200} autoComplete="organization" className={field} />
      </div>
      <div>
        <label htmlFor="c-phone" className="mb-1.5 block text-sm text-slate-300">
          Teléfono
        </label>
        <input id="c-phone" name="phone" maxLength={40} autoComplete="tel" className={field} />
        <Err msg={fe.phone} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="c-interest" className="mb-1.5 block text-sm text-slate-300">
          ¿Qué te interesa?
        </label>
        <select id="c-interest" name="interest" defaultValue={defaultInterest ?? ""} className={field}>
          <option value="">Aún no lo sé</option>
          {interests.map((i) => (
            <option key={i.value} value={i.value}>
              {i.label}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="c-message" className="mb-1.5 block text-sm text-slate-300">
          Cuéntanos tu caso *
        </label>
        <textarea id="c-message" name="message" required rows={5} maxLength={4000} className={`${field} h-auto py-3`} aria-invalid={Boolean(fe.message)} />
        <Err msg={fe.message} />
      </div>
      {/* Honeypot (hidden from people and assistive tech) */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          No rellenar <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="space-y-2 text-sm text-slate-300 sm:col-span-2">
        <label className="flex items-start gap-3">
          <input type="checkbox" name="privacy" className="mt-1" required />
          <span>
            He leído y acepto la{" "}
            <Link href="/privacidad" className="underline" target="_blank">
              política de privacidad
            </Link>
            . Usaremos tus datos solo para responder a esta solicitud. *
          </span>
        </label>
        <Err msg={fe.privacy} />
        <label className="flex items-start gap-3">
          <input type="checkbox" name="marketing" className="mt-1" />
          <span>Quiero recibir novedades por email (opcional; puedes darte de baja cuando quieras).</span>
        </label>
      </div>
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className="h-11 rounded-full bg-gradient-to-r from-violet-500 to-cyan-500 px-8 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? "Enviando…" : "Enviar"}
        </button>
        {state.error ? (
          <p role="alert" className="mt-3 text-sm text-rose-300">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
