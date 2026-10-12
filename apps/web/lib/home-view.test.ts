import { describe, expect, it } from "vitest";

import type { EventRecord } from "@/lib/api";
import { cityFromTimeZone, pickFeaturedEvent, pickNextEvent, upcomingEvents } from "@/lib/home-view";

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
