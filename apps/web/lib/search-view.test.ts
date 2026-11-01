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
  searchHitPicture,
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

describe("searchResultHref for events", () => {
  it("sends event hits to the public event page, not staff management", async () => {
    const { searchResultHref } = await import("@/lib/search-view");
    expect(searchResultHref("/events/e1", { entity_type: "EVENT", entity_id: "e1" })).toBe("/events/e1");
    expect(searchResultHref("/releases/r1", { entity_type: "RELEASE", entity_id: "r1" })).toBe("/releases/r1");
  });
});

describe("header search (D-MOTION-03)", () => {
  it("suggests the API's best matches that open somewhere, in order, up to the limit", async () => {
    const { searchSuggestions } = await import("@/lib/search-view");
    const hits = [
      { entity_type: "TRACK", entity_id: "t1", route: "/tracks/t1" },
      { entity_type: "BAND", entity_id: "b1", route: "/bands/b1" },
      { entity_type: "USER", entity_id: "u1", route: null },
      { entity_type: "EVENT", entity_id: "e1", route: "/staff/events/e1" },
      { entity_type: "RELEASE", entity_id: "r1", route: "/releases/r1" },
    ];
    expect(searchSuggestions(hits).map((s) => `${s.kind} ${s.href}`)).toEqual([
      "Song /tracks/t1",
      "Artist /bands/b1",
      "Event /events/e1",
      "Release /releases/r1",
    ]);
    expect(searchSuggestions(hits, 2)).toHaveLength(2);
  });

  it("opens with / unless the person is typing", async () => {
    const { isSearchShortcut } = await import("@/lib/search-view");
    expect(isSearchShortcut("/", { tagName: "BODY" })).toBe(true);
    expect(isSearchShortcut("/", null)).toBe(true);
    expect(isSearchShortcut("/", { tagName: "input" })).toBe(false);
    expect(isSearchShortcut("/", { tagName: "DIV", isContentEditable: true })).toBe(false);
    expect(isSearchShortcut("k", { tagName: "BODY" })).toBe(false);
  });
});

describe("searchHitPicture (owner, 2026-11-01)", () => {
  it("uses an artist's or band's approved picture", () => {
    expect(searchHitPicture({ entity_type: "ARTIST", entity_id: "a1", picture: "p1" })).toEqual({ artist: "a1", picture: "p1" });
    expect(searchHitPicture({ entity_type: "BAND", entity_id: "b1", picture: "p2" })).toEqual({ band: "b1", picture: "p2" });
  });

  it("falls back to initials when there is no picture or it is not an act", () => {
    expect(searchHitPicture({ entity_type: "ARTIST", entity_id: "a1", picture: null })).toBeNull();
    expect(searchHitPicture({ entity_type: "BAND", entity_id: "b1" })).toBeNull();
    expect(searchHitPicture({ entity_type: "TRACK", entity_id: "t1", picture: "p3" })).toBeNull();
  });
});
