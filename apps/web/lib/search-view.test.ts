import { describe, expect, it } from "vitest";

import {
  GUEST_SEARCH_ENTITY_TYPES,
  SEARCH_NO_QUERY,
  SEARCH_NO_RESULTS,
  allowedSearchEntityTypes,
  buildSearchHref,
  isGuestLikeSearch,
  keepApiSearchOrder,
  sanitizeSearchEntityType,
  searchEmptyKind,
  searchResultHref,
} from "./search-view";

describe("search guest vs staff types", () => {
  it("treats guests and users without a workspace as guest-like", () => {
    expect(isGuestLikeSearch(false, null)).toBe(true);
    expect(isGuestLikeSearch(true, null)).toBe(true);
    expect(isGuestLikeSearch(true, "org-1")).toBe(false);
  });

  it("does not let guests request USER, ORGANIZATION, CAMPAIGN, or VENUE", () => {
    for (const disallowed of ["USER", "ORGANIZATION", "CAMPAIGN", "VENUE"]) {
      expect(sanitizeSearchEntityType(disallowed, true)).toBeNull();
    }
    expect(allowedSearchEntityTypes(true)).toEqual([...GUEST_SEARCH_ENTITY_TYPES]);
    expect(sanitizeSearchEntityType("ARTIST", true)).toBe("ARTIST");
  });

  it("allows staff workspace types from the API schema", () => {
    expect(sanitizeSearchEntityType("VENUE", false)).toBe("VENUE");
    expect(sanitizeSearchEntityType("CAMPAIGN", false)).toBe("CAMPAIGN");
  });
});

describe("search results", () => {
  it("keeps API order and does not invent ranking", () => {
    const items = [{ title: "B" }, { title: "A" }];
    expect(keepApiSearchOrder(items)).toEqual(items);
  });

  it("uses the API route when present and does not guess URLs", () => {
    expect(searchResultHref("/artists/abc")).toBe("/artists/abc");
    expect(searchResultHref(null)).toBeNull();
  });

  it("paginates with cursor query state, not page numbers", () => {
    expect(buildSearchHref("night", "ARTIST", "cur-1")).toBe(
      "/search?q=night&entity_type=ARTIST&cursor=cur-1",
    );
    expect(buildSearchHref("night", "ARTIST", "cur-1")).not.toMatch(/page=/);
    expect(buildSearchHref("night", "ARTIST", "cur-1")).not.toMatch(/total=/);
  });

  it("distinguishes no query, no results, and error copy", () => {
    expect(searchEmptyKind("", false, 0)).toBe("prompt");
    expect(searchEmptyKind("night", false, 0)).toBe("empty");
    expect(searchEmptyKind("night", true, 0)).toBe("error");
    expect(SEARCH_NO_QUERY).not.toMatch(/nothing exists/i);
    expect(SEARCH_NO_RESULTS).not.toMatch(/nothing exists/i);
  });
});
