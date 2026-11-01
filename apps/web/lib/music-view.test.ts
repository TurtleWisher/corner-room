import { describe, expect, it } from "vitest";

import type { PlayableTrackRecord } from "@/lib/api";

import { canModerateMusic, creditDetails, creditLink, creditPerson, creditPicture, playQueue, releaseHeroActions } from "./music-view";

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
    expect(creditPerson({ artist_id: "b1" }, artists, [{ id: "b1", name: "Kaal Bela" }])).toBe("Kaal Bela");
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

  it("lists every credit in order, guest musicians on their own lines", () => {
    const out = creditDetails(credits, artists, label);
    expect(out.main.map((m) => `${m.role}: ${m.name}`)).toEqual([
      "primary_artist: MIZULS",
      "songwriter: Rafi Ahmed",
      "Guitars: Rafi Ahmed",
      "Bass: Tuli",
      "performer · Vocals: MIZULS",
      "Musician: Mitu",
      // A role the artist named themselves (D-CREDITS-02).
      "Cover art: Nadia",
    ]);
    expect(out.main.every((m) => m.members.length === 0)).toBe(true);
  });

  it("folds the people who played in an act under that act's line (D-CREDITS-05)", () => {
    const out = creditDetails(
      [
        { id: "m1", credit_role: "musician", role_key: "musician", display_name: "Samiul", instrument: "Vocals", part_of_artist_id: "a1" },
        { id: "c1", credit_role: "songwriter", role_key: "songwriter", artist_id: "a1" },
        { id: "c2", credit_role: "mixing_engineer", role_key: "mixing_engineer", display_name: "M.K. Khan" },
        { id: "m2", credit_role: "musician", role_key: "musician", display_name: "Rafi", instrument: "Guitars", part_of_artist_id: "a1" },
        { id: "m3", credit_role: "musician", role_key: "musician", display_name: "Tuli", instrument: "Bass", part_of_name: "m.k.  khan" },
        { id: "m4", credit_role: "musician", role_key: "musician", display_name: "Guest", instrument: "Flute", part_of_name: "Gone" },
      ],
      artists,
      label,
    );
    expect(out.main.map((m) => `${m.role}: ${m.name} [${m.members.map((p) => `${p.plays} ${p.name}`).join(", ")}]`)).toEqual([
      "songwriter: MIZULS [Vocals Samiul, Guitars Rafi]",
      "mixing_engineer: M.K. Khan [Bass Tuli]",
      // Their act is not credited on this song: a line of their own.
      "Flute: Guest []",
    ]);
  });

  it("folds every other musician under the song's own artist, typed or linked (owner, 2026-10-31)", () => {
    // The live song: MIZULS typed as a named role, five musicians saved before "Played as part of".
    const song = [
      { id: "c1", credit_role: "custom", role_key: "custom", display_name: "MIZULS", instrument: "Songwriter & Composer" },
      { id: "c2", credit_role: "custom", role_key: "custom", display_name: "Acoustic Artz", instrument: "Recording" },
      { id: "m1", credit_role: "musician", role_key: "musician", display_name: "Anupom", instrument: "Vocals & Guitars" },
      { id: "m2", credit_role: "musician", role_key: "musician", display_name: "Autul", instrument: "Drums (Guest)" },
      { id: "m3", credit_role: "musician", role_key: "musician", display_name: "Tuli", instrument: "Bass", part_of_name: "Acoustic Artz" },
    ];
    const out = creditDetails(song, [], label, [{ id: "b9", name: "MIZULS" }], "b9");
    expect(out.main.map((m) => `${m.role}: ${m.name} [${m.members.map((p) => `${p.plays} ${p.name}`).join(", ")}]`)).toEqual([
      "Songwriter & Composer: MIZULS [Vocals & Guitars Anupom, Drums (Guest) Autul]",
      "Recording: Acoustic Artz [Bass Tuli]",
    ]);
    // Without the song's artist credited, they keep their own lines.
    expect(creditDetails(song, [], label, [], "b9").main).toHaveLength(4);
  });

  it("is empty without credits", () => {
    expect(creditDetails([], artists, label)).toEqual({ main: [] });
  });

  it("links names that have a Corner Room page, by their stage name (owner, 2026-10-31)", () => {
    const out = creditDetails(credits, artists, label, [{ id: "b1", name: "Tuli" }]);
    expect(out.main.map((m) => m.href)).toEqual(["/artists/a1", null, null, "/bands/b1", "/artists/a1", null, null]);
    const typed = creditDetails([{ id: "x", credit_role: "producer", display_name: "  mizuls " }], artists, label);
    expect(typed.main[0]).toMatchObject({ name: "MIZULS", href: "/artists/a1" });
  });
});

describe("creditLink", () => {
  const artists = [
    { id: "a1", stage_name: "MIZULS" },
    { id: "a2", stage_name: "Rafi  Ahmed" },
    { id: "a3", stage_name: "Twin" },
  ];
  const bands = [
    { id: "b1", name: "NASH MUSIC" },
    { id: "b2", name: "twin" },
  ];

  it("opens the linked artist's or band's page", () => {
    expect(creditLink({ artist_id: "a1", display_name: "anything" }, artists, bands)).toBe("/artists/a1");
    expect(creditLink({ artist_id: "b1" }, artists, bands)).toBe("/bands/b1");
  });

  it("opens the one profile with exactly a typed name, ignoring case and spacing", () => {
    expect(creditLink({ display_name: " rafi ahmed " }, artists, bands)).toBe("/artists/a2");
    expect(creditLink({ display_name: "Nash Music" }, artists, bands)).toBe("/bands/b1");
  });

  it("leaves names with no Corner Room page, or shared by two, as plain text", () => {
    expect(creditLink({ display_name: "Nadia" }, artists, bands)).toBeNull();
    expect(creditLink({ display_name: "Twin" }, artists, bands)).toBeNull();
    expect(creditLink({ display_name: "Rafi" }, artists, bands)).toBeNull();
    expect(creditLink({ artist_id: "hidden" }, artists, bands)).toBeNull();
    expect(creditLink({}, artists, bands)).toBeNull();
  });
});

describe("beside a release's cover (D-SINGLE-01)", () => {
  it("a single has no second Play or Sign in, and shows its song's credits", () => {
    expect(releaseHeroActions({ trackCount: 1, signedIn: true, ownsOne: true, onSale: false })).toEqual({ play: false, signIn: false, price: false, notOnSale: false, credits: true });
    expect(releaseHeroActions({ trackCount: 1, signedIn: false, ownsOne: false, onSale: true })).toMatchObject({ play: false, signIn: false, price: true, credits: true });
  });

  it("a single still offers to buy it", () => {
    expect(releaseHeroActions({ trackCount: 1, signedIn: true, ownsOne: false, onSale: true })).toMatchObject({ play: false, price: true, notOnSale: false });
  });

  it("albums and EPs keep Play from the top and the visitor's Sign in", () => {
    expect(releaseHeroActions({ trackCount: 5, signedIn: true, ownsOne: true, onSale: false })).toMatchObject({ play: true, credits: false });
    expect(releaseHeroActions({ trackCount: 5, signedIn: false, ownsOne: false, onSale: false })).toMatchObject({ signIn: true, play: false });
  });

  it("says when there is nothing to play or buy yet", () => {
    expect(releaseHeroActions({ trackCount: 1, signedIn: true, ownsOne: false, onSale: false }).notOnSale).toBe(true);
  });
});
