import { describe, expect, it } from "vitest";

import { addedSong, missingByPart, openByDefault, partForHash, RELEASE_PARTS, songLine } from "./release-tabs-view";

const audio = (over: Partial<{ status: string; is_current: boolean; has_audio: boolean }>) => ({
  version_id: "v",
  status: "READY",
  is_current: true,
  has_audio: true,
  ...over,
});

describe("release parts", () => {
  it("lists the five parts with Preview Studio third", () => {
    expect(RELEASE_PARTS.map((p) => p.label)).toEqual(["Details", "Songs", "Preview Studio", "Price", "Pre-sale", "Review"]);
  });

  it("opens a part from its hash and from the old section links", () => {
    expect(partForHash("#preview")).toBe("preview");
    expect(partForHash("#tracks")).toBe("songs");
    expect(partForHash("#presale")).toBe("presale");
    expect(partForHash("#cover")).toBe("details");
    expect(partForHash("submit")).toBe("review");
    expect(partForHash("#presale-review")).toBeNull();
    expect(partForHash("")).toBeNull();
    expect(partForHash(null)).toBeNull();
  });

  it("counts what is missing per part from the server's readiness list", () => {
    expect(
      missingByPart([
        { code: "COVER", ok: false },
        { code: "GENRE", ok: false },
        { code: "TITLE", ok: true },
        { code: "TRACK_AUDIO", ok: false, track_id: "t1" },
        { code: "PRICE", ok: false },
        { code: "SOMETHING_NEW", ok: false },
      ]),
    ).toEqual({ details: 2, songs: 1, price: 1 });
    expect(missingByPart([])).toEqual({});
  });
});

describe("songLine", () => {
  const base = { credits: [], lyrics: null, lyrics_waiting: false };
  it("says where the audio is", () => {
    expect(songLine({ ...base, audio: [] }).audio).toBe("No audio yet");
    expect(songLine({ ...base, audio: [audio({})] })).toMatchObject({ audio: "Audio ready", tone: "good" });
    expect(songLine({ ...base, audio: [audio({ status: "REJECTED" })] }).tone).toBe("attention");
    expect(songLine({ ...base, audio: [audio({}), audio({ status: "PROCESSING", is_current: false })] }).audio).toBe("Audio being checked");
    // A new version waiting for its upload doesn't hide the current audio.
    expect(songLine({ ...base, audio: [audio({}), audio({ status: "UPLOADING", is_current: false, has_audio: false })] }).audio).toBe("Audio ready");
  });

  it("counts credits and names lyrics", () => {
    const credit = { role_key: "PERFORMER" } as never;
    expect(songLine({ ...base, audio: [], credits: [credit] }).credits).toBe("1 credit");
    expect(songLine({ ...base, audio: [], credits: [credit, credit] }).credits).toBe("2 credits");
    expect(songLine({ ...base, audio: [], lyrics: "line" }).lyrics).toBe("Lyrics");
    expect(songLine({ ...base, audio: [], lyrics: "  " }).lyrics).toBe("No lyrics");
    expect(songLine({ ...base, audio: [], lyrics_waiting: true }).lyrics).toBe("Lyrics waiting");
  });
});

describe("open songs", () => {
  it("opens a single song and folds longer releases", () => {
    expect(openByDefault(["a"])).toEqual(["a"]);
    expect(openByDefault(["a", "b"])).toEqual([]);
  });

  it("finds the song just added", () => {
    expect(addedSong(["a"], ["a", "b"])).toBe("b");
    expect(addedSong(["a"], ["a"])).toBeNull();
  });
});
