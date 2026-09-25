import type { CSSProperties } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SetupChecklist } from "@/components/setup-checklist";
import { resolveBrand } from "@/lib/branding";
import { requireSession } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Setup mode: without Supabase there is no auth, so only show the checklist.
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex min-h-screen">
        <Sidebar brandName="DigitalizaTusNegocios" />
        <main className="h-screen flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl p-6 lg:p-8">
            <h1 className="mb-2 text-xl font-semibold">Modo configuración</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Configura Supabase para activar la autenticación y el resto de módulos.
            </p>
            <SetupChecklist />
          </div>
        </main>
      </div>
    );
  }

  const session = await requireSession();
  const brand = resolveBrand(session.org);
  return (
    <div className="flex min-h-screen" style={brand.cssVars as CSSProperties}>
      <Sidebar brandName={brand.name} logoUrl={brand.logoUrl} isPlatformAdmin={session.isPlatformAdmin} />
      <div className="flex h-screen flex-1 flex-col">
        <Topbar
          org={session.org}
          organizations={session.organizations}
          email={session.email}
          isPlatformAdmin={session.isPlatformAdmin}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
