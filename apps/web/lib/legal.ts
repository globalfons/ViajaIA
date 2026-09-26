import "server-only";

/** Legal identity of the site owner, from the environment. Never invented. */
export function legalInfo(env: Record<string, string | undefined> = process.env) {
  const missing = "[pendiente de completar por el titular]";
  return {
    company: env.LEGAL_COMPANY_NAME || missing,
    taxId: env.LEGAL_TAX_ID || missing,
    address: env.LEGAL_ADDRESS || missing,
    email: env.LEGAL_EMAIL || env.CONTACT_EMAIL || missing,
    complete: Boolean(env.LEGAL_COMPANY_NAME && env.LEGAL_TAX_ID && env.LEGAL_ADDRESS && (env.LEGAL_EMAIL || env.CONTACT_EMAIL)),
  };
}
