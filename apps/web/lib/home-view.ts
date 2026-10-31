import type { EventRecord, ReleaseRecord } from "@/lib/api";
import { sortReleases } from "@/lib/music-view";

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

export type HomeFeature =
  | { kind: "event"; event: EventRecord; label: "Live now" | "Next up" | "Coming up" }
  | { kind: "release"; release: ReleaseRecord; label: "New release" };

/** How many of each kind the hero carousel features at most. */
export const FEATURED_PER_KIND = 3;

/**
 * The hero carousel's slides (owner, 2026-10-31): events that are LIVE now first, then the next
 * upcoming events and the newest released music, taking turns, at most FEATURED_PER_KIND of each.
 * Display selection only; the API's public lists already decided what is public.
 */
export function featuredSlides(events: EventRecord[], releases: ReleaseRecord[], now: Date = new Date(), perKind = FEATURED_PER_KIND): HomeFeature[] {
  const live = events.filter((e) => e.status === "LIVE").slice(0, perKind);
  const upcoming = upcomingEvents(
    events.filter((e) => e.status !== "LIVE"),
    now,
    perKind - live.length,
  );
  const eventSlides: HomeFeature[] = [
    ...live.map((event) => ({ kind: "event" as const, event, label: "Live now" as const })),
    ...upcoming.map((event, i) => ({ kind: "event" as const, event, label: i === 0 && live.length === 0 ? ("Next up" as const) : ("Coming up" as const) })),
  ];
  const releaseSlides: HomeFeature[] = sortReleases(releases.filter((r) => r.status === "RELEASED"))
    .slice(0, perKind)
    .map((release) => ({ kind: "release" as const, release, label: "New release" as const }));
  const liveFirst = eventSlides.slice(0, live.length);
  const rest = eventSlides.slice(live.length);
  const turns: HomeFeature[] = [];
  for (let i = 0; i < Math.max(rest.length, releaseSlides.length); i++) {
    if (rest[i]) turns.push(rest[i]);
    if (releaseSlides[i]) turns.push(releaseSlides[i]);
  }
  return [...liveFirst, ...turns];
}

/** The slide `delta` steps from `index`, wrapping round both ends. */
export function stepSlide(index: number, delta: number, count: number): number {
  return count > 0 ? (((index + delta) % count) + count) % count : 0;
}

/**
 * What the home hero features (owner, 2026-10-25: the newest real thing, never demo data): an event
 * that is LIVE now, else the next upcoming event, else the newest released music. Null only when
 * the public lists have none of these, and the hero then shows the Corner Room cube.
 */
export function pickHomeFeature(events: EventRecord[], releases: ReleaseRecord[], now: Date = new Date()): HomeFeature | null {
  const featured = pickFeaturedEvent(events, now);
  if (featured) return { kind: "event", ...featured };
  const released = releases.filter((r) => r.status === "RELEASED");
  const newest = sortReleases(released)[0];
  return newest ? { kind: "release", release: newest, label: "New release" } : null;
}

/**
 * What the home store band may show, all from the live store: up to two songs or releases on sale,
 * newest first as the API lists them. Corner Room has no plans or whole-catalog pass
 * (D-COMMERCE-01). Selection only; prices are shown exactly as the API gives them.
 */
export function storeHighlights<O extends { product_type: string | null; status: string }>(offers: O[], count = 2): O[] {
  return offers.filter((o) => (o.product_type === "TRACK" || o.product_type === "RELEASE") && o.status === "ACTIVE").slice(0, count);
}
