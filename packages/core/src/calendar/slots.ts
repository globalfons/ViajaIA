/**
 * Appointment slot computation in the business' time zone (DST-safe, no deps).
 */

export interface CalendarSettings {
  /** IANA time zone, e.g. "Europe/Madrid". */
  timeZone: string;
  /** Working days, 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** "HH:MM" local time. */
  start: string;
  end: string;
  slotMinutes: number;
  /** Earliest bookable time from now. */
  minNoticeMinutes: number;
}

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = { timeZone: "Europe/Madrid", days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", slotMinutes: 30, minNoticeMinutes: 120 };

export interface Interval {
  start: Date;
  end: Date;
}

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function normalizeCalendarSettings(raw: unknown): CalendarSettings {
  const r = (raw ?? {}) as Partial<CalendarSettings>;
  const d = DEFAULT_CALENDAR_SETTINGS;
  const days = Array.isArray(r.days) ? [...new Set(r.days.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort() : d.days;
  const start = typeof r.start === "string" && HM.test(r.start) ? r.start : d.start;
  const end = typeof r.end === "string" && HM.test(r.end) && r.end > start ? r.end : d.end;
  const slot = Number(r.slotMinutes);
  const notice = Number(r.minNoticeMinutes);
  return {
    timeZone: typeof r.timeZone === "string" && isValidTimeZone(r.timeZone) ? r.timeZone : d.timeZone,
    days: days.length ? days : d.days,
    start,
    end: end > start ? end : d.end,
    slotMinutes: Number.isInteger(slot) && slot >= 10 && slot <= 240 ? slot : d.slotMinutes,
    minNoticeMinutes: Number.isInteger(notice) && notice >= 0 && notice <= 7 * 24 * 60 ? notice : d.minNoticeMinutes,
  };
}

function offsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return (Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}

/** Local wall time in `timeZone` → UTC instant. */
export function zonedTimeToUtc(ymd: string, hm: string, timeZone: string): Date {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const [hh, mm] = hm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = offsetMinutes(new Date(guess), timeZone);
  const t = guess - off1 * 60000;
  const off2 = offsetMinutes(new Date(t), timeZone);
  return new Date(off2 === off1 ? t : guess - off2 * 60000);
}

/** Calendar date (YYYY-MM-DD) of an instant in `timeZone`. */
export function localDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function localTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export function formatSlot(date: Date, timeZone: string, locale = "es-ES"): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(date);
}

const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekday = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Free slots between fromDate and fromDate + days, inside working hours, not overlapping busy intervals. */
export function computeFreeSlots(
  s: CalendarSettings,
  busy: Interval[],
  opts: { fromDate: string; days: number; durationMinutes?: number; now?: Date; max?: number },
): Interval[] {
  const now = opts.now ?? new Date();
  const earliest = new Date(now.getTime() + s.minNoticeMinutes * 60000);
  const dur = (opts.durationMinutes ?? s.slotMinutes) * 60000;
  const out: Interval[] = [];
  for (let i = 0; i < Math.min(opts.days, 31) && out.length < (opts.max ?? 12); i++) {
    const day = addDays(opts.fromDate, i);
    if (!s.days.includes(weekday(day))) continue;
    const dayEnd = zonedTimeToUtc(day, s.end, s.timeZone);
    for (let t = zonedTimeToUtc(day, s.start, s.timeZone).getTime(); t + dur <= dayEnd.getTime(); t += s.slotMinutes * 60000) {
      const slot = { start: new Date(t), end: new Date(t + dur) };
      if (slot.start < earliest || busy.some((b) => overlaps(slot, b))) continue;
      out.push(slot);
      if (out.length >= (opts.max ?? 12)) break;
    }
  }
  return out;
}

/** Why a requested appointment is not bookable (null when it is). */
export function slotProblem(s: CalendarSettings, slot: Interval, busy: Interval[], now = new Date()): string | null {
  if (Number.isNaN(slot.start.getTime())) return "invalid start time";
  if (slot.start.getTime() < now.getTime() + s.minNoticeMinutes * 60000) return "too soon or in the past";
  const day = localDate(slot.start, s.timeZone);
  if (!s.days.includes(weekday(day))) return "outside working days";
  if (localDate(slot.end, s.timeZone) !== day || localTime(slot.start, s.timeZone) < s.start || localTime(slot.end, s.timeZone) > s.end) return "outside working hours";
  if (busy.some((b) => overlaps(slot, b))) return "that time is already taken";
  return null;
}
