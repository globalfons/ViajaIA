import {
  googleBusy,
  googleCreateEvent,
  GoogleApiError,
  googleEndpointsFromEnv,
  normalizeCalendarSettings,
  refreshGoogleAccessToken,
  revokeGoogleToken,
  type CalendarProvider,
  type CalendarResolver,
  type CalendarSettings,
} from "@dtn/core";
import { assertOrgActive, NotFoundError } from "./agents";
import type { Queryable } from "./pool";
import { deleteSecret, getSecret, setSecret } from "./secrets";

/**
 * Google Calendar connection per organization. The refresh token is stored in
 * the encrypted secrets store; the OAuth client (GOOGLE_CLIENT_ID/SECRET) is the
 * agency's and comes from the environment.
 */

export const GOOGLE_REFRESH_SECRET = "GOOGLE_CALENDAR_REFRESH_TOKEN";

export interface CalendarConnection {
  status: "connected" | "error";
  account: string | null;
  settings: CalendarSettings;
  last_error: string | null;
}

export async function saveGoogleCalendarConnection(db: Queryable, organizationId: string, p: { refreshToken: string; account: string | null }, userId: string | null) {
  await assertOrgActive(db, organizationId);
  await setSecret(db, organizationId, GOOGLE_REFRESH_SECRET, p.refreshToken, { userId });
  await db.query(
    `insert into public.integration_connections (organization_id, provider, status, account, settings, connected_by)
     values ($1, 'google_calendar', 'connected', $2, $3, $4)
     on conflict (organization_id, provider) do update set status = 'connected', account = excluded.account, last_error = null, connected_by = excluded.connected_by`,
    [organizationId, p.account, normalizeCalendarSettings({}), userId],
  );
}

export async function getCalendarConnection(db: Queryable, organizationId: string): Promise<CalendarConnection | null> {
  const { rows } = await db.query<CalendarConnection>(
    "select status, account, settings, last_error from public.integration_connections where organization_id = $1 and provider = 'google_calendar'",
    [organizationId],
  );
  return rows[0] ? { ...rows[0], settings: normalizeCalendarSettings(rows[0].settings) } : null;
}

export async function updateCalendarSettings(db: Queryable, organizationId: string, settings: Partial<CalendarSettings>) {
  const s = normalizeCalendarSettings(settings);
  const res = await db.query("update public.integration_connections set settings = $2 where organization_id = $1 and provider = 'google_calendar'", [organizationId, s]);
  if (!res.rowCount) throw new NotFoundError("Calendar connection");
  return s;
}

export async function disconnectGoogleCalendar(db: Queryable, organizationId: string, env: Record<string, string | undefined> = process.env, f?: typeof fetch) {
  const token = await getSecret(db, organizationId, GOOGLE_REFRESH_SECRET).catch(() => null);
  if (token) await revokeGoogleToken(token, googleEndpointsFromEnv(env), f);
  await deleteSecret(db, organizationId, GOOGLE_REFRESH_SECRET).catch(() => undefined);
  await db.query("delete from public.integration_connections where organization_id = $1 and provider = 'google_calendar'", [organizationId]);
}

/** Resolves the calendar of the tool's organization (null when not connected). */
export function calendarResolver(db: Queryable, env: Record<string, string | undefined> = process.env, f?: typeof fetch): CalendarResolver {
  return async (ctx) => {
    const conn = await getCalendarConnection(db, ctx.organizationId);
    if (!conn || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
    const refreshToken = await getSecret(db, ctx.organizationId, GOOGLE_REFRESH_SECRET);
    if (!refreshToken) return null;
    const endpoints = googleEndpointsFromEnv(env);
    let accessToken: string;
    try {
      accessToken = await refreshGoogleAccessToken({ refreshToken, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, endpoints, fetch: f });
    } catch (e) {
      // Revoked or expired consent: surface it in Integrations so the client reconnects.
      if (e instanceof GoogleApiError && e.status >= 400 && e.status < 500) {
        await db.query("update public.integration_connections set status = 'error', last_error = $2 where organization_id = $1 and provider = 'google_calendar'", [
          ctx.organizationId,
          "Google rechazó el acceso: vuelve a conectar el calendario",
        ]);
        return null;
      }
      throw e;
    }
    if (conn.status === "error") await db.query("update public.integration_connections set status = 'connected', last_error = null where organization_id = $1 and provider = 'google_calendar'", [ctx.organizationId]);
    const client = { accessToken, endpoints, fetch: f };
    const provider: CalendarProvider = {
      settings: conn.settings,
      busy: (min, max) => googleBusy(client, min, max),
      createEvent: (e) => googleCreateEvent(client, { ...e, timeZone: conn.settings.timeZone }),
    };
    return provider;
  };
}
