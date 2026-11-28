import { describe, expect, it } from "vitest";

import {
  BAYER8,
  advance,
  backdropLight,
  barHeights,
  bayerAt,
  biggestMonth,
  dhakaInputToIso,
  fillIn,
  headlineFor,
  hourLabel,
  isoToDhakaInput,
  monthLabel,
  moveCard,
  progressBars,
  shareTitle,
  stepTo,
  tapStep,
  toneAt,
  transitionWords,
  worldFor,
} from "@/lib/wrap-view";

const ctx = {
  firstName: "Mitu",
  name: "Mitu Rahman",
  year: 2026,
  stats: { minutes: 12345, top_songs: [{ track_id: "t", title: "Chaya Pore", act_id: null, act: null, listens: 9, minutes: 30 }], top_acts: [{ act_id: "a", name: "MIZULS", kind: "BAND" as const, picture: null, listens: 9, songs: 2 }] },
};

describe("wrap worlds", () => {
  it("never mixes worlds on one card", () => {
    expect([0, 1, 2].map((i) => worldFor("MARQUEE", i))).toEqual(["ember", "ember", "ember"]);
    expect([0, 1, 2].map((i) => worldFor("CAROUSEL", i))).toEqual(["sky", "sky", "sky"]);
    expect([0, 1, 2].map((i) => worldFor("FAIRGROUND", i))).toEqual(["ember", "sky", "ember"]);
  });
});

describe("fill-ins", () => {
  it("uses the person's own words", () => {
    expect(fillIn("{first_name}, {minutes} minutes of {top_song} by {top_act} in {year}", ctx)).toBe("Mitu, 12,345 minutes of Chaya Pore by MIZULS in 2026");
  });
  it("never shows a blank or a brace without a name", () => {
    const none = { ...ctx, firstName: null, name: null };
    expect(fillIn("{first_name}'s {year} Wrap", none)).toBe("Your 2026 Wrap");
    expect(fillIn("{unknown}", none)).toBe("{unknown}");
  });
  it("takes staff's headline over the default", () => {
    expect(headlineFor("INTRO", "Hello {first_name}", ctx)).toBe("Hello Mitu");
    expect(headlineFor("INTRO", "  ", ctx)).toBe("Mitu, step right up");
  });
});

describe("words", () => {
  it("says hours and months as people do", () => {
    expect([0, 9, 12, 23].map(hourLabel)).toEqual(["12 AM", "9 AM", "12 PM", "11 PM"]);
    expect(monthLabel("2026-03")).toBe("Mar");
  });
  it("finds the biggest month and scales bars", () => {
    expect(biggestMonth([{ month: "2026-01", listens: 2 }, { month: "2026-02", listens: 5 }])).toEqual({ month: "2026-02", listens: 5 });
    expect(biggestMonth([{ month: "2026-01", listens: 0 }])).toBeNull();
    expect(barHeights([0, 5, 10])).toEqual([0, 0.5, 1]);
    expect(barHeights([0, 0])).toEqual([0, 0]);
  });
  it("names the share picture only when allowed", () => {
    expect(shareTitle("Mitu", 2026, true)).toBe("Mitu's 2026 Corner Room Wrap");
    expect(shareTitle("Mitu", 2026, false)).toBe("My 2026 Corner Room Wrap");
  });
});

describe("story timing", () => {
  it("moves card by card and holds on the last", () => {
    expect(advance({ index: 0, elapsedMs: 0 }, 2500, 1000, 3)).toEqual({ index: 2, elapsedMs: 500 });
    expect(advance({ index: 2, elapsedMs: 900 }, 5000, 1000, 3)).toEqual({ index: 2, elapsedMs: 1000 });
    expect(progressBars({ index: 1, elapsedMs: 250 }, 1000, 3)).toEqual([1, 0.25, 0]);
  });
  it("goes back on the left third", () => {
    expect(tapStep(10, 300)).toBe(-1);
    expect(tapStep(200, 300)).toBe(1);
    expect(stepTo(0, -1, 4)).toBe(0);
    expect(stepTo(3, 1, 4)).toBe(3);
  });
});

describe("dither", () => {
  it("uses every Bayer threshold once", () => {
    expect(new Set(BAYER8).size).toBe(64);
    expect(bayerAt(0, 0)).toBeCloseTo(0.5 / 64);
    expect(bayerAt(8, 8)).toBe(bayerAt(0, 0));
  });
  it("dithers light into four tones", () => {
    expect(toneAt(0, 0.5)).toBe(0);
    expect(toneAt(1, 0.5)).toBe(3);
    expect(toneAt(0.5, 0.1)).toBe(2);
    expect(toneAt(0.5, 0.9)).toBe(1);
  });
  it("keeps the backdrop light in range", () => {
    for (const [u, v] of [[0, 0], [0.5, 0.5], [1, 1]]) {
      const l = backdropLight(u, v, 3);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(1);
    }
  });
});

describe("staff", () => {
  it("moves cards one step at a time", () => {
    const cards = [{ key: "INTRO", on: true, title: null }, { key: "SUMMARY", on: true, title: null }] as const;
    expect(moveCard([...cards], 0, 1).map((c) => c.key)).toEqual(["SUMMARY", "INTRO"]);
    expect(moveCard([...cards], 0, -1).map((c) => c.key)).toEqual(["INTRO", "SUMMARY"]);
  });
  it("words each move", () => {
    expect(transitionWords("DRAFT", "LIVE").label).toBe("Go live");
    expect(transitionWords("ENDED", "LIVE").label).toBe("Open again");
    expect(transitionWords("LIVE", "ENDED").label).toBe("End it");
  });
  it("reads and writes Dhaka times", () => {
    expect(dhakaInputToIso("2026-12-01T18:00")).toBe("2026-12-01T12:00:00.000Z");
    expect(isoToDhakaInput("2026-12-01T12:00:00.000Z")).toBe("2026-12-01T18:00");
    expect(dhakaInputToIso("")).toBeNull();
  });
});

import { countUp, firstNameOf, segmentAt, videoTimeline } from "@/lib/wrap-view";

describe("names", () => {
  it("skips a first word with digits", () => {
    expect(firstNameOf("Samiul Islam")).toBe("Samiul");
    expect(firstNameOf("Mizuls1 Samiul")).toBe("Samiul");
    expect(firstNameOf("R2D2")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});

describe("story video", () => {
  it("times every card and stays inside a story's length", () => {
    const few = videoTimeline(["INTRO", "MINUTES", "SUMMARY"]);
    few.segments.forEach((s, i) => expect(s.end - s.start).toBeCloseTo([3.4, 3, 5][i]));
    expect(few.total).toBeCloseTo(11.4);
    const many = videoTimeline(["INTRO", ...Array(14).fill("MINUTES"), "SUMMARY"]);
    expect(many.total).toBeLessThanOrEqual(45 + 1e-9);
    expect(many.segments[1].end - many.segments[1].start).toBeGreaterThanOrEqual(2.2);
  });
  it("finds the card on screen and holds on the last", () => {
    const { segments } = videoTimeline(["INTRO", "MINUTES", "SUMMARY"]);
    expect(segmentAt(segments, 0)).toEqual({ index: 0, local: 0 });
    expect(segmentAt(segments, 4).index).toBe(1);
    expect(segmentAt(segments, 99).index).toBe(2);
  });
  it("counts up to the exact number", () => {
    expect(countUp(2436, 0)).toBe(0);
    expect(countUp(2436, 5)).toBe(2436);
  });
});
