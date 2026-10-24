import { describe, expect, it } from "vitest";

import type { EventRecord, ReleaseRecord } from "@/lib/api";
import { cityFromTimeZone, pickFeaturedEvent, pickHomeFeature, pickNextEvent, storeHighlights, upcomingEvents } from "@/lib/home-view";

const ev = (id: string, starts_at: string | null): EventRecord => ({
  id,
  venue_id: null,
  title: id,
  description: null,
  status: "TICKETING_OPEN",
  timezone: "Asia/Dhaka",
  starts_at,
  ends_at: null,
});

describe("pickNextEvent", () => {
  const now = new Date("2026-10-11T12:00:00Z");

  it("returns the soonest upcoming event", () => {
    const events = [ev("late", "2026-12-01T14:00:00Z"), ev("soon", "2026-10-20T14:00:00Z"), ev("past", "2026-09-01T14:00:00Z")];
    expect(pickNextEvent(events, now)?.id).toBe("soon");
  });

  it("skips events with no or invalid start times", () => {
    expect(pickNextEvent([ev("tbc", null), ev("bad", "not a date")], now)).toBeNull();
  });

  it("returns null when nothing is upcoming", () => {
    expect(pickNextEvent([ev("past", "2026-01-01T00:00:00Z")], now)).toBeNull();
    expect(pickNextEvent([], now)).toBeNull();
  });
});

describe("cityFromTimeZone", () => {
  it("takes the city part of an IANA zone", () => {
    expect(cityFromTimeZone("Asia/Dhaka")).toBe("Dhaka");
    expect(cityFromTimeZone("America/New_York")).toBe("New York");
  });
  it("returns null when there is no city", () => {
    expect(cityFromTimeZone("UTC")).toBeNull();
    expect(cityFromTimeZone(null)).toBeNull();
  });
});

describe("upcomingEvents", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  it("keeps future dated events, soonest first, up to the limit", () => {
    const events = [ev("c", "2026-12-01T00:00:00Z"), ev("a", "2026-10-12T00:00:00Z"), ev("past", "2026-01-01T00:00:00Z"), ev("tbc", null), ev("b", "2026-11-01T00:00:00Z")];
    expect(upcomingEvents(events, now).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(upcomingEvents(events, now, 2).map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("pickFeaturedEvent", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  it("features a live event before the next upcoming one", () => {
    const live = { ...ev("live", "2026-10-11T10:00:00Z"), status: "LIVE" };
    const featured = pickFeaturedEvent([ev("soon", "2026-10-12T00:00:00Z"), live], now);
    expect(featured).toEqual({ event: live, label: "Live now" });
  });
  it("falls back to the next upcoming event, then null", () => {
    expect(pickFeaturedEvent([ev("soon", "2026-10-12T00:00:00Z")], now)?.label).toBe("Next up");
    expect(pickFeaturedEvent([], now)).toBeNull();
  });
});

describe("storeHighlights", () => {
  const offer = (id: string, product_type: string, status = "ACTIVE") => ({ id, product_type, status, amount_minor: 50, currency_code: "BDT" });

  it("shows up to two songs or releases on sale, never a pass or plan (D-COMMERCE-01)", () => {
    const out = storeHighlights([offer("pass", "CATALOG_ACCESS"), offer("t1", "TRACK"), offer("old", "TRACK", "RETIRED"), offer("r1", "RELEASE"), offer("t2", "TRACK")]);
    expect(out.map((o) => o.id)).toEqual(["t1", "r1"]);
    expect(storeHighlights([offer("plan", "SUBSCRIPTION_PLAN")])).toEqual([]);
    expect(storeHighlights([])).toEqual([]);
  });
});

describe("pickHomeFeature (owner, 2026-10-25: feature the newest real thing)", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const rel = (id: string, release_at: string | null, status = "RELEASED"): ReleaseRecord => ({ id, title: id, release_type: "SINGLE", status, release_at });

  it("features the newest released music when there is no event", () => {
    const pick = pickHomeFeature([], [rel("older", "2026-10-01T00:00:00Z"), rel("debut", "2026-10-26T06:00:00Z"), rel("draft", null, "DRAFT")], now);
    expect(pick).toMatchObject({ kind: "release", label: "New release", release: { id: "debut" } });
  });

  it("keeps an upcoming event first, and a live one before that", () => {
    const events = [ev("gig", "2026-11-02T14:00:00Z")];
    expect(pickHomeFeature(events, [rel("debut", "2026-10-26T06:00:00Z")], now)).toMatchObject({ kind: "event", label: "Next up" });
    const live = { ...ev("now", "2026-10-26T11:00:00Z"), status: "LIVE" };
    expect(pickHomeFeature([...events, live], [], now)).toMatchObject({ kind: "event", label: "Live now", event: { id: "now" } });
  });

  it("features nothing when there are no events and no released music", () => {
    expect(pickHomeFeature([ev("past", "2026-01-01T00:00:00Z")], [rel("draft", null, "DRAFT")], now)).toBeNull();
  });
});
