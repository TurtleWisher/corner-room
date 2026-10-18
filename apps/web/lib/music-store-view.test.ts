import { describe, expect, it } from "vitest";

import type { OfferRecord, PlayableTrackRecord } from "@/lib/api";
import {
  creditHref,
  creditName,
  formatDuration,
  playState,
  releaseEyebrow,
  releaseTypeLabel,
  sortReleases,
  trackCountLabel,
} from "@/lib/music-view";
import {
  afterPurchaseHref,
  checkoutItemFromParams,
  groupOffers,
  intervalLabel,
  offerTitle,
  planName,
  trialLabel,
} from "@/lib/store-view";

const params = (q: string) => new URLSearchParams(q);

describe("music view", () => {
  it("labels release types", () => {
    expect(releaseTypeLabel("EP")).toBe("EP");
    expect(releaseTypeLabel("ALBUM")).toBe("Album");
    expect(releaseTypeLabel("REMIX")).toBe("Remix");
    expect(releaseTypeLabel(null)).toBe("Release");
  });

  it("finds the credited artist or band", () => {
    const artists = [{ id: "a1", stage_name: "Rumi" }];
    const bands = [{ id: "b1", name: "The Static" }];
    expect(creditName({ primary_artist_id: "a1" }, artists, bands)).toBe("Rumi");
    expect(creditName({ primary_band_id: "b1" }, artists, bands)).toBe("The Static");
    expect(creditName({ primary_artist_id: "missing" }, artists, bands)).toBeNull();
    expect(creditHref({ primary_band_id: "b1" })).toBe("/bands/b1");
    expect(creditHref({})).toBeNull();
  });

  it("formats durations and never guesses", () => {
    expect(formatDuration(185_000)).toBe("3:05");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
  });

  it("adds total minutes only when every duration is known", () => {
    expect(trackCountLabel([60_000, 120_000])).toBe("2 tracks · 3 min");
    expect(trackCountLabel([60_000, null])).toBe("2 tracks");
    expect(trackCountLabel([60_000])).toBe("1 track · 1 min");
    expect(trackCountLabel([])).toBe("0 tracks");
  });

  it("builds the release eyebrow from what is known", () => {
    expect(releaseEyebrow({ release_type: "EP" }, "Kaal Bela", 5)).toBe("EP · Kaal Bela · 5 tracks");
    expect(releaseEyebrow({ release_type: "SINGLE" }, null, null)).toBe("Single");
  });

  it("states playability honestly", () => {
    const base = { id: "t", title: "T", status: "RELEASED" } as PlayableTrackRecord;
    expect(playState(undefined)).toEqual({ kind: "unknown" });
    expect(playState({ ...base, catalog_playable: true, audio_deliverable: true })).toEqual({ kind: "playable" });
    expect(playState({ ...base, catalog_playable: true, audio_deliverable: false, reason: "NO_READY_MASTER" })).toEqual({
      kind: "unavailable",
      reason: "No ready master",
    });
  });

  it("sorts releases newest first, undated last", () => {
    const rows = [
      { title: "B", release_at: null },
      { title: "Old", release_at: "2025-01-01T00:00:00Z" },
      { title: "New", release_at: "2026-01-01T00:00:00Z" },
      { title: "A", release_at: null },
    ];
    expect(sortReleases(rows).map((r) => r.title)).toEqual(["New", "Old", "A", "B"]);
  });
});

describe("store view", () => {
  it("names plans from their key until the API sends names", () => {
    expect(planName("premium_monthly")).toBe("Premium monthly");
  });

  it("labels intervals and trials only from API fields", () => {
    expect(intervalLabel({ interval: "month", interval_count: 1 })).toBe("/ month");
    expect(intervalLabel({ interval: "MONTH", interval_count: 3 })).toBe("/ 3 months");
    expect(intervalLabel({ interval: "fortnight", interval_count: 1 })).toBeNull();
    expect(trialLabel({ trial_days: 14 })).toBe("14-day trial");
    expect(trialLabel({ trial_days: null })).toBeNull();
    expect(trialLabel({ trial_days: 0 })).toBeNull();
  });

  it("groups offers by product type, tracks first", () => {
    const offer = (id: string, product_type: string | null) =>
      ({ id, product_type, name: id, amount_minor: 100, currency_code: "BDT" }) as OfferRecord;
    const groups = groupOffers([offer("c", "CATALOG_ACCESS"), offer("t", "TRACK"), offer("x", null)]);
    expect(groups.map((g) => g.label)).toEqual(["Tracks", "Full catalog", "Other"]);
  });

  it("lists release prices after tracks and keeps owners' prices off the store", () => {
    const offer = (id: string, product_type: string, audience?: string) =>
      ({ id, product_type, audience, name: id, amount_minor: 100, currency_code: "BDT" }) as OfferRecord;
    const groups = groupOffers([offer("c", "CATALOG_ACCESS"), offer("r", "RELEASE"), offer("own", "RELEASE", "OWNS_PART_OF_RELEASE"), offer("t", "TRACK")]);
    expect(groups.map((g) => g.label)).toEqual(["Tracks", "Albums and EPs", "Full catalog"]);
    expect(groups[1].offers.map((o) => o.id)).toEqual(["r"]);
    expect(afterPurchaseHref({ kind: "offer", id: "o" }, { product_type: "RELEASE", subject_id: "r1" }).href).toBe("/releases/r1");
  });

  it("titles offers from the product name", () => {
    expect(offerTitle({ name: " Low Tide ", product_type: "TRACK" })).toBe("Low Tide");
    expect(offerTitle({ name: null, product_type: "CATALOG_ACCESS" })).toBe("Full catalog");
  });

  it("reads the checkout item and the next step", () => {
    expect(checkoutItemFromParams(params("offer=o1"))).toEqual({ kind: "offer", id: "o1" });
    expect(checkoutItemFromParams(params("plan=p1"))).toEqual({ kind: "plan", id: "p1" });
    expect(checkoutItemFromParams(params("ticketTypeId=t1"))).toEqual({ kind: "tickets", id: "t1" });
    expect(checkoutItemFromParams(params(""))).toBeNull();
    expect(afterPurchaseHref({ kind: "offer", id: "o1" }).href).toBe("/purchases");
    expect(afterPurchaseHref({ kind: "offer", id: "o1" }, { product_type: "TRACK", subject_id: "t1" }).href).toBe("/tracks/t1");
    expect(afterPurchaseHref({ kind: "plan", id: "p" }).label).toBe("Start listening");
    expect(afterPurchaseHref({ kind: "tickets", id: "t" }).href).toBe("/tickets");
  });
});

describe("ticket checkout params", () => {
  it("carries the event so checkout can name the tickets", () => {
    expect(checkoutItemFromParams(new URLSearchParams("ticketTypeId=t1&event=e1"))).toEqual({ kind: "tickets", id: "t1", eventId: "e1" });
  });
});
