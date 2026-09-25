/**
 * Main navigation. `ready: false` entries render as disabled (never as links to
 * empty pages) until the phase that implements them lands.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: string;
  ready: boolean;
  phase: number;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", ready: true, phase: 1 },
  { href: "/clients", label: "Clients", icon: "Building2", ready: true, phase: 2 },
  { href: "/agents", label: "Agents", icon: "Bot", ready: false, phase: 4 },
  { href: "/workflows", label: "Workflows", icon: "Workflow", ready: false, phase: 5 },
  { href: "/knowledge", label: "Knowledge", icon: "BookOpen", ready: false, phase: 6 },
  { href: "/conversations", label: "Conversations", icon: "MessagesSquare", ready: false, phase: 7 },
  { href: "/leads", label: "Leads", icon: "Target", ready: false, phase: 8 },
  { href: "/automations", label: "Automations", icon: "Zap", ready: false, phase: 5 },
  { href: "/integrations", label: "Integrations", icon: "Plug", ready: false, phase: 9 },
  { href: "/analytics", label: "Analytics", icon: "BarChart3", ready: false, phase: 3 },
  { href: "/usage", label: "Usage", icon: "Gauge", ready: false, phase: 3 },
  { href: "/billing", label: "Billing", icon: "CreditCard", ready: false, phase: 10 },
  { href: "/settings", label: "Settings", icon: "Settings", ready: true, phase: 2 },
];
