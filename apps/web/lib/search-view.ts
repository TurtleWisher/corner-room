export const GUEST_SEARCH_ENTITY_TYPES = ["ARTIST", "BAND", "EVENT", "TRACK", "RELEASE"] as const;

export const STAFF_ONLY_SEARCH_ENTITY_TYPES = ["VENUE", "CAMPAIGN", "USER", "ORGANIZATION"] as const;

export const SCHEMA_SEARCH_ENTITY_TYPES = [
  ...GUEST_SEARCH_ENTITY_TYPES,
  ...STAFF_ONLY_SEARCH_ENTITY_TYPES,
] as const;

export const SEARCH_NO_QUERY = "Enter a search to see matching public catalog and events.";
export const SEARCH_NO_RESULTS = "No matching results for this search.";
export const SEARCH_DEBOUNCE_MS = 300;

export function isGuestLikeSearch(
  authenticated: boolean,
  organizationId: string | null | undefined,
): boolean {
  return !authenticated || !organizationId;
}

export function allowedSearchEntityTypes(guestLike: boolean): readonly string[] {
  return guestLike ? GUEST_SEARCH_ENTITY_TYPES : SCHEMA_SEARCH_ENTITY_TYPES;
}

export function sanitizeSearchEntityType(
  entityType: string | null | undefined,
  guestLike: boolean,
): string | null {
  if (!entityType) {
    return null;
  }
  const wanted = entityType.trim().toUpperCase();
  if (!allowedSearchEntityTypes(guestLike).includes(wanted)) {
    return null;
  }
  return wanted;
}

export function searchEmptyKind(
  q: string,
  hasError: boolean,
  itemCount: number,
): "prompt" | "empty" | "error" | "results" {
  if (hasError) {
    return "error";
  }
  if (!q.trim()) {
    return "prompt";
  }
  if (itemCount === 0) {
    return "empty";
  }
  return "results";
}

export function buildSearchHref(q: string, entityType: string | null, cursor: string | null): string {
  const params = new URLSearchParams();
  if (q) {
    params.set("q", q);
  }
  if (entityType) {
    params.set("entity_type", entityType);
  }
  if (cursor) {
    params.set("cursor", cursor);
  }
  const query = params.toString();
  return query ? `/search?${query}` : "/search";
}

/**
 * Where a hit links. Event hits always go to the public event page (/events/{id}, D-EV-01),
 * whatever route the indexer stored.
 */
export function searchResultHref(route: string | null | undefined, hit?: { entity_type: string; entity_id: string }): string | null {
  if (hit?.entity_type === "EVENT") {
    return `/events/${hit.entity_id}`;
  }
  if (!route) {
    return null;
  }
  return route;
}

export function keepApiSearchOrder<T>(items: T[]): T[] {
  return items;
}

/** One word for what a hit is, in the header's suggestions. Bands are artists too (owner, 2026-10-31). */
const HIT_KIND: Record<string, string> = { EVENT: "Event", ARTIST: "Artist", BAND: "Artist", RELEASE: "Release", TRACK: "Song", VENUE: "Venue", CAMPAIGN: "Campaign", USER: "User", ORGANIZATION: "Organization" };

export type SearchSuggestion<T extends { entity_type: string; entity_id: string; route: string | null }> = { hit: T; href: string; kind: string };

/**
 * The header's live suggestions (D-MOTION-03): the API's best matches in its order, only those that
 * open somewhere, at most `max`.
 */
export function searchSuggestions<T extends { entity_type: string; entity_id: string; route: string | null }>(items: readonly T[], max = 6): SearchSuggestion<T>[] {
  const out: SearchSuggestion<T>[] = [];
  for (const hit of items) {
    const href = searchResultHref(hit.route, hit);
    if (!href) continue;
    out.push({ hit, href, kind: HIT_KIND[hit.entity_type] ?? "Result" });
    if (out.length === max) break;
  }
  return out;
}

/** "/" opens the header search, unless the person is already typing somewhere. */
export function isSearchShortcut(key: string, target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (key !== "/") return false;
  const tag = (target?.tagName ?? "").toUpperCase();
  return !(tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable);
}
