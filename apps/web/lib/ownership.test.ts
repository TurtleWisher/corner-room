import { describe, expect, it } from "vitest";

import type { EntitlementRecord, OfferRecord } from "@/lib/api";
import {
  catalogOffer,
  hasCatalogAccess,
  offerForRelease,
  offerForTrack,
  ownsRelease,
  ownsTrack,
  releaseBuyLabel,
  releaseBuyState,
  trackBuyState,
} from "@/lib/ownership";

const ent = (scope: string, ref_id: string, status = "ACTIVE"): EntitlementRecord => ({
  id: `${scope}-${ref_id}`,
  entitlement_type: "PURCHASE",
  ref_id,
  scope,
  status,
  expires_at: null,
});
const offer = (id: string, product_type: string, subject_id: string | null): OfferRecord => ({
  id,
  organization_id: "o",
  product_id: `p-${id}`,
  product_type,
  name: id,
  subject_id,
  amount_minor: 5000,
  currency_code: "BDT",
  status: "ACTIVE",
  version: null,
});

describe("ownership", () => {
  it("owns a bought track, and every track with catalog access", () => {
    expect(ownsTrack([ent("TRACK", "t1")], "t1")).toBe(true);
    expect(ownsTrack([ent("TRACK", "t1")], "t2")).toBe(false);
    expect(ownsTrack([ent("CATALOG", "sub-1")], "t2")).toBe(true);
    expect(ownsTrack([ent("TRACK", "t1", "REVOKED")], "t1")).toBe(false);
    expect(hasCatalogAccess([ent("CATALOG", "x", "EXPIRED")])).toBe(false);
  });

  it("finds the offer that sells a track, and the catalog pass", () => {
    const offers = [offer("a", "TRACK", "t1"), offer("b", "CATALOG_ACCESS", "r1"), offer("c", "TRACK", null)];
    expect(offerForTrack(offers, "t1")?.id).toBe("a");
    expect(offerForTrack(offers, "t9")).toBeNull();
    expect(catalogOffer(offers)?.id).toBe("b");
  });

  it("says owned, buy or not for sale", () => {
    const offers = [offer("a", "TRACK", "t1")];
    expect(trackBuyState([ent("TRACK", "t1")], offers, "t1")).toEqual({ kind: "owned", via: "track" });
    expect(trackBuyState([ent("CATALOG", "s")], offers, "t1")).toEqual({ kind: "owned", via: "catalog" });
    expect(trackBuyState([], offers, "t1")).toMatchObject({ kind: "buy", offer: { id: "a" } });
    expect(trackBuyState([], offers, "t2")).toEqual({ kind: "not_for_sale" });
  });

  it("counts a bought release as owning every track the page knows is on it", () => {
    const owned = [ent("RELEASE", "r1")];
    expect(ownsRelease(owned, "r1")).toBe(true);
    expect(ownsRelease([ent("RELEASE", "r1", "REVOKED")], "r1")).toBe(false);
    expect(ownsTrack(owned, "t1", ["r1"])).toBe(true);
    expect(ownsTrack(owned, "t1")).toBe(false);
    expect(trackBuyState(owned, [offer("a", "TRACK", "t1")], "t1", ["r1"])).toEqual({ kind: "owned", via: "release" });
    // Catalog access lets you listen but is not owning the release.
    expect(ownsRelease([ent("CATALOG", "s")], "r1")).toBe(false);
  });

  it("offers the owners' price only to fans who own part of the release", () => {
    const everyone = offer("all", "RELEASE", "r1");
    const owners = { ...offer("own", "RELEASE", "r1"), audience: "OWNS_PART_OF_RELEASE" };
    const offers = [owners, everyone, offer("other", "RELEASE", "r2")];
    expect(offerForRelease([], offers, "r1", ["t1", "t2"])?.id).toBe("all");
    expect(offerForRelease([ent("TRACK", "t2")], offers, "r1", ["t1", "t2"])?.id).toBe("own");
    expect(offerForRelease([ent("TRACK", "t9")], offers, "r1", ["t1", "t2"])?.id).toBe("all");
    expect(offerForRelease([ent("TRACK", "t1")], [owners], "r1", ["t1"])?.id).toBe("own");
    expect(offerForRelease([], [owners], "r1", ["t1"])).toBeNull();
    expect(releaseBuyState([ent("RELEASE", "r1")], offers, "r1", [])).toEqual({ kind: "owned", via: "release" });
    expect(releaseBuyState([], offers, "r3", [])).toEqual({ kind: "not_for_sale" });
    expect(releaseBuyState([], offers, "r1", [])).toMatchObject({ kind: "buy", offer: { id: "all" } });
  });

  it("names the release buy button", () => {
    expect(releaseBuyLabel("ALBUM", {})).toBe("Buy the album");
    expect(releaseBuyLabel("EP", { audience: "OWNS_PART_OF_RELEASE" })).toBe("Complete the EP");
    expect(releaseBuyLabel(null, { audience: "EVERYONE" })).toBe("Buy the release");
  });
});
