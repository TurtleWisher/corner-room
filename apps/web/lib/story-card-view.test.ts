import { describe, expect, it } from "vitest";

import {
  clipWindow,
  clockLabel,
  defaultStartMs,
  fadeGain,
  levelsPerFrame,
  shareRoute,
  storyFileName,
  storyFrame,
  storyReasonText,
  type StoryInput,
} from "./story-card-view";

describe("clipWindow", () => {
  it("keeps the moment inside the song and no longer than allowed", () => {
    expect(clipWindow(10_000, 200_000, 30_000)).toEqual({ startMs: 10_000, endMs: 40_000 });
    expect(clipWindow(190_000, 200_000, 30_000)).toEqual({ startMs: 170_000, endMs: 200_000 });
    expect(clipWindow(-5, 200_000, 30_000)).toEqual({ startMs: 0, endMs: 30_000 });
    expect(clipWindow(Number.NaN, 200_000, 30_000)).toEqual({ startMs: 0, endMs: 30_000 });
  });
  it("uses the whole song when it is shorter than the limit", () => {
    expect(clipWindow(5_000, 20_000, 30_000)).toEqual({ startMs: 0, endMs: 20_000 });
  });
  it("gives nothing when stories are off", () => {
    expect(clipWindow(5_000, 20_000, 0)).toEqual({ startMs: 0, endMs: 0 });
  });
});

describe("defaultStartMs", () => {
  it("starts a beat before the first sung line", () => {
    expect(defaultStartMs(200_000, 30_000, [12_000, 15_000])).toBe(11_400);
    expect(defaultStartMs(200_000, 30_000, null)).toBe(0);
    expect(defaultStartMs(200_000, 30_000, [190_000])).toBe(170_000);
  });
});

describe("words and files", () => {
  it("formats the picker clock", () => {
    expect(clockLabel(65_400)).toBe("1:05");
    expect(clockLabel(-1)).toBe("0:00");
  });
  it("names the file after the song, Bangla kept", () => {
    expect(storyFileName("ছায়া পড়ে")).toBe("ছায়া পড়ে - Corner Room story.mp4");
    expect(storyFileName('a/b:c*"?')).toBe("a b c - Corner Room story.mp4");
    expect(storyFileName("  ")).toBe("Song - Corner Room story.mp4");
  });
  it("explains every reason in words", () => {
    expect(storyReasonText("OK")).toBe("");
    expect(storyReasonText("SHARING_OFF")).toMatch(/turned story sharing off/);
    expect(storyReasonText("NOT_OWNED")).toMatch(/own this song/);
    expect(storyReasonText("SOMETHING_NEW")).toMatch(/can't be shared/);
  });
});

describe("shareRoute", () => {
  const file = { name: "x.mp4" } as File;
  it("uses the share sheet only when it takes video files", () => {
    expect(shareRoute({ canShare: () => true }, file)).toBe("share");
    expect(shareRoute({ canShare: () => false }, file)).toBe("download");
    expect(shareRoute({}, file)).toBe("download");
    expect(shareRoute(undefined, file)).toBe("download");
    expect(shareRoute({ canShare: () => true }, null)).toBe("download");
    expect(
      shareRoute(
        {
          canShare: () => {
            throw new Error("no");
          },
        },
        file,
      ),
    ).toBe("download");
  });
});

describe("levelsPerFrame", () => {
  it("is quiet in silence and reaches 1 at the loudest moment", () => {
    const rate = 300;
    const samples = new Float32Array(rate * 2);
    for (let i = rate; i < rate * 2; i++) samples[i] = i % 2 ? 0.5 : -0.5;
    const levels = levelsPerFrame(samples, rate, 30);
    expect(levels.length).toBe(60);
    expect(levels[5]).toBe(0);
    expect(Math.max(...levels)).toBeGreaterThan(0.95);
    expect(Math.max(...levels)).toBeLessThanOrEqual(1);
  });
});

describe("fadeGain", () => {
  it("fades in and out softly", () => {
    expect(fadeGain(0, 30)).toBe(0);
    expect(fadeGain(10, 30)).toBe(1);
    expect(fadeGain(30, 30)).toBe(0);
    expect(fadeGain(29.6, 30)).toBeCloseTo(0.5, 5);
    expect(fadeGain(-1, 30)).toBe(0);
  });
});

describe("storyFrame", () => {
  const base: StoryInput = {
    title: "Song",
    artist: "Act",
    lyrics: "one\ntwo\n\nthree\nfour",
    lyricsTimingsMs: [10_000, 14_000, 18_000, 22_000],
    songMs: 120_000,
    startMs: 9_000,
    endMs: 39_000,
  };

  it("is the same frame for the same time (preview and video match)", () => {
    expect(storyFrame(base, 7.3)).toEqual(storyFrame(base, 7.3));
  });

  it("arrives, then floats", () => {
    expect(storyFrame(base, 0).arrive).toBe(0);
    expect(storyFrame(base, 2).arrive).toBe(1);
    expect(storyFrame(base, 15).progress).toBeCloseTo(0.5, 5);
  });

  it("shows the first line waiting before the singing starts", () => {
    const f = storyFrame(base, 0.5);
    expect(f.lines.map((l) => l.text)).toEqual(["one", "two"]);
    expect(f.lines[0].age).toBe(0);
    expect(f.sung).toBeNull();
  });

  it("follows the tapped times: the line now, the one before and the next", () => {
    // 15.5 s into the song: "two" started at 14 s, settled after its glide.
    const f = storyFrame(base, 6.5);
    expect(f.lines.map((l) => [l.text, l.age])).toEqual([
      ["one", -1],
      ["two", 0],
      ["three", 1],
    ]);
    expect(f.sung).toBeCloseTo(0.375, 3);
  });

  it("glides the stack up as a new line starts", () => {
    const f = storyFrame(base, 5.05); // 14.05 s, just after "two" starts
    const two = f.lines.find((l) => l.text === "two");
    expect(two && two.age).toBeGreaterThan(0.5);
  });

  it("has no lines without lyrics", () => {
    const f = storyFrame({ ...base, lyrics: null, lyricsTimingsMs: null }, 4);
    expect(f.lines).toEqual([]);
    expect(f.sung).toBeNull();
  });

  it("reads the glow from the clip's own loudness", () => {
    const levels = new Float32Array(900).fill(0.2);
    levels[60] = 0.9;
    expect(storyFrame({ ...base, levels }, 2).glow).toBeCloseTo(0.9, 5);
    expect(storyFrame({ ...base, levels }, 3).glow).toBeCloseTo(0.2, 5);
  });
});
