import { describe, expect, it } from "vitest";

import type { TrendingItem } from "@/features/trending/api";
import type { EntitlementRecord, OfferRecord } from "@/lib/api";
import {
  discPose,
  easeInOutCubic,
  easeOutQuint,
  frontIndex,
  itemDurationMs,
  itemHref,
  kindLabel,
  landingFor,
  mod,
  movePick,
  offsetOf,
  pickTravel,
  poseTransform,
  positionFor,
  spinBoost,
  trendingAccess,
  turnDuration,
} from "./trending-view";

function item(over: Partial<TrendingItem> = {}): TrendingItem {
  return {
    id: "pick-1",
    kind: "RELEASE",
    title: "Chaya Pore",
    track_id: null,
    release_id: "rel-1",
    release_title: "Chaya Pore",
    release_type: "SINGLE",
    released_at: null,
    has_cover: true,
    primary_artist_id: null,
    primary_band_id: "band-1",
    listens: 641,
    tracks: [{ id: "trk-1", title: "Chaya Pore", duration_ms: 225_000, release_ids: ["rel-1"], teaser_id: null, listens: 641 }],
    ...over,
  };
}

function offer(over: Partial<OfferRecord>): OfferRecord {
  return {
    id: "off-1",
    organization_id: "org",
    product_id: "prod",
    product_type: "RELEASE",
    name: "Chaya Pore",
    subject_id: "rel-1",
    amount_minor: 11500,
    currency_code: "BDT",
    status: "ACTIVE",
    version: 1,
    audience: "EVERYONE",
    release_type: "SINGLE",
    ...over,
  };
}

const owns = (scope: string, ref_id: string) => ({ scope, ref_id, status: "ACTIVE" }) as unknown as EntitlementRecord;

describe("ring positions", () => {
  it("wraps indexes and offsets the shortest way round", () => {
    expect(mod(-1, 5)).toBe(4);
    expect(offsetOf(4, 0, 5)).toBe(-1);
    expect(offsetOf(1, 0, 5)).toBe(1);
    expect(offsetOf(0, 4.5, 5)).toBeCloseTo(0.5);
    // One or two items never loop.
    expect(offsetOf(1, 0, 2)).toBe(1);
    expect(offsetOf(0, 1, 2)).toBe(-1);
  });

  it("names the disc in front and the way to bring one forward", () => {
    expect(frontIndex(0.4, 5)).toBe(0);
    expect(frontIndex(-0.6, 5)).toBe(4);
    expect(frontIndex(7.2, 5)).toBe(2);
    expect(frontIndex(3, 2)).toBe(1);
    expect(frontIndex(-1, 1)).toBe(0);
    expect(positionFor(4, 0, 5)).toBe(-1);
    expect(positionFor(1, 0, 2)).toBe(1);
  });

  it("lands a drag on the nearest disc, carried on by a flick, inside the ends", () => {
    expect(landingFor(1.3, 0, 5)).toBe(1);
    expect(landingFor(1.3, 6, 5)).toBe(3);
    expect(landingFor(1.3, -40, 5)).toBe(-1);
    expect(landingFor(-0.4, -3, 1)).toBe(0);
    expect(landingFor(1.4, 5, 2)).toBe(1);
  });

  it("spins once round a big ring when a disc is picked, the short way on a small one", () => {
    expect(pickTravel(2, 0, 6)).toBe(8);
    expect(pickTravel(5, 0, 6)).toBe(-7);
    expect(pickTravel(2, 0, 3)).toBe(-1);
    expect(pickTravel(0, 0, 6)).toBe(0);
  });
});

describe("disc poses", () => {
  it("stands the front disc flat and nearest", () => {
    const p = discPose(0, 5, 160);
    expect(p).toMatchObject({ x: 0, z: -0, rotateY: -0, scale: 1, opacity: 1, shade: 0, label: 1 });
  });

  it("turns, sets back and dims the discs to either side, mirrored", () => {
    const right = discPose(1, 7, 160);
    const left = discPose(-1, 7, 160);
    expect(right.x).toBe(160);
    expect(left.x).toBe(-160);
    expect(right.rotateY).toBe(-40);
    expect(left.rotateY).toBe(40);
    expect(right.z).toBeLessThan(0);
    expect(right.shade).toBeGreaterThan(0);
    // Further ones tuck in closer than the first step.
    expect(discPose(2, 7, 160).x - right.x).toBeLessThan(160);
  });

  it("fades discs out before they cross behind, so a small ring never jumps", () => {
    expect(discPose(1.45, 3, 160).opacity).toBe(0);
    expect(discPose(3, 9, 160).opacity).toBe(0);
    expect(discPose(1, 9, 160).opacity).toBe(1);
  });

  it("writes a compact transform", () => {
    expect(poseTransform(discPose(0, 5, 160))).toBe("translate3d(0.0px, 0, 0.0px) rotateY(0.00deg) scale(1.0000)");
  });
});

describe("timing", () => {
  it("eases stay inside 0..1 and end where they start and finish", () => {
    for (const ease of [easeOutQuint, easeInOutCubic]) {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      expect(ease(2)).toBe(1);
      expect(ease(-1)).toBe(0);
    }
    expect(easeOutQuint(0.2)).toBeGreaterThan(0.6);
  });

  it("gives every kind of turn a bounded length and speeds the spin while travelling", () => {
    expect(turnDuration(0, "pick")).toBe(0);
    expect(turnDuration(8, "pick")).toBeLessThanOrEqual(1150);
    expect(turnDuration(1, "auto")).toBe(1100);
    expect(spinBoost(0)).toBe(1);
    expect(spinBoost(100)).toBe(15);
  });
});

describe("the mini player", () => {
  it("says what the item is and where it opens", () => {
    expect(kindLabel(item())).toBe("Single");
    expect(kindLabel(item({ release_type: "ALBUM" }))).toBe("Album");
    expect(kindLabel(item({ kind: "TRACK" }))).toBe("Song");
    expect(itemHref(item())).toBe("/releases/rel-1");
    expect(itemHref(item({ kind: "TRACK", track_id: "trk-1" }))).toBe("/tracks/trk-1");
  });

  it("names other release types as the rest of the site does, and moves picks within the ends", () => {
    expect(kindLabel(item({ release_type: "LIVE" }))).not.toBe("Song");
    expect(movePick(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(movePick(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(movePick(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });

  it("adds the length only when every song's is known", () => {
    expect(itemDurationMs(item())).toBe(225_000);
    expect(itemDurationMs(item({ tracks: [] }))).toBeNull();
    expect(itemDurationMs(item({ tracks: [{ ...item().tracks[0], duration_ms: null }] }))).toBeNull();
  });

  it("plays the whole song for owners", () => {
    const access = trendingAccess(item(), { entitlements: [owns("RELEASE", "rel-1")], offers: [] }, true);
    expect(access).toEqual({ kind: "play" });
  });

  it("plays the teaser for everyone else, with the price beside it", () => {
    const teased = item({ tracks: [{ ...item().tracks[0], teaser_id: "tz-1" }] });
    const access = trendingAccess(teased, { entitlements: [], offers: [offer({})] }, true);
    expect(access).toMatchObject({ kind: "teaser", teaserId: "tz-1", trackId: "trk-1", signIn: false });
    expect(access.kind === "teaser" && access.buy?.label).toBe("Buy the single");
    // Visitors hear the teaser too; owning is never assumed without signing in.
    expect(trendingAccess(teased, { entitlements: [owns("RELEASE", "rel-1")], offers: [] }, false)).toMatchObject({ kind: "teaser", signIn: true });
  });

  it("offers only the way to buy when there is no teaser", () => {
    const access = trendingAccess(item(), { entitlements: [], offers: [] }, true);
    expect(access).toEqual({ kind: "buy", buy: null, signIn: false });
    const song = item({ kind: "TRACK", track_id: "trk-1" });
    const own = trendingAccess(song, { entitlements: [], offers: [offer({ id: "off-2", product_type: "TRACK", subject_id: "trk-1" })] }, true);
    expect(own.kind === "buy" && own.buy?.label).toBe("Buy the song");
  });
});
