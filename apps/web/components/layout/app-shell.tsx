"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Sidebar, type SidebarProps } from "./sidebar";
import { cn } from "@/lib/utils";

/**
 * Responsive shell: static sidebar on desktop (lg+), off-canvas drawer with
 * overlay on tablet/mobile. Closes on navigation and Escape.
 */
export function AppShell({ sidebar, topbar, children, style }: { sidebar: SidebarProps; topbar: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="flex h-dvh overflow-hidden" style={style}>
      <Sidebar {...sidebar} className="hidden lg:flex" />
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" aria-label="Cerrar menú" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative h-full w-64 max-w-[85vw] shadow-xl">
            <Sidebar {...sidebar} onNavigate={() => setOpen(false)} />
            <button type="button" aria-label="Cerrar menú" onClick={() => setOpen(false)} className="absolute right-2 top-3 rounded p-1.5 text-white/80 hover:bg-white/10">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center border-b bg-card">
          <button
            type="button"
            aria-label="Abrir menú"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className={cn("ml-2 rounded p-2 text-muted-foreground hover:bg-muted lg:hidden")}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">{topbar}</div>
        </div>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
