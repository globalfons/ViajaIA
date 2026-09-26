/**
 * Role-based access control. RLS in Postgres is the source of truth for data
 * isolation; this matrix drives the UI and the API layer so that users get a
 * clear 403 instead of an empty result, and keeps both in sync.
 */
export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  "org.read": ["owner", "admin", "member", "viewer"],
  "org.update": ["owner", "admin"],
  "org.branding": ["owner", "admin"],
  "members.read": ["owner", "admin", "member", "viewer"],
  "members.invite": ["owner", "admin"],
  "members.remove": ["owner", "admin"],
  "billing.read": ["owner", "admin"],
  "billing.manage": ["owner"],
  "agents.read": ["owner", "admin", "member", "viewer"],
  "agents.write": ["owner", "admin", "member"],
  "agents.run": ["owner", "admin", "member"],
  "workflows.read": ["owner", "admin", "member", "viewer"],
  "workflows.write": ["owner", "admin", "member"],
  "workflows.run": ["owner", "admin", "member"],
  "approvals.decide": ["owner", "admin", "member"],
  "knowledge.read": ["owner", "admin", "member", "viewer"],
  "knowledge.write": ["owner", "admin", "member"],
  "conversations.read": ["owner", "admin", "member", "viewer"],
  "conversations.reply": ["owner", "admin", "member"],
  "crm.read": ["owner", "admin", "member", "viewer"],
  "crm.write": ["owner", "admin", "member"],
  "integrations.read": ["owner", "admin", "member", "viewer"],
  "integrations.manage": ["owner", "admin"],
  "secrets.manage": ["owner", "admin"],
  "usage.read": ["owner", "admin", "member", "viewer"],
  "audit.read": ["owner", "admin"],
  "api_keys.manage": ["owner", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission, opts: { platformAdmin?: boolean } = {}): boolean {
  if (opts.platformAdmin) return true;
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(readonly permission: string) {
    super(`Forbidden: missing permission ${permission}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: Role | null | undefined, permission: Permission, opts: { platformAdmin?: boolean } = {}) {
  if (!can(role, permission, opts)) throw new ForbiddenError(permission);
}
