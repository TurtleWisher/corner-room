import { describe, expect, it } from "vitest";

import {
  floatingLines,
  lyricIndexAt,
  lyricLines,
  lyricStepSeconds,
  lyricSway,
  lyricVerses,
  lyricsMode,
  orbitPath,
  orbitPose,
  type LyricAge,
} from "./lyrics-view";

const SONG = "Chaya pore\n  mone pore  \n\n\nSecond verse\nlast line\n";

describe("lyric lines and verses", () => {
  it("keeps sung lines and drops empty ones", () => {
    expect(lyricLines(SONG)).toEqual(["Chaya pore", "mone pore", "Second verse", "last line"]);
    expect(lyricLines(null)).toEqual([]);
  });

  it("groups verses between empty lines", () => {
    expect(lyricVerses(SONG)).toEqual([
      ["Chaya pore", "mone pore"],
      ["Second verse", "last line"],
    ]);
    expect(lyricVerses("   ")).toEqual([]);
  });
});

describe("lyricIndexAt", () => {
  it("waits through the intro, then spreads lines over the song", () => {
    expect(lyricIndexAt(4, 0, 100)).toBe(-1);
    expect(lyricIndexAt(4, 5.9, 100)).toBe(-1);
    expect(lyricIndexAt(4, 6, 100)).toBe(0);
    expect(lyricIndexAt(4, 50, 100)).toBe(2);
    expect(lyricIndexAt(4, 100, 100)).toBe(3);
  });

  it("shows nothing without lines or a known length", () => {
    expect(lyricIndexAt(0, 30, 100)).toBe(-1);
    expect(lyricIndexAt(4, 30, 0)).toBe(-1);
    expect(lyricIndexAt(4, Number.NaN, 100)).toBe(-1);
  });
});

describe("floatingLines", () => {
  const lines = ["a", "b", "c", "d"];
  it("shows two leaving lines, the current one and the one arriving", () => {
    expect(floatingLines(lines, 2)).toEqual([
      { key: 0, text: "a", age: -2 },
      { key: 1, text: "b", age: -1 },
      { key: 2, text: "c", age: 0 },
      { key: 3, text: "d", age: 1 },
    ]);
  });
  it("before the first line only the first one arrives", () => {
    expect(floatingLines(lines, -1)).toEqual([{ key: 0, text: "a", age: 1 }]);
    expect(floatingLines(lines, 3).map((l) => l.age)).toEqual([-2, -1, 0]);
  });
});

describe("lyricStepSeconds", () => {
  it("shares the song between intro and outro across the lines", () => {
    expect(lyricStepSeconds(44, 500)).toBeCloseTo(10);
    expect(lyricStepSeconds(0, 500)).toBe(4);
    expect(lyricStepSeconds(10, 0)).toBe(4);
  });
});

describe("orbitPose", () => {
  const ages: LyricAge[] = [1, 0, -1, -2];
  it("is fixed per line and puts neighbours on different paths", () => {
    expect(orbitPose(5, 0, "beside")).toEqual(orbitPose(5, 0, "beside"));
    for (let i = 0; i < 30; i++) expect(orbitPath(i).path).not.toBe(orbitPath(i + 1).path);
  });

  it("arrives behind the cover, is sung in front of it, then leaves nearer or further away", () => {
    for (const layout of ["beside", "stack"] as const) {
      for (let i = 0; i < 24; i++) {
        const front = orbitPath(i).path.startsWith("front");
        expect(orbitPose(i, 1, layout).z).toBeLessThan(0);
        expect(orbitPose(i, 0, layout).z).toBeGreaterThan(0);
        for (const age of [-1, -2] as const) {
          const z = orbitPose(i, age, layout).z;
          expect(front ? z > 0 : z < 0).toBe(true);
        }
      }
    }
  });

  it("reads clearly while sung, then fades and comes apart before it leaves", () => {
    for (let i = 0; i < 12; i++) {
      const now = orbitPose(i, 0, "beside");
      expect(now.opacity).toBeGreaterThanOrEqual(0.9);
      expect(now.blur).toBe(0);
      expect(now.dissolve).toBe(0);
      const gone = orbitPose(i, -2, "beside");
      expect(gone.opacity).toBe(0);
      expect(gone.dissolve).toBe(1);
      for (const age of ages) expect(orbitPose(i, age, "beside").opacity).toBeLessThanOrEqual(now.opacity);
    }
  });

  it("stays over the cover while sung, clear of the title below", () => {
    for (let i = 0; i < 12; i++) expect(orbitPose(i, 0, "beside").y).toBeLessThanOrEqual(0.15);
  });

  it("swings less in a stack, and can send every line to one side", () => {
    for (let i = 0; i < 12; i++) {
      for (const age of ages) {
        expect(Math.abs(orbitPose(i, age, "stack").x)).toBeLessThanOrEqual(Math.abs(orbitPose(i, age, "beside").x));
        expect(orbitPose(i, age, "stack", -1).x).toBeLessThanOrEqual(0);
      }
    }
  });

  it("sways a little, always upwards", () => {
    for (let i = 0; i < 12; i++) {
      const s = lyricSway(i);
      expect(Math.abs(s.dx)).toBeLessThanOrEqual(8);
      expect(s.dy).toBeLessThan(0);
      expect(s.seconds).toBeGreaterThanOrEqual(7);
    }
  });
});

describe("lyricsMode", () => {
  it("drafts save, released songs go through review, songs in review wait", () => {
    expect(lyricsMode("DRAFT", true)).toBe("draft");
    expect(lyricsMode("DRAFT", false)).toBe("locked");
    expect(lyricsMode("IN_REVIEW", false)).toBe("locked");
    expect(lyricsMode("RELEASED", false)).toBe("review");
    expect(lyricsMode("APPROVED", false)).toBe("review");
    expect(lyricsMode("TAKEN_DOWN", false)).toBe("locked");
  });
});
