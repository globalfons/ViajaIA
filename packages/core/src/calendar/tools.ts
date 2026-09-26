import { z } from "zod";
import { defineTool, type ToolContext, type ToolDefinition } from "../tools/registry";
import { computeFreeSlots, formatSlot, localDate, slotProblem, type CalendarSettings, type Interval } from "./slots";

/**
 * Calendar tools for appointment agents. The provider is resolved per
 * organization on the server (OAuth tokens never reach the model). Creating
 * an appointment re-checks availability and working hours right before writing.
 */

export interface CalendarProvider {
  settings: CalendarSettings;
  busy(timeMin: Date, timeMax: Date): Promise<Interval[]>;
  createEvent(e: { start: Date; end: Date; summary: string; description: string }): Promise<{ id: string | null }>;
}

export type CalendarResolver = (ctx: ToolContext) => Promise<CalendarProvider | null>;

export const CALENDAR_TOOL_NAMES = ["calendar_find_slots", "calendar_create_appointment"] as const;

const NOT_CONNECTED = { ok: false, error: "No calendar is connected for this business. Offer to take the customer's details so the team can call them back." };

export function createCalendarTools(resolve: CalendarResolver): ToolDefinition[] {
  return [
    defineTool({
      name: "calendar_find_slots",
      description:
        "Lists free appointment slots in the business calendar (working hours only). Call it before proposing times. Returns ISO start times and human-readable labels in the business time zone.",
      parameters: z.object({
        from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("First day to search (YYYY-MM-DD). Defaults to today."),
        days: z.number().int().min(1).max(14).optional().describe("Number of days to search (default 7)."),
        duration_minutes: z.number().int().min(10).max(240).optional(),
      }),
      risk: "read",
      async execute(args, ctx) {
        const cal = await resolve(ctx);
        if (!cal) return NOT_CONNECTED;
        const s = cal.settings;
        const today = localDate(new Date(), s.timeZone);
        const fromDate = args.from_date && args.from_date > today ? args.from_date : today;
        const days = args.days ?? 7;
        const [y, m, d] = fromDate.split("-").map(Number) as [number, number, number];
        const busy = await cal.busy(new Date(Date.UTC(y, m - 1, d - 1)), new Date(Date.UTC(y, m - 1, d + days + 1)));
        const slots = computeFreeSlots(s, busy, { fromDate, days, durationMinutes: args.duration_minutes, max: 10 });
        return {
          ok: true,
          timeZone: s.timeZone,
          durationMinutes: args.duration_minutes ?? s.slotMinutes,
          slots: slots.map((x) => ({ start: x.start.toISOString(), label: formatSlot(x.start, s.timeZone) })),
        };
      },
    }),
    defineTool({
      name: "calendar_create_appointment",
      description:
        "Books an appointment in the business calendar. Only call it after the customer explicitly confirmed day, time, service and name. The start must be one of the slots returned by calendar_find_slots.",
      parameters: z.object({
        start: z.string().datetime({ offset: true }).describe("ISO start time from calendar_find_slots."),
        duration_minutes: z.number().int().min(10).max(240).optional(),
        customer_name: z.string().trim().min(1).max(120),
        service: z.string().trim().min(1).max(200),
        contact: z.string().trim().max(200).optional().describe("Phone or email the customer gave for this appointment."),
        notes: z.string().trim().max(1000).optional(),
      }),
      risk: "write",
      async execute(args, ctx) {
        const cal = await resolve(ctx);
        if (!cal) return NOT_CONNECTED;
        const s = cal.settings;
        const start = new Date(args.start);
        const slot = { start, end: new Date(start.getTime() + (args.duration_minutes ?? s.slotMinutes) * 60000) };
        const busy = await cal.busy(new Date(slot.start.getTime() - 3600_000), new Date(slot.end.getTime() + 3600_000));
        const problem = slotProblem(s, slot, busy);
        if (problem) return { ok: false, error: `Cannot book: ${problem}. Use calendar_find_slots to offer valid times.` };
        const event = await cal.createEvent({
          start: slot.start,
          end: slot.end,
          summary: `${args.service} · ${args.customer_name}`,
          description: [
            `Cliente: ${args.customer_name}`,
            args.contact ? `Contacto: ${args.contact}` : null,
            `Servicio: ${args.service}`,
            args.notes ? `Notas: ${args.notes}` : null,
            "",
            `Cita creada por el asistente de IA${ctx.conversationId ? ` (conversación ${ctx.conversationId})` : ""}.`,
          ]
            .filter((l) => l !== null)
            .join("\n"),
        });
        return { ok: true, eventId: event.id, start: slot.start.toISOString(), label: formatSlot(slot.start, s.timeZone) };
      },
    }),
  ];
}
