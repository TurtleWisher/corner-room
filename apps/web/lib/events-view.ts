import type { EventRecord, TicketTypeRecord } from "@/lib/api";
import { cityFromTimeZone, upcomingEvents } from "@/lib/home-view";

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

/** Event statuses with no purchase, and what a ticket says in each (events.md section 5). */
const NO_SALE_LABEL: Record<string, string> = {
  PUBLISHED: "Not on sale yet",
  SALES_CLOSED: "Sales closed",
  LIVE: "Happening now",
  COMPLETED: "Event ended",
  POSTPONED: "Sales paused",
  CANCELLED: "Event cancelled",
};

/** Whether a ticket type can be bought right now, from the event and type statuses the API sent. */
export function ticketState(event: Pick<EventRecord, "status">, type: Pick<TicketTypeRecord, "status" | "remaining">): TicketState {
  if (type.status === "SOLD_OUT" || type.remaining === 0) return { kind: "sold_out" };
  if (event.status !== "TICKETING_OPEN") return { kind: "unavailable", label: NO_SALE_LABEL[event.status] ?? "Not on sale" };
  if (type.status !== "ON_SALE") return { kind: "unavailable", label: type.status === "CLOSED" ? "Sales closed" : "Not on sale yet" };
  return { kind: "buy" };
}

/** The city a poster prints: the venue's city when the API names one, else the event's time zone city. */
export function eventCity(event: Pick<EventRecord, "timezone" | "venue">): string | null {
  return event.venue?.city ?? cityFromTimeZone(event.timezone);
}

/**
 * The poster eyebrow: city and weekday in the event's own zone ("Dhaka · Saturday"). Real data
 * only; never the word "Live" on its own, which reads as "happening now".
 */
export function eventEyebrow(event: Pick<EventRecord, "timezone" | "starts_at" | "venue">): string {
  const city = eventCity(event);
  let weekday: string | null = null;
  if (event.starts_at && !Number.isNaN(Date.parse(event.starts_at))) {
    weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: safeZone(event.timezone) }).format(new Date(event.starts_at));
  }
  return [city, weekday].filter(Boolean).join(" · ") || "Live music";
}

/**
 * The lowest price among the ticket types that can be bought right now ("From ৳1,500"). Picked,
 * never calculated; null when nothing is on sale or the on-sale prices are in different currencies.
 */
export function fromPrice(
  event: Pick<EventRecord, "status">,
  types: readonly Pick<TicketTypeRecord, "status" | "remaining" | "price_amount_minor" | "currency_code">[],
): { amount_minor: number; currency_code: string } | null {
  const buyable = types.filter((t) => ticketState(event, t).kind === "buy");
  if (buyable.length === 0) return null;
  if (new Set(buyable.map((t) => t.currency_code)).size > 1) return null;
  const lowest = buyable.reduce((a, b) => (b.price_amount_minor < a.price_amount_minor ? b : a));
  return { amount_minor: lowest.price_amount_minor, currency_code: lowest.currency_code };
}

/** "3 acts" or "1 act"; null when no act is confirmed yet. */
export function actsLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 act" : `${count} acts`;
}

/**
 * What's On sections (D-EV-02): events still to come (or happening now) first, then a separate
 * Past section for ended events the API returns (Q-P4-08 decides whether it returns them).
 */
export function splitPast(events: EventRecord[], now: Date = new Date()): { current: EventRecord[]; past: EventRecord[] } {
  const current: EventRecord[] = [];
  const past: EventRecord[] = [];
  for (const e of events) {
    const end = e.ends_at ?? e.starts_at;
    const over = e.status === "COMPLETED" || (e.status !== "LIVE" && e.status !== "POSTPONED" && !!end && Date.parse(end) < now.getTime());
    (over ? past : current).push(e);
  }
  past.sort((a, b) => Date.parse(b.starts_at ?? "") - Date.parse(a.starts_at ?? ""));
  return { current, past };
}
