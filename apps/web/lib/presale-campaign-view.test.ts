import { describe, expect, it } from "vitest";

import type { CampaignNumbers, CampaignView } from "@/features/presales/api";
import {
  barHeights,
  campaignStateLabel,
  campaignTabs,
  defaultNumbersView,
  fillDays,
  firstOpenInTab,
  notePlace,
  numbersViews,
  percentFromBps,
  pickView,
  placeLabel,
  presaleStageState,
  referrerSite,
  shareSource,
  siteLabel,
  takePlace,
  viewWords,
} from "./presale-campaign-view";

function view(orders: number): CampaignView {
  return {
    views: 0, prebook_clicks: 0, checkout_started: 0, orders, free_copies: 0, refunded_orders: 0, buyers: orders,
    conversion_bps: null, money: null, places: [], links: [], sites: [], timeline: [],
  };
}

function numbers(over: Partial<CampaignNumbers>): CampaignNumbers {
  return {
    release_id: "r", title: "T", release_status: "IN_PRODUCTION", release_at: null, released_at: null, had_presale: true,
    money_visible: true, as_of: "2026-11-06T00:00:00Z", presale: view(200), since_release: null, all: view(200), milestones: [], ...over,
  };
}

describe("campaign words", () => {
  it("names every state with a hint, and keeps unknown states as the API wrote them", () => {
    expect(campaignStateLabel("LIVE")).toMatchObject({ label: "Live", tone: "live" });
    expect(campaignStateLabel("RETURNED").tone).toBe("attention");
    expect(campaignStateLabel("SOMETHING_NEW")).toEqual({ label: "SOMETHING_NEW", tone: "neutral", hint: "" });
  });

  it("reads the campaign state from the release's pre-sale stage", () => {
    expect(presaleStageState("live", "IN_PRODUCTION")).toBe("LIVE");
    expect(presaleStageState("closed", "QC")).toBe("WAITING");
    expect(presaleStageState("waiting", "IDEA")).toBe("IN_REVIEW");
    expect(presaleStageState("returned", "IDEA")).toBe("RETURNED");
    expect(presaleStageState("approved_waiting_price", "IDEA")).toBe("APPROVED");
    expect(presaleStageState("price_needed", "IDEA")).toBe("DRAFT");
    expect(presaleStageState("none", "RELEASED")).toBe("RELEASED");
  });

  it("has four campaign pages under the approved address", () => {
    expect(campaignTabs("abc").map((t) => t.href)).toEqual([
      "/studio/releases/presales/abc",
      "/studio/releases/presales/abc/setup",
      "/studio/releases/presales/abc/page",
      "/studio/releases/presales/abc/share",
    ]);
  });

  it("formats conversion, or says nothing when the API has none", () => {
    expect(percentFromBps(3333)).toBe("33%");
    expect(percentFromBps(150)).toBe("1.5%");
    expect(percentFromBps(0)).toBe("0%");
    expect(percentFromBps(null)).toBeNull();
  });

  it("names places and sites", () => {
    expect(placeLabel("STORE")).toBe("Store");
    expect(placeLabel("??")).toBe("Somewhere else");
    expect(siteLabel("facebook.com")).toBe("facebook.com");
    expect(siteLabel(null)).toMatch(/No site named/);
  });
});

describe("pre-sale, since release, all together", () => {
  it("offers only the pre-sale before release", () => {
    const n = numbers({});
    expect(numbersViews(n).map((v) => v.key)).toEqual(["presale"]);
    expect(defaultNumbersView(n)).toBe("presale");
  });

  it("offers all three once a pre-sold release is out, defaulting to all together", () => {
    const n = numbers({ released_at: "2026-11-12T12:00:00Z", since_release: view(30), all: view(230) });
    expect(numbersViews(n).map((v) => v.label)).toEqual(["Pre-sale only", "Since release", "All together"]);
    expect(defaultNumbersView(n)).toBe("all");
    expect(pickView(n, "presale").orders).toBe(200);
    expect(pickView(n, "since").orders).toBe(30);
    expect(pickView(n, "all").orders).toBe(230);
    expect(viewWords("presale").orders).toBe("Pre-orders");
  });

  it("a release that never had a pre-sale just shows since release", () => {
    const n = numbers({ had_presale: false, released_at: "2026-11-12T12:00:00Z", since_release: view(5), all: view(5) });
    expect(numbersViews(n).map((v) => v.key)).toEqual(["since"]);
  });
});

describe("timeline", () => {
  it("fills the days in between and scales bars", () => {
    const days = fillDays([
      { day: "2026-11-01", views: 4, prebook_clicks: 1, orders: 0 },
      { day: "2026-11-03", views: 2, prebook_clicks: 0, orders: 1 },
    ]);
    expect(days.map((d) => d.day)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(barHeights(days.map((d) => d.views))).toEqual([1, 0, 0.5]);
    expect(barHeights([0, 0])).toEqual([0, 0]);
    expect(fillDays([])).toEqual([]);
  });
});

describe("counting on fan pages", () => {
  it("sends a page open once per tab", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(firstOpenInTab("r1", store)).toBe(true);
    expect(firstOpenInTab("r1", store)).toBe(false);
    expect(firstOpenInTab("r2", store)).toBe(true);
    expect(firstOpenInTab("r3", null)).toBe(true);
  });

  it("remembers which card was opened, once", () => {
    const mem = new Map<string, string>();
    const store = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    notePlace("r1", "STORE", store);
    expect(takePlace("r1", store)).toBe("STORE");
    expect(takePlace("r1", store)).toBe("PAGE");
    mem.set("cr-presale-place:r2", "NOWHERE");
    expect(takePlace("r2", store)).toBe("PAGE");
    expect(takePlace("r3", null)).toBe("PAGE");
  });

  it("reads only a well-formed share code and only the referring host", () => {
    expect(shareSource("?from=Ab3d9xyz")).toBe("ab3d9xyz");
    expect(shareSource("?from=../x")).toBeNull();
    expect(shareSource("")).toBeNull();
    expect(referrerSite("https://l.facebook.com/l.php?u=secret")).toBe("l.facebook.com");
    expect(referrerSite("")).toBeNull();
    expect(referrerSite("not a url")).toBeNull();
  });
});
