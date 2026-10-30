import { describe, expect, it } from "vitest";

import type { PlayableTrackRecord } from "@/lib/api";

import { canModerateMusic, creditDetails, creditPerson, creditPicture, playQueue } from "./music-view";

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

describe("creditDetails (owner, 2026-10-30)", () => {
  const artists = [{ id: "a1", stage_name: "MIZULS" }];
  const credits = [
    { id: "c1", credit_role: "PRIMARY_ARTIST", artist_id: "a1" },
    { id: "c2", credit_role: "SONGWRITER", display_name: "Rafi Ahmed" },
    { id: "c3", credit_role: "musician", role_key: "musician", display_name: "Rafi Ahmed", instrument: "Guitars" },
    { id: "c4", credit_role: "musician", role_key: "musician", display_name: "Tuli", instrument: "Bass" },
    { id: "c5", credit_role: "PERFORMER", artist_id: "a1", instrument: "Vocals" },
    { id: "c6", credit_role: "musician", role_key: "musician", display_name: "Mitu" },
    { id: "c7", credit_role: "custom", role_key: "custom", display_name: "Nadia", instrument: "Cover art" },
  ];
  const label = (r: string) => r.toLowerCase();

  it("lists who made the song, then who played what on it, instrument by instrument", () => {
    const out = creditDetails(credits, artists, label);
    expect(out.main.map((m) => `${m.role}: ${m.name}`)).toEqual([
      "primary_artist: MIZULS",
      "songwriter: Rafi Ahmed",
      "performer: MIZULS",
      // A role the artist named themselves (D-CREDITS-02).
      "Cover art: Nadia",
    ]);
    expect(out.played.map((p) => `${p.plays}: ${p.name}`)).toEqual([
      "Guitars: Rafi Ahmed",
      "Bass: Tuli",
      "Vocals: MIZULS",
      "Played on this song: Mitu",
    ]);
  });

  it("is empty without credits", () => {
    expect(creditDetails([], artists, label)).toEqual({ main: [], played: [] });
  });
});
