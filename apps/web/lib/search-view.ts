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

export function searchResultHref(route: string | null | undefined): string | null {
  if (!route) {
    return null;
  }
  return route;
}

export function keepApiSearchOrder<T>(items: T[]): T[] {
  return items;
}
