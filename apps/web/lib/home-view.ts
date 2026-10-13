import type { EventRecord } from "@/lib/api";

/*
 * Pure helpers for the Stage 5 home page. Display selection only: no business rule decides what
 * is public, the API's public event list already did that.
 */

/** The soonest event in the list that has not started yet, or null. Events without a start time are skipped. */
export function pickNextEvent(events: EventRecord[], now: Date = new Date()): EventRecord | null {
  let next: EventRecord | null = null;
  let nextAt = Infinity;
  for (const event of events) {
    if (!event.starts_at) continue;
    const at = new Date(event.starts_at).getTime();
    if (Number.isNaN(at) || at < now.getTime()) continue;
    if (at < nextAt) {
      next = event;
      nextAt = at;
    }
  }
  return next;
}

/** "Asia/Dhaka" -> "Dhaka". The only real place word the public event read carries (venues need auth). */
export function cityFromTimeZone(timeZone: string | null | undefined): string | null {
  if (!timeZone || !timeZone.includes("/")) return null;
  const city = timeZone.split("/").pop()?.replace(/_/g, " ").trim();
  return city || null;
}

/** Events that have not started yet, soonest first, at most `limit`. Undated events are left out. */
export function upcomingEvents(events: EventRecord[], now: Date = new Date(), limit = 5): EventRecord[] {
  return events
    .filter((e) => e.starts_at && !Number.isNaN(Date.parse(e.starts_at)) && Date.parse(e.starts_at) >= now.getTime())
    .sort((a, b) => Date.parse(a.starts_at as string) - Date.parse(b.starts_at as string))
    .slice(0, limit);
}

export type FeaturedEvent = { event: EventRecord; label: "Live now" | "Next up" };

/**
 * The home page's featured event: an event that is LIVE right now first, otherwise the soonest
 * upcoming one. Null only when the public list has neither.
 */
export function pickFeaturedEvent(events: EventRecord[], now: Date = new Date()): FeaturedEvent | null {
  const live = events.find((e) => e.status === "LIVE");
  if (live) return { event: live, label: "Live now" };
  const next = pickNextEvent(events, now);
  return next ? { event: next, label: "Next up" } : null;
}

/**
 * What the home store band may show, all from the live store: the full-catalog pass if one is on
 * sale, and one plan (the lowest-priced in the pass's currency, or the first plan). Selection only;
 * prices are shown exactly as the API gives them. Null fields mean "do not show".
 */
export function storeHighlights<
  O extends { product_type: string | null; status: string; amount_minor: number; currency_code: string },
  P extends { status: string; price_amount_minor: number; currency_code: string },
>(offers: O[], plans: P[]): { pass: O | null; plan: P | null } {
  const pass = offers.find((o) => o.product_type === "CATALOG_ACCESS" && o.status === "ACTIVE") ?? null;
  const active = plans.filter((p) => p.status === "ACTIVE");
  const currency = pass?.currency_code ?? active[0]?.currency_code;
  const sameCurrency = active.filter((p) => p.currency_code === currency);
  const plan = sameCurrency.length ? sameCurrency.reduce((a, b) => (b.price_amount_minor < a.price_amount_minor ? b : a)) : (active[0] ?? null);
  return { pass, plan };
}
