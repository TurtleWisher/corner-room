import type { EntitlementRecord, OfferRecord } from "@/lib/api";

/*
 * What a signed-in customer already has, read from GET /me/entitlements. Display only: the API
 * still decides playback and purchases. Scopes come from the entitlements module: TRACK (one
 * track, ref_id is the track id), RELEASE (ref_id is the release id; covers every track on it,
 * including ones added later, D-AUDIO-12) and CATALOG (every track, from a pass or a subscription).
 */

const active = (e: EntitlementRecord) => e.status === "ACTIVE";

/** Has the customer anything that unlocks the whole catalog? */
export function hasCatalogAccess(entitlements: EntitlementRecord[]): boolean {
  return entitlements.some((e) => active(e) && e.scope === "CATALOG");
}

/** Has the customer bought this whole release? */
export function ownsRelease(entitlements: EntitlementRecord[], releaseId: string): boolean {
  return entitlements.some((e) => active(e) && e.scope === "RELEASE" && e.ref_id === releaseId);
}

/**
 * Can the customer already play this track (bought it, bought a release it is on, or has catalog
 * access)? `releaseIds` are the releases the page knows the track is on.
 */
export function ownsTrack(entitlements: EntitlementRecord[], trackId: string, releaseIds: readonly string[] = []): boolean {
  return entitlements.some(
    (e) =>
      active(e) &&
      (e.scope === "CATALOG" || (e.scope === "TRACK" && e.ref_id === trackId) || (e.scope === "RELEASE" && releaseIds.includes(e.ref_id))),
  );
}

/** The on-sale offer that sells exactly this track, if any (needs subject_id, OD-27). */
export function offerForTrack(offers: OfferRecord[], trackId: string): OfferRecord | null {
  return offers.find((o) => o.product_type === "TRACK" && o.subject_id === trackId && o.status === "ACTIVE") ?? null;
}

/** The whole-catalog pass, if one is on sale. */
export function catalogOffer(offers: OfferRecord[]): OfferRecord | null {
  return offers.find((o) => o.product_type === "CATALOG_ACCESS" && o.status === "ACTIVE") ?? null;
}

/**
 * The on-sale price for a whole release. Fans who already own some of its songs get the
 * owners' price when ops set one (D-AUDIO-11); everyone else gets the everyone price. The API
 * checks eligibility again at checkout.
 */
export function offerForRelease(
  entitlements: EntitlementRecord[],
  offers: OfferRecord[],
  releaseId: string,
  trackIds: readonly string[],
): OfferRecord | null {
  const onSale = offers.filter((o) => o.product_type === "RELEASE" && o.subject_id === releaseId && o.status === "ACTIVE");
  const ownsPart = entitlements.some((e) => active(e) && e.scope === "TRACK" && trackIds.includes(e.ref_id));
  const partial = ownsPart ? onSale.find((o) => o.audience === "OWNS_PART_OF_RELEASE") : undefined;
  return partial ?? onSale.find((o) => (o.audience ?? "EVERYONE") === "EVERYONE") ?? null;
}

export type BuyState =
  | { kind: "owned"; via: "track" | "release" | "catalog" }
  | { kind: "buy"; offer: OfferRecord }
  | { kind: "not_for_sale" };

/** What a release's buy control should say. Catalog access is not ownership of the release. */
export function releaseBuyState(
  entitlements: EntitlementRecord[],
  offers: OfferRecord[],
  releaseId: string,
  trackIds: readonly string[],
): BuyState {
  if (ownsRelease(entitlements, releaseId)) return { kind: "owned", via: "release" };
  const offer = offerForRelease(entitlements, offers, releaseId, trackIds);
  return offer ? { kind: "buy", offer } : { kind: "not_for_sale" };
}

/** "Buy the album"; "Complete the album" for the owners' price. */
export function releaseBuyLabel(releaseType: string | null | undefined, offer: Pick<OfferRecord, "audience">): string {
  const nouns: Record<string, string> = { ALBUM: "album", EP: "EP", SINGLE: "single" };
  const noun = nouns[(releaseType ?? "").toUpperCase()] ?? "release";
  return offer.audience === "OWNS_PART_OF_RELEASE" ? `Complete the ${noun}` : `Buy the ${noun}`;
}

/** What a track's buy control should say. `releaseIds` are the releases the track is known to be on. */
export function trackBuyState(
  entitlements: EntitlementRecord[],
  offers: OfferRecord[],
  trackId: string,
  releaseIds: readonly string[] = [],
): BuyState {
  if (entitlements.some((e) => active(e) && e.scope === "TRACK" && e.ref_id === trackId)) return { kind: "owned", via: "track" };
  if (entitlements.some((e) => active(e) && e.scope === "RELEASE" && releaseIds.includes(e.ref_id))) return { kind: "owned", via: "release" };
  if (hasCatalogAccess(entitlements)) return { kind: "owned", via: "catalog" };
  const offer = offerForTrack(offers, trackId);
  return offer ? { kind: "buy", offer } : { kind: "not_for_sale" };
}
