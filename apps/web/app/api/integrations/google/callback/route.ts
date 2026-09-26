import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { captureError, exchangeGoogleCode, googleEndpointsFromEnv } from "@dtn/core";
import { saveGoogleCalendarConnection } from "@dtn/db";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { GOOGLE_COOKIE_PATH, GOOGLE_STATE_COOKIE, googleOAuthConfig } from "@/lib/google-oauth";
import { requireOrg } from "@/lib/session";

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function GET(req: NextRequest) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/integrations?${q}`, appUrl));
    res.cookies.set(GOOGLE_STATE_COOKIE, "", { path: GOOGLE_COOKIE_PATH, maxAge: 0 });
    return res;
  };
  const s = await requireOrg("integrations.manage");
  const cfg = googleOAuthConfig();
  if (!cfg) return back("error=Google%20Calendar%20no%20est%C3%A1%20configurado");
  const q = req.nextUrl.searchParams;
  const [nonce, orgId] = (req.cookies.get(GOOGLE_STATE_COOKIE)?.value ?? "").split(".");
  // CSRF / mix-up protection: state must match this browser's cookie and the active organization.
  if (!nonce || !orgId || !same(q.get("state") ?? "", nonce) || orgId !== s.org.id) return back("error=La%20conexi%C3%B3n%20con%20Google%20caduc%C3%B3.%20Int%C3%A9ntalo%20de%20nuevo");
  if (q.get("error")) return back("error=Google%20no%20concedi%C3%B3%20el%20acceso");
  const code = q.get("code");
  if (!code) return back("error=Respuesta%20de%20Google%20no%20v%C3%A1lida");
  try {
    const tokens = await exchangeGoogleCode({ code, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri, endpoints: googleEndpointsFromEnv() });
    await saveGoogleCalendarConnection(db(), s.org.id, { refreshToken: tokens.refreshToken, account: tokens.email }, s.userId);
    await recordAudit({ organizationId: s.org.id, actorId: s.userId, action: "integration.google_calendar.connected", targetType: "integration", metadata: { account: tokens.email } });
  } catch (e) {
    captureError(e, { route: "google/callback", organizationId: s.org.id });
    return back("error=No%20se%20pudo%20completar%20la%20conexi%C3%B3n%20con%20Google");
  }
  return back("ok=calendar");
}
