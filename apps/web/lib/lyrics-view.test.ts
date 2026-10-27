import { describe, expect, it } from "vitest";

import { floatSlot, floatingLines, lyricIndexAt, lyricLines, lyricVerses, lyricsMode } from "./lyrics-view";

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
  const lines = ["a", "b", "c"];
  it("shows the leaving, current and arriving lines", () => {
    expect(floatingLines(lines, 1)).toEqual([
      { key: 0, text: "a", age: -1 },
      { key: 1, text: "b", age: 0 },
      { key: 2, text: "c", age: 1 },
    ]);
  });
  it("before the first line only the first one arrives", () => {
    expect(floatingLines(lines, -1)).toEqual([{ key: 0, text: "a", age: 1 }]);
    expect(floatingLines(lines, 2).map((l) => l.age)).toEqual([-1, 0]);
  });
});

describe("floatSlot", () => {
  it("is fixed per line and puts neighbours apart", () => {
    expect(floatSlot(3)).toEqual(floatSlot(3));
    const a = floatSlot(0);
    const b = floatSlot(1);
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThan(20);
    for (let i = 0; i < 20; i++) {
      const s = floatSlot(i);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(80);
      expect(s.seconds).toBeGreaterThanOrEqual(16);
      expect(s.dy).toBeLessThan(0);
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
