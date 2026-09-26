import "server-only";

export const GOOGLE_STATE_COOKIE = "dtn_goauth";
export const GOOGLE_COOKIE_PATH = "/api/integrations/google";

export function googleOAuthConfig(env: Record<string, string | undefined> = process.env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  const appUrl = (env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: `${appUrl}/api/integrations/google/callback`, secure: appUrl.startsWith("https://") };
}
