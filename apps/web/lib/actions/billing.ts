"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { StripeApiError } from "@dtn/core";
import { addPlanPrice, BillingError, deactivatePlanPrice, NotFoundError, openBillingPortal, startCheckout, stripeOptionsFromEnv } from "@dtn/db";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireOrg, requirePlatformAdmin } from "@/lib/session";

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const billingError = (msg: string) => redirect(`/billing?error=${encodeURIComponent(msg)}`);

export async function checkoutAction(form: FormData) {
  const s = await requireOrg("billing.manage");
  const stripe = stripeOptionsFromEnv();
  if (!stripe) billingError("La facturación online no está activada.");
  const priceId = z.string().regex(/^price_[A-Za-z0-9]+$/).safeParse(form.get("priceId"));
  if (!priceId.success) billingError("Plan no válido");
  let url: string;
  try {
    url = await startCheckout(db(), stripe!, s.org.id, { priceId: priceId.data!, email: s.email ?? null, appUrl: appUrl() });
  } catch (e) {
    billingError(e instanceof BillingError && e.message.includes("already") ? "Ya tienes una suscripción: cámbiala desde «Gestionar suscripción»." : "No se pudo iniciar el pago. Inténtalo de nuevo.");
  }
  await recordAudit({ organizationId: s.org.id, actorId: s.userId, action: "billing.checkout_started", metadata: { priceId: priceId.data } });
  redirect(url!);
}

export async function portalAction() {
  const s = await requireOrg("billing.manage");
  const stripe = stripeOptionsFromEnv();
  if (!stripe) billingError("La facturación online no está activada.");
  let url: string;
  try {
    url = await openBillingPortal(db(), stripe!, s.org.id, `${appUrl()}/billing`);
  } catch {
    billingError("Todavía no hay una cuenta de facturación para esta organización.");
  }
  redirect(url!);
}

export async function addPlanPriceAction(form: FormData) {
  const s = await requirePlatformAdmin();
  const stripe = stripeOptionsFromEnv();
  if (!stripe) redirect("/admin?tab=settings&error=Configura%20STRIPE_SECRET_KEY%20para%20vincular%20precios");
  const parsed = z.object({ plan: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/), priceId: z.string().trim().regex(/^price_[A-Za-z0-9]+$/) }).safeParse({ plan: form.get("plan"), priceId: form.get("priceId") });
  if (!parsed.success) redirect("/admin?tab=settings&error=El%20ID%20debe%20ser%20un%20price_%E2%80%A6%20de%20Stripe");
  try {
    await addPlanPrice(db(), stripe!, parsed.data!.plan, parsed.data!.priceId);
  } catch (e) {
    const msg = e instanceof BillingError ? e.message : e instanceof StripeApiError ? `Stripe: ${e.status === 404 ? "precio no encontrado" : e.message}` : e instanceof NotFoundError ? "Plan no encontrado" : "No se pudo vincular el precio";
    redirect(`/admin?tab=settings&error=${encodeURIComponent(msg)}`);
  }
  await recordAudit({ organizationId: null, actorId: s.userId, actorType: "platform_admin", action: "billing.price_linked", metadata: parsed.data });
  revalidatePath("/admin");
  redirect("/admin?tab=settings&ok=saved");
}

export async function deactivatePlanPriceAction(form: FormData) {
  const s = await requirePlatformAdmin();
  const priceId = z.string().regex(/^price_[A-Za-z0-9]+$/).parse(form.get("priceId"));
  await deactivatePlanPrice(db(), priceId);
  await recordAudit({ organizationId: null, actorId: s.userId, actorType: "platform_admin", action: "billing.price_deactivated", metadata: { priceId } });
  revalidatePath("/admin");
  redirect("/admin?tab=settings&ok=saved");
}
