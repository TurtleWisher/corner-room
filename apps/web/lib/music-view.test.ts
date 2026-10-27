import { describe, expect, it } from "vitest";

import type { PlayableTrackRecord } from "@/lib/api";

import { canModerateMusic, creditPerson, creditPicture, playQueue } from "./music-view";

function rec(id: string, ok = true): PlayableTrackRecord {
  return { id, title: `T-${id}`, catalog_playable: ok, audio_deliverable: ok, duration_ms: 1000, reason: ok ? null : "NO_AUDIO" } as PlayableTrackRecord;
}

describe("playQueue", () => {
  const playable = new Map([rec("a"), rec("b", false), rec("c"), rec("d")].map((r) => [r.id, r]));

  it("keeps the list's order and only what can be played now", () => {
    const q = playQueue(
      [{ trackId: "a", artist: "X" }, { trackId: "b" }, { trackId: "c", title: "Shown C" }, { trackId: "d" }, { trackId: "zz" }],
      playable,
      (id) => id !== "d",
    );
    expect(q).toEqual([
      { id: "a", title: "T-a", artist: "X" },
      { id: "c", title: "Shown C", artist: null },
    ]);
  });

  it("is empty when nothing can be played", () => {
    expect(playQueue([{ trackId: "b" }], playable, () => true)).toEqual([]);
  });
});

describe("creditPerson", () => {
  const artists = [{ id: "a1", stage_name: "MIZULS" }];
  it("prefers the linked profile, then the name typed in Studio, with the instrument", () => {
    expect(creditPerson({ artist_id: "a1", display_name: "Typed" }, artists)).toBe("MIZULS");
    expect(creditPerson({ display_name: "  Rafi Ahmed " }, artists)).toBe("Rafi Ahmed");
    expect(creditPerson({ display_name: "Rafi Ahmed", instrument: "Guitar" }, artists)).toBe("Rafi Ahmed (Guitar)");
    // A linked profile that is not loaded still shows the typed name.
    expect(creditPerson({ artist_id: "gone", display_name: "Nadia" }, artists)).toBe("Nadia");
  });

  it("names nobody only when there is no profile and no name", () => {
    expect(creditPerson({ display_name: "   " }, artists)).toBeNull();
    expect(creditPerson({}, artists)).toBeNull();
  });
});

describe("canModerateMusic", () => {
  it("is staff who can approve music, not the song's own artist", () => {
    expect(canModerateMusic(["music.write", "music.approve"])).toBe(true);
    expect(canModerateMusic(["music.write"])).toBe(false);
    expect(canModerateMusic(undefined)).toBe(false);
  });
});

describe("creditPicture", () => {
  it("finds the artist's or band's approved picture, or nothing", () => {
    const artists = [{ id: "a1", portrait_asset_id: "p1" }, { id: "a2", portrait_asset_id: null }];
    const bands = [{ id: "b1", portrait_asset_id: "p2" }];
    expect(creditPicture({ primary_artist_id: "a1" }, artists, bands)).toEqual({ artist: "a1", picture: "p1" });
    expect(creditPicture({ primary_band_id: "b1" }, artists, bands)).toEqual({ band: "b1", picture: "p2" });
    expect(creditPicture({ primary_artist_id: "a2" }, artists, bands)).toBeNull();
    expect(creditPicture({}, artists, bands)).toBeNull();
  });
});
