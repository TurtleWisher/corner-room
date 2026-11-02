import { describe, expect, it } from "vitest";

import { OCCASIONS, occasionStarter, shapeOf, thankYouStarter } from "./artist-mail-starters";
import { plainText, unfilledMarks, unknownFillIns, valuesFor } from "./artist-mail-view";

const values = valuesFor("Alam", ["Chaya Pore"], "MIZULS");

describe("shapeOf", () => {
  it("names what was chosen; a single reads like a song", () => {
    expect(shapeOf([])).toEqual({ kind: "any" });
    expect(shapeOf([{ type: "TRACK", id: "t" }])).toEqual({ kind: "song" });
    expect(shapeOf([{ type: "RELEASE", id: "r" }], { r: "SINGLE" })).toEqual({ kind: "song" });
    expect(shapeOf([{ type: "RELEASE", id: "r" }], { r: "EP" })).toEqual({ kind: "release", releaseType: "EP" });
    expect(shapeOf([{ type: "TRACK", id: "a" }, { type: "TRACK", id: "b" }])).toEqual({ kind: "several", count: 2 });
  });
});

describe("thank-you starters", () => {
  it("reads like the owner's example for one song", () => {
    const s = thankYouStarter("ALL", { kind: "song" }, "we");
    expect(plainText(s.subject, values)).toBe("Thank you for buying Chaya Pore");
    const body = plainText(s.body, values);
    expect(body.startsWith("Hi Alam,\n\nThank you for buying Chaya Pore. It means a lot.")).toBe(true);
    expect(body.trimEnd().endsWith("MIZULS")).toBe(true);
  });

  it("changes with the audience, the music and the voice", () => {
    const presale = plainText(thankYouStarter("PRESALE", { kind: "song" }, "we").body, values);
    expect(presale).toContain("before anyone else could hear it");
    const album = plainText(thankYouStarter("ALL", { kind: "release", releaseType: "ALBUM" }, "we").body, values);
    expect(album).toContain("An album asks for more");
    const ep = plainText(thankYouStarter("ALL", { kind: "release", releaseType: "EP" }, "we").body, values);
    expect(ep).toContain("An EP is a small world");
    expect(thankYouStarter("ALL", { kind: "several", count: 2 }, "we").subject).toBe("Thank you for picking up {music}");
    const solo = thankYouStarter("ALL", { kind: "song" }, "I").body;
    expect(solo).toContain("wouldn't leave me alone");
    expect(solo).not.toMatch(/\bwe\b|\bus\b/);
  });

  it("uses only real fill-ins and needs nothing completed", () => {
    for (const who of ["ALL", "PRESALE"] as const) {
      for (const shape of [{ kind: "any" }, { kind: "song" }, { kind: "release", releaseType: "ALBUM" }, { kind: "several", count: 3 }] as const) {
        const s = thankYouStarter(who, shape, "we");
        expect(unknownFillIns(s.subject + s.body)).toEqual([]);
        expect(unfilledMarks(s.body)).toEqual([]);
      }
    }
  });
});

describe("occasion starters", () => {
  it("has words for every occasion, with only real fill-ins", () => {
    for (const occasion of OCCASIONS) {
      const s = occasionStarter(occasion, "ALL", { kind: "song" }, "we");
      expect(s.subject.length).toBeGreaterThan(5);
      expect(unknownFillIns(s.subject + s.body)).toEqual([]);
      expect(s.body).toContain("{artist}");
    }
  });

  it("asks for what only the artist knows instead of making it up", () => {
    expect(unfilledMarks(occasionStarter("SHOW", "ALL", { kind: "song" }, "we").body)).toEqual(["[add the date, the venue and where to get tickets]"]);
    expect(plainText(occasionStarter("NEW_RELEASE", "PRESALE", { kind: "song" }, "I").body, values)).toContain("in the pre-sale");
  });
});
