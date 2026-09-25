import { z } from "zod";

/**
 * White-label branding. Values end up in CSS variables and <img src>, so they
 * are strictly validated (hex colors only, https URLs only) to rule out CSS or
 * markup injection from tenant-controlled data.
 */
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const httpsUrl = z
  .string()
  .url()
  .max(2048)
  .refine((u) => u.startsWith("https://"), "must be https");

export const brandingSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  logo_url: httpsUrl.optional(),
  favicon_url: httpsUrl.optional(),
  colors: z.object({ primary: hex.optional(), accent: hex.optional() }).optional(),
  email_from_name: z.string().trim().max(80).optional(),
  email_from_address: z.string().email().max(320).optional(),
  support_email: z.string().email().max(320).optional(),
});

export type Branding = z.infer<typeof brandingSchema>;

export const DEFAULT_BRAND = { name: "DigitalizaTusNegocios" } as const;

export function parseBranding(raw: unknown): Branding {
  const res = brandingSchema.safeParse(raw ?? {});
  return res.success ? res.data : {};
}

/** "#1d4ed8" → "221 83% 48%" (the format our CSS tokens use). */
export function hexToHslTriplet(color: string): string | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  const r = parseInt(color.slice(1, 3), 16) / 255;
  const g = parseInt(color.slice(3, 5), 16) / 255;
  const b = parseInt(color.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Resolves the brand to display: the org's own when white-label is enabled. */
export function resolveBrand(org: { branding?: unknown; white_label_enabled?: boolean } | null) {
  const b = org?.white_label_enabled ? parseBranding(org.branding) : {};
  const cssVars: Record<string, string> = {};
  const primary = b.colors?.primary && hexToHslTriplet(b.colors.primary);
  const accent = b.colors?.accent && hexToHslTriplet(b.colors.accent);
  if (primary) cssVars["--brand-primary"] = primary;
  if (accent) cssVars["--brand-accent"] = accent;
  return { name: b.name ?? DEFAULT_BRAND.name, logoUrl: b.logo_url ?? null, faviconUrl: b.favicon_url ?? null, cssVars };
}
