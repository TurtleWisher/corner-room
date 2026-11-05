import { describe, expect, it } from "vitest";

import type { Feature } from "@/features/feature-updates/api";
import { areasOf, dayLabel, featureLine, filterFeatures, latest, NO_FILTER, totals } from "@/lib/feature-updates-view";

const features: Feature[] = [
  {
    id: "presales",
    name: "Pre-sales",
    area: "Music",
    audience: ["Fans", "Artists"],
    summary: "Sell before release",
    description: "Pre-book button and release day.",
    first_date: "2026-10-25",
    last_date: "2026-11-06",
    updates: [
      { date: "2026-11-06", kind: "NEW", title: "Campaigns", details: "Live numbers in Studio" },
      { date: "2026-10-30", kind: "FIXED", title: "Late buyers", details: "Claimed on verification" },
      { date: "2026-10-25", kind: "NEW", title: "Buyers before launch", details: "Get the song" },
    ],
  },
  {
    id: "search",
    name: "Search",
    area: "Fans",
    audience: ["Fans"],
    summary: "Find music",
    description: "Header search bar.",
    first_date: "2026-09-12",
    last_date: "2026-11-01",
    updates: [{ date: "2026-11-01", kind: "FIXED", title: "Jumping bar", details: "No longer jumps" }],
  },
];

describe("filterFeatures", () => {
  it("keeps everything with no filter", () => {
    expect(filterFeatures(features, NO_FILTER).map((f) => f.id)).toEqual(["presales", "search"]);
  });

  it("filters by area and by kind, narrowing the updates shown", () => {
    expect(filterFeatures(features, { ...NO_FILTER, area: "Fans" }).map((f) => f.id)).toEqual(["search"]);
    const fixes = filterFeatures(features, { ...NO_FILTER, kind: "FIXED" });
    expect(fixes.map((f) => f.id)).toEqual(["presales", "search"]);
    expect(fixes[0].updates.map((u) => u.title)).toEqual(["Late buyers"]);
  });

  it("searches every word, showing only matching updates when the feature itself doesn't match", () => {
    const hit = filterFeatures(features, { ...NO_FILTER, query: "live NUMBERS" });
    expect(hit.map((f) => f.id)).toEqual(["presales"]);
    expect(hit[0].updates.map((u) => u.title)).toEqual(["Campaigns"]);
    expect(filterFeatures(features, { ...NO_FILTER, query: "pre-sales" })[0].updates).toHaveLength(3);
    expect(filterFeatures(features, { ...NO_FILTER, query: "nothing like this" })).toEqual([]);
  });
});

describe("summaries", () => {
  it("counts kinds, lists areas and the latest updates", () => {
    expect(totals(features)).toEqual({ NEW: 2, IMPROVED: 0, FIXED: 2, ALL: 4 });
    expect(areasOf(features)).toEqual(["Fans", "Music"]);
    expect(latest(features, 2).map((u) => `${u.feature}: ${u.title}`)).toEqual(["Pre-sales: Campaigns", "Search: Jumping bar"]);
  });

  it("writes days without time zones", () => {
    expect(dayLabel("2026-11-06")).toBe("6 Nov 2026");
    expect(dayLabel("soon")).toBe("soon");
    expect(featureLine(features[1])).toBe("Since 12 Sep 2026 · 1 update");
  });
});
