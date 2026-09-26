"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { captureError } from "@dtn/core";
import { ContactRateLimitError, createContactRequest } from "@dtn/db";
import { db } from "@/lib/db";

export interface ContactState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const schema = z.object({
  name: z.string().trim().min(2, "Indica tu nombre").max(120),
  email: z.string().trim().email("Email no válido").max(320),
  company: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).regex(/^[+0-9 ()-]*$/, "Teléfono no válido").optional(),
  interest: z.string().trim().max(60).optional(),
  message: z.string().trim().min(10, "Cuéntanos un poco más (mínimo 10 caracteres)").max(4000),
  privacy: z.literal("on", { message: "Debes aceptar la política de privacidad" }),
  marketing: z.string().optional(),
});

/** Public contact form. Stored only; nobody is emailed automatically. */
export async function submitContactAction(_prev: ContactState, form: FormData): Promise<ContactState> {
  // Honeypot: bots fill every field. Pretend success, store nothing.
  if (String(form.get("website") ?? "").length > 0) return { ok: true };
  const raw = Object.fromEntries(["name", "email", "company", "phone", "interest", "message", "privacy", "marketing"].map((k) => [k, form.get(k) ?? undefined]));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Revisa los campos marcados.", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  }
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  try {
    await createContactRequest(
      db(),
      {
        name: parsed.data.name,
        email: parsed.data.email,
        company: parsed.data.company,
        phone: parsed.data.phone,
        interest: parsed.data.interest,
        message: parsed.data.message,
        privacyAccepted: true,
        marketingConsent: parsed.data.marketing === "on",
        sourcePath: "/contacto",
      },
      ip,
    );
    return { ok: true };
  } catch (e) {
    if (e instanceof ContactRateLimitError) return { error: "Has enviado varias solicitudes seguidas. Inténtalo de nuevo más tarde." };
    captureError(e, { route: "contact" });
    return { error: "No hemos podido enviar tu mensaje. Inténtalo de nuevo en unos minutos." };
  }
}
