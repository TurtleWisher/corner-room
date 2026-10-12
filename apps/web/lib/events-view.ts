import type { EventRecord, TicketTypeRecord } from "@/lib/api";
import { upcomingEvents } from "@/lib/home-view";

/*
 * Pure helpers for the public event pages (events.md). Display only: which states can buy is read
 * from the API status values, never decided here; remaining counts are not shown (OD-20).
 */

/** What's On order: live now first, then upcoming soonest first, then anything else the API listed. */
export function whatsOnOrder(events: EventRecord[], now: Date = new Date()): EventRecord[] {
  const live = events.filter((e) => e.status === "LIVE");
  const upcoming = upcomingEvents(events, now, Number.MAX_SAFE_INTEGER).filter((e) => e.status !== "LIVE");
  const seen = new Set([...live, ...upcoming].map((e) => e.id));
  return [...live, ...upcoming, ...events.filter((e) => !seen.has(e.id))];
}

/** Group by month of the start time in the event's own zone ("October 2026"); undated last as "Date to be announced". */
export function groupByMonth(events: EventRecord[]): { label: string; events: EventRecord[] }[] {
  const groups: { label: string; events: EventRecord[] }[] = [];
  for (const event of events) {
    let label = "Date to be announced";
    if (event.starts_at && !Number.isNaN(Date.parse(event.starts_at))) {
      label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: safeZone(event.timezone) }).format(new Date(event.starts_at));
    }
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.events.push(event);
    else groups.push({ label, events: [event] });
  }
  return groups;
}

function safeZone(zone: string | null | undefined): string {
  try {
    if (zone) {
      new Intl.DateTimeFormat("en-GB", { timeZone: zone });
      return zone;
    }
  } catch {
    // fall through
  }
  return "UTC";
}

export type TicketState = { kind: "buy" } | { kind: "sold_out" } | { kind: "unavailable"; label: string };

/** Whether a ticket type can be bought right now, from the event and type statuses the API sent. */
export function ticketState(event: Pick<EventRecord, "status">, type: Pick<TicketTypeRecord, "status" | "remaining">): TicketState {
  if (type.status === "SOLD_OUT" || type.remaining === 0) return { kind: "sold_out" };
  if (event.status !== "TICKETING_OPEN") {
    if (event.status === "CANCELLED") return { kind: "unavailable", label: "Event cancelled" };
    if (event.status === "POSTPONED") return { kind: "unavailable", label: "Sales paused" };
    return { kind: "unavailable", label: "Not on sale yet" };
  }
  if (type.status !== "ON_SALE") return { kind: "unavailable", label: type.status === "CLOSED" ? "Sales closed" : "Not on sale yet" };
  return { kind: "buy" };
}
