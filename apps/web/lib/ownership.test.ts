import { describe, expect, it } from "vitest";

import type { EntitlementRecord, OfferRecord } from "@/lib/api";
import { catalogOffer, hasCatalogAccess, offerForTrack, ownsTrack, trackBuyState } from "@/lib/ownership";

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
});
