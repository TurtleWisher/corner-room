import type { EntitlementRecord, OfferRecord } from "@/lib/api";

/*
 * What a signed-in customer already has, read from GET /me/entitlements. Display only: the API
 * still decides playback and purchases. Scopes come from the entitlements module: TRACK (one
 * track, ref_id is the track id) and CATALOG (every track, from a catalog pass or a subscription).
 */

const active = (e: EntitlementRecord) => e.status === "ACTIVE";

/** Has the customer anything that unlocks the whole catalog? */
export function hasCatalogAccess(entitlements: EntitlementRecord[]): boolean {
  return entitlements.some((e) => active(e) && e.scope === "CATALOG");
}

/** Can the customer already play this track (bought it, or has catalog access)? */
export function ownsTrack(entitlements: EntitlementRecord[], trackId: string): boolean {
  return entitlements.some((e) => active(e) && (e.scope === "CATALOG" || (e.scope === "TRACK" && e.ref_id === trackId)));
}

/** The on-sale offer that sells exactly this track, if any (needs subject_id, OD-27). */
export function offerForTrack(offers: OfferRecord[], trackId: string): OfferRecord | null {
  return offers.find((o) => o.product_type === "TRACK" && o.subject_id === trackId && o.status === "ACTIVE") ?? null;
}

/** The whole-catalog pass, if one is on sale. */
export function catalogOffer(offers: OfferRecord[]): OfferRecord | null {
  return offers.find((o) => o.product_type === "CATALOG_ACCESS" && o.status === "ACTIVE") ?? null;
}

export type BuyState =
  | { kind: "owned"; via: "track" | "catalog" }
  | { kind: "buy"; offer: OfferRecord }
  | { kind: "not_for_sale" };

/** What a track's buy control should say. */
export function trackBuyState(entitlements: EntitlementRecord[], offers: OfferRecord[], trackId: string): BuyState {
  if (entitlements.some((e) => active(e) && e.scope === "TRACK" && e.ref_id === trackId)) return { kind: "owned", via: "track" };
  if (hasCatalogAccess(entitlements)) return { kind: "owned", via: "catalog" };
  const offer = offerForTrack(offers, trackId);
  return offer ? { kind: "buy", offer } : { kind: "not_for_sale" };
}
