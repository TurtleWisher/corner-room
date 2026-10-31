import { describe, expect, it } from "vitest";

import { byHref, creditedRoles, songsFor } from "./credited-on-view";

const songs = [
  { id: 1, roles: ["Mixing & Mastering"] },
  { id: 2, roles: ["Mixing & Mastering", "Guitars"] },
  { id: 3, roles: ["Artwork", "Artwork"] },
];

describe("creditedRoles", () => {
  it("counts each role once per song, most frequent first", () => {
    expect(creditedRoles(songs)).toEqual([
      { role: "Mixing & Mastering", count: 2 },
      { role: "Artwork", count: 1 },
      { role: "Guitars", count: 1 },
    ]);
    expect(creditedRoles([])).toEqual([]);
  });
});

describe("songsFor", () => {
  it("keeps the songs with that role, or all of them", () => {
    expect(songsFor(songs, "Guitars").map((s) => s.id)).toEqual([2]);
    expect(songsFor(songs, null)).toBe(songs);
  });
});

describe("byHref", () => {
  it("opens the song's artist or band page", () => {
    expect(byHref({ by_id: "a1", by_kind: "SOLO" })).toBe("/artists/a1");
    expect(byHref({ by_id: "b1", by_kind: "BAND" })).toBe("/bands/b1");
    expect(byHref({ by_id: null, by_kind: null })).toBeNull();
  });
});
