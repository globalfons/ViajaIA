"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  CreditCard,
  Gauge,
  LayoutDashboard,
  MessagesSquare,
  Plug,
  Settings,
  Shield,
  Sparkles,
  Target,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { NAV_ITEMS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Sparkles,
  Building2,
  Bot,
  Workflow,
  BookOpen,
  MessagesSquare,
  Target,
  Zap,
  Plug,
  BarChart3,
  Gauge,
  CreditCard,
  Settings,
  Shield,
};

export interface SidebarProps {
  brandName: string;
  logoUrl?: string | null;
  isPlatformAdmin?: boolean;
  className?: string;
  onNavigate?: () => void;
}

export function Sidebar({ brandName, logoUrl, isPlatformAdmin, className, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  // Clients only see modules that work; the agency sees the roadmap too.
  const visible = isPlatformAdmin ? NAV_ITEMS : NAV_ITEMS.filter((i) => i.ready);
  const items = isPlatformAdmin ? [...visible, { href: "/admin", label: "Platform Admin", icon: "Shield", ready: true, phase: 2 }] : visible;

  return (
    <aside className={cn("flex h-full w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:w-60", className)}>
      <div className="flex h-14 items-center gap-2 px-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-7 w-7 rounded" />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded bg-primary text-xs font-bold text-primary-foreground">
            AI
          </div>
        )}
        <span className="truncate text-sm font-semibold">{brandName}</span>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {items.map((item) => {
          const Icon = ICONS[item.icon] ?? LayoutDashboard;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          if (!item.ready) {
            return (
              <div
                key={item.href}
                aria-disabled
                title={`Disponible en la fase ${item.phase}`}
                className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-muted/60"
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                <span className="text-[10px] uppercase tracking-wide">F{item.phase}</span>
              </div>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "bg-white/10 text-white" : "text-sidebar-muted hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
