import { describe, expect, it } from "vitest";

import {
  floatingLines,
  lyricAgeAt,
  lyricClock,
  lyricIndexAt,
  lyricLines,
  lyricLrc,
  lyricStamp,
  lyricTimes,
  lyricStepSeconds,
  lyricVerses,
  lyricsMode,
  RING_GAP,
  ringPath,
  ringPose,
  shiftLines,
  tapLine,
  type RingSize,
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

describe("lyricAgeAt", () => {
  it("counts in lines from the moment a line starts", () => {
    // 4 lines over a 100 s song: the first starts at 6 s, one every 22 s.
    expect(lyricAgeAt(0, 4, 6, 100)).toBeCloseTo(0);
    expect(lyricAgeAt(1, 4, 6, 100)).toBeCloseTo(-1);
    expect(lyricAgeAt(0, 4, 39, 100)).toBeCloseTo(1.5);
    expect(lyricAgeAt(0, 4, 10, 0)).toBeNaN();
  });
});

describe("ringPose", () => {
  const wide: RingSize = { cover: 336, coverHeight: 400, lineWidth: 340, lineHeight: 70 };
  const phone: RingSize = { cover: 240, coverHeight: 300, lineWidth: 320, lineHeight: 60 };
  const ages = Array.from({ length: 301 }, (_, i) => -1 + i / 100);

  it("never meets the cover's plane while it overlaps the cover, so it never pops through it", () => {
    for (let n = 0; n < 12; n++) {
      for (const age of ages) {
        const a = ringPose(n, age, "around", wide);
        if (Math.abs(a.x) < wide.cover / 2 + wide.lineWidth / 2) expect(Math.abs(a.z)).toBeGreaterThan(40);
        const o = ringPose(n, age, "over", phone);
        if (Math.abs(o.y) < phone.coverHeight / 2 + phone.lineHeight / 2) expect(Math.abs(o.z)).toBeGreaterThan(30);
      }
    }
  });

  it("passes the cover's side with room to spare", () => {
    // At the side of the ring (z = 0) the line's near end clears the cover's edge by the gap.
    const side = ringPose(0, -0.4, "around", wide);
    const reach = wide.cover / 2 + wide.lineWidth / 2 + RING_GAP;
    expect(Math.abs(side.x)).toBeLessThanOrEqual(reach + 0.01);
    expect(reach - wide.lineWidth / 2 - wide.cover / 2).toBe(RING_GAP);
  });

  it("comes out from behind, is sung in front and readable, then leaves and fades", () => {
    for (let n = 0; n < 12; n++) {
      for (const axis of ["around", "over"] as const) {
        const size = axis === "around" ? wide : phone;
        expect(ringPose(n, -1, axis, size).plane).toBe("back");
        expect(ringPose(n, -1, axis, size).opacity).toBe(0);
        for (const age of [0, 0.5, 1]) {
          const p = ringPose(n, age, axis, size);
          expect(p.plane).toBe("front");
          expect(p.opacity).toBeGreaterThanOrEqual(0.95);
        }
        const gone = ringPose(n, 2, axis, size);
        expect(gone.opacity).toBe(0);
        expect(gone.plane).toBe(ringPath(n).exit === "behind" ? "back" : "front");
      }
    }
  });

  it("moves smoothly: no jump between nearby moments", () => {
    for (let n = 0; n < 6; n++) {
      for (let i = 1; i < ages.length; i++) {
        const a = ringPose(n, ages[i - 1], "around", wide);
        const b = ringPose(n, ages[i], "around", wide);
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(25);
      }
    }
  });

  it("keeps three lines in a row on the same side, so a leaving line never meets the next", () => {
    expect([0, 1, 2].map((n) => ringPath(n).dir)).toEqual([1, 1, 1]);
    expect([3, 4, 5].map((n) => ringPath(n).dir)).toEqual([-1, -1, -1]);
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

describe("timed lines (D-LYRICS-03)", () => {
  const times = [10, 14, 20];

  it("takes the API's milliseconds only when they fit the lines", () => {
    expect(lyricTimes(3, [10000, 14000, 20000])).toEqual(times);
    expect(lyricTimes(2, [10000, 14000, 20000])).toBeNull();
    expect(lyricTimes(3, [10000, 9000, 20000])).toBeNull();
    expect(lyricTimes(3, null)).toBeNull();
  });

  it("counts lines smoothly between their start times", () => {
    expect(lyricClock(times, 10)).toBe(0);
    expect(lyricClock(times, 12)).toBe(0.5);
    expect(lyricClock(times, 17)).toBe(1.5);
    // The last line gets the average line length (5 s).
    expect(lyricClock(times, 22.5)).toBe(2.5);
    // Before the first line: arriving, over the first line's own length.
    expect(lyricClock(times, 8)).toBe(-0.5);
  });

  it("shows each line from its own start, not paced across the song", () => {
    expect(lyricIndexAt(3, 9, 200, times)).toBe(-1);
    expect(lyricIndexAt(3, 10, 200, times)).toBe(0);
    expect(lyricIndexAt(3, 19.9, 200, times)).toBe(1);
    expect(lyricIndexAt(3, 150, 200, times)).toBe(2);
    expect(lyricAgeAt(1, 3, 17, 200, times)).toBe(0.5);
    // Without timings the old pacing is unchanged.
    expect(lyricIndexAt(3, 9, 200)).toBe(lyricIndexAt(3, 9, 200, null));
  });

  it("records taps and writes them as a lyric file", () => {
    let taps = tapLine([], 1234.4);
    taps = tapLine(taps, 900);
    expect(taps).toEqual([1234, 1234]);
    expect(shiftLines([100, 5000], -150)).toEqual([0, 4850]);
    expect(lyricStamp(65400)).toBe("1:05.40");
    expect(lyricLrc(["One", "Two", "Three"], [5000, 65400])).toBe("[00:05.00]One\n[01:05.40]Two");
  });
});
