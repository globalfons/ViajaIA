import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Flash } from "@/components/flash";
import { Button } from "@/components/ui/button";
import { requirePlatformAdmin } from "@/lib/session";
import { ListTab } from "./_tabs/lists";
import { OverviewTab } from "./_tabs/overview";
import { SettingsTab } from "./_tabs/settings";

export const metadata = { title: "Platform Admin" };

const TABS = [
  ["overview", "Resumen"],
  ["users", "Usuarios"],
  ["agents", "Agentes"],
  ["workflows", "Workflows"],
  ["conversations", "Conversaciones"],
  ["leads", "Leads"],
  ["errors", "Errores"],
  ["audit", "Auditoría"],
  ["billing", "Facturación"],
  ["templates", "Plantillas"],
  ["contacts", "Contactos"],
  ["settings", "Configuración"],
] as const;

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  return (
    <>
      <PageHeader
        title="Platform Admin"
        description="Administración global de la plataforma: solo visible para la agencia."
        actions={
          <Link href="/clients">
            <Button variant="outline">Gestionar clientes</Button>
          </Link>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b" aria-label="Secciones de administración">
        {TABS.map(([k, label]) => (
          <Link
            key={k}
            href={k === "overview" ? "/admin" : `/admin?tab=${k}`}
            aria-current={tab === k ? "page" : undefined}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm ${tab === k ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === "overview" ? <OverviewTab /> : tab === "settings" ? <SettingsTab /> : <ListTab tab={tab} q={sp.q} />}
    </>
  );
}
