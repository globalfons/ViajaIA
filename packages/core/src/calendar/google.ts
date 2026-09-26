import type { Interval } from "./slots";

/**
 * Google Calendar via OAuth 2.0 (authorization code + offline refresh token).
 * Scopes are the minimum for availability + creating events. Events are created
 * without attendees and with sendUpdates=none: Google sends no email on our behalf.
 */

export interface GoogleEndpoints {
  auth: string;
  token: string;
  revoke: string;
  calendar: string;
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  calendar: "https://www.googleapis.com/calendar/v3",
};

export const GOOGLE_CALENDAR_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"];

/** Base URL overrides exist for tests (a local test double); production uses Google. */
export function googleEndpointsFromEnv(env: Record<string, string | undefined> = process.env): GoogleEndpoints {
  return {
    auth: env.GOOGLE_OAUTH_AUTH_URL || GOOGLE_ENDPOINTS.auth,
    token: env.GOOGLE_OAUTH_TOKEN_URL || GOOGLE_ENDPOINTS.token,
    revoke: env.GOOGLE_OAUTH_REVOKE_URL || GOOGLE_ENDPOINTS.revoke,
    calendar: env.GOOGLE_CALENDAR_BASE_URL || GOOGLE_ENDPOINTS.calendar,
  };
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export function buildGoogleAuthUrl(p: { clientId: string; redirectUri: string; state: string; endpoints?: GoogleEndpoints }): string {
  const u = new URL((p.endpoints ?? GOOGLE_ENDPOINTS).auth);
  u.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: p.state,
  }).toString();
  return u.toString();
}

async function tokenRequest(params: Record<string, string>, endpoints: GoogleEndpoints, f: typeof fetch) {
  const res = await f(endpoints.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; scope?: string; id_token?: string };
  if (!res.ok || !body.access_token) throw new GoogleApiError(`Google token endpoint ${res.status}: ${body.error ?? "no access token"}`, res.status);
  return body;
}

export async function exchangeGoogleCode(p: { code: string; clientId: string; clientSecret: string; redirectUri: string; endpoints?: GoogleEndpoints; fetch?: typeof fetch }) {
  const b = await tokenRequest(
    { grant_type: "authorization_code", code: p.code, client_id: p.clientId, client_secret: p.clientSecret, redirect_uri: p.redirectUri },
    p.endpoints ?? GOOGLE_ENDPOINTS,
    p.fetch ?? fetch,
  );
  if (!b.refresh_token) throw new GoogleApiError("Google did not return a refresh token (revoke the app access and connect again)", 400);
  if (b.scope && !b.scope.includes("calendar.events")) throw new GoogleApiError("Calendar permission was not granted", 400);
  return { accessToken: b.access_token!, refreshToken: b.refresh_token, scope: b.scope ?? "", email: idTokenEmail(b.id_token) };
}

/** Email claim of an id_token received directly from Google's token endpoint over TLS (display only). */
function idTokenEmail(idToken: string | undefined): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split(".")[1]!, "base64url").toString("utf8")) as { email?: string };
    return typeof payload.email === "string" ? payload.email.slice(0, 320) : null;
  } catch {
    return null;
  }
}

export async function refreshGoogleAccessToken(p: { refreshToken: string; clientId: string; clientSecret: string; endpoints?: GoogleEndpoints; fetch?: typeof fetch }): Promise<string> {
  const b = await tokenRequest({ grant_type: "refresh_token", refresh_token: p.refreshToken, client_id: p.clientId, client_secret: p.clientSecret }, p.endpoints ?? GOOGLE_ENDPOINTS, p.fetch ?? fetch);
  return b.access_token!;
}

export async function revokeGoogleToken(token: string, endpoints: GoogleEndpoints = GOOGLE_ENDPOINTS, f: typeof fetch = fetch): Promise<void> {
  await f(endpoints.revoke, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }).toString(), signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}

export interface GoogleCalendarClientOptions {
  accessToken: string;
  calendarId?: string;
  endpoints?: GoogleEndpoints;
  fetch?: typeof fetch;
}

async function calendarApi<T>(o: GoogleCalendarClientOptions, path: string, init: RequestInit = {}): Promise<T> {
  const res = await (o.fetch ?? fetch)(`${(o.endpoints ?? GOOGLE_ENDPOINTS).calendar}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${o.accessToken}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new GoogleApiError(`Google Calendar ${res.status}: ${String(body.error?.message ?? "request failed").slice(0, 200)}`, res.status);
  return body;
}

export async function googleBusy(o: GoogleCalendarClientOptions, timeMin: Date, timeMax: Date): Promise<Interval[]> {
  const calendarId = o.calendarId ?? "primary";
  const b = await calendarApi<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>(o, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: calendarId }] }),
  });
  const cal = b.calendars?.[calendarId] ?? Object.values(b.calendars ?? {})[0];
  return (cal?.busy ?? []).map((x) => ({ start: new Date(x.start), end: new Date(x.end) }));
}

export async function googleCreateEvent(o: GoogleCalendarClientOptions, e: { start: Date; end: Date; summary: string; description: string; timeZone: string }) {
  const calendarId = encodeURIComponent(o.calendarId ?? "primary");
  const b = await calendarApi<{ id?: string; htmlLink?: string }>(o, `/calendars/${calendarId}/events?sendUpdates=none`, {
    method: "POST",
    body: JSON.stringify({
      summary: e.summary.slice(0, 300),
      description: e.description.slice(0, 4000),
      start: { dateTime: e.start.toISOString(), timeZone: e.timeZone },
      end: { dateTime: e.end.toISOString(), timeZone: e.timeZone },
      reminders: { useDefault: true },
    }),
  });
  return { id: b.id ?? null, htmlLink: b.htmlLink ?? null };
}
