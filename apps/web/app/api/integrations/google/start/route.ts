import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { buildGoogleAuthUrl, googleEndpointsFromEnv } from "@dtn/core";
import { GOOGLE_COOKIE_PATH, GOOGLE_STATE_COOKIE, googleOAuthConfig } from "@/lib/google-oauth";
import { requireOrg } from "@/lib/session";

/** Starts Google Calendar consent for the active organization (owners/admins). */
export async function GET() {
  const s = await requireOrg("integrations.manage");
  const cfg = googleOAuthConfig();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  if (!cfg) return NextResponse.redirect(new URL("/integrations?error=Google%20Calendar%20no%20est%C3%A1%20configurado%20por%20la%20agencia", appUrl));
  const nonce = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(buildGoogleAuthUrl({ clientId: cfg.clientId, redirectUri: cfg.redirectUri, state: nonce, endpoints: googleEndpointsFromEnv() }));
  // Binds the callback to this browser session and organization (checked again against the session there).
  res.cookies.set(GOOGLE_STATE_COOKIE, `${nonce}.${s.org.id}`, { httpOnly: true, secure: cfg.secure, sameSite: "lax", path: GOOGLE_COOKIE_PATH, maxAge: 600 });
  return res;
}
