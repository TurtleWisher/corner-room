import { describe, expect, it } from "vitest";

import type { TeaserLimits, TeaserSettings } from "@/features/teasers/api";

import {
  pickTarget,
  barsFor,
  fadeLevel,
  fitSettings,
  formatGain,
  formatTime,
  fullView,
  gainMultiplier,
  maxFadeMs,
  moveHandle,
  moveRegion,
  msToX,
  panView,
  parseTime,
  problemWords,
  record,
  redo,
  sameSettings,
  startHistory,
  undo,
  versionLine,
  xToMs,
  zoomView,
} from "./teaser-editor-view";

const limits: TeaserLimits = { min_ms: 5_000, max_ms: 60_000, fade_max_ms: 10_000, gain_min_cdb: -1200, gain_max_cdb: 600 };
const s = (start: number, end: number, fi = 0, fo = 0, gain = 0): TeaserSettings => ({
  start_ms: start,
  end_ms: end,
  fade_in_ms: fi,
  fade_out_ms: fo,
  gain_cdb: gain,
});
const SONG = 180_000;

describe("fitSettings", () => {
  it("keeps the teaser inside the song and the limits", () => {
    expect(fitSettings(s(0, 90_000), SONG, limits)).toEqual(s(0, 60_000));
    expect(fitSettings(s(178_000, 190_000), SONG, limits)).toEqual(s(175_000, 180_000));
    expect(fitSettings(s(10_000, 11_000), SONG, limits)).toEqual(s(10_000, 15_000));
    expect(fitSettings(s(0, 10_000, 9_000, 0, 9_999), SONG, limits)).toEqual(s(0, 10_000, 5_000, 0, 600));
    expect(fitSettings(s(-5, 30_000.6), SONG, limits)).toEqual(s(0, 30_001));
  });
  it("fits a song shorter than the limits", () => {
    expect(fitSettings(s(0, 9_000), 8_000, limits)).toEqual(s(0, 8_000));
  });
  it("limits fades to half the teaser", () => {
    expect(maxFadeMs(7_000, limits)).toBe(3_500);
    expect(maxFadeMs(60_000, limits)).toBe(10_000);
  });
});

describe("moving", () => {
  it("drags the start; it stops at the shortest length, the end follows past the longest", () => {
    expect(moveHandle(s(10_000, 40_000), "start", 20_000, SONG, limits)).toEqual(s(20_000, 40_000));
    expect(moveHandle(s(10_000, 40_000), "start", 38_000, SONG, limits)).toEqual(s(35_000, 40_000));
    expect(moveHandle(s(30_000, 90_000), "start", 0, SONG, limits)).toEqual(s(0, 60_000));
  });
  it("drags the end; the start follows only past the longest length", () => {
    expect(moveHandle(s(10_000, 40_000), "end", 50_000, SONG, limits)).toEqual(s(10_000, 50_000));
    expect(moveHandle(s(10_000, 40_000), "end", 100_000, SONG, limits)).toEqual(s(40_000, 100_000));
    expect(moveHandle(s(10_000, 40_000), "end", 11_000, SONG, limits)).toEqual(s(10_000, 15_000));
  });
  it("slides the whole selection without changing its length", () => {
    expect(moveRegion(s(10_000, 40_000), 5_000, SONG, limits)).toEqual(s(15_000, 45_000));
    expect(moveRegion(s(10_000, 40_000), -50_000, SONG, limits)).toEqual(s(0, 30_000));
    expect(moveRegion(s(150_000, 170_000), 50_000, SONG, limits)).toEqual(s(160_000, 180_000));
  });
});

describe("view", () => {
  it("zooms around a point and never past the song", () => {
    const full = fullView(SONG);
    const close = zoomView(full, 0.5, 90_000, SONG);
    expect(close).toEqual({ fromMs: 45_000, toMs: 135_000 });
    expect(zoomView(close, 4, 0, SONG)).toEqual(full);
    expect(zoomView(full, 0.0001, 0, SONG).toMs).toBe(2_000);
  });
  it("pans inside the song", () => {
    expect(panView({ fromMs: 0, toMs: 30_000 }, 0.5, SONG)).toEqual({ fromMs: 15_000, toMs: 45_000 });
    expect(panView({ fromMs: 160_000, toMs: 180_000 }, 1, SONG)).toEqual({ fromMs: 160_000, toMs: 180_000 });
  });
  it("turns time into pixels and back", () => {
    const view = { fromMs: 10_000, toMs: 20_000 };
    expect(msToX(15_000, view, 1000)).toBe(500);
    expect(xToMs(250, view, 1000)).toBe(12_500);
  });
  it("draws one bar per column from the loudest bucket", () => {
    const points = [0, 10, 200, 30, 40, 50, 60, 70];
    expect(barsFor(points, 100, { fromMs: 0, toMs: 800 }, 4)).toEqual([10, 200, 50, 70]);
    expect(barsFor([], 100, { fromMs: 0, toMs: 800 }, 4)).toEqual([]);
  });
});

describe("times and levels", () => {
  it("formats and reads times", () => {
    expect(formatTime(65_250)).toBe("1:05.250");
    expect(parseTime("1:05.25")).toBe(65_250);
    expect(parseTime("65.25")).toBe(65_250);
    expect(parseTime("1:05")).toBe(65_000);
    expect(parseTime("12,5")).toBe(12_500);
    expect(parseTime("1:75")).toBeNull();
    expect(parseTime("abc")).toBeNull();
  });
  it("formats gain", () => {
    expect(formatGain(0)).toBe("0 dB");
    expect(formatGain(-350)).toBe("−3.5 dB");
    expect(formatGain(100)).toBe("+1.0 dB");
    expect(gainMultiplier(0)).toBe(1);
    expect(gainMultiplier(-600)).toBeCloseTo(0.501, 3);
  });
  it("fades linearly, like the finished teaser", () => {
    const f = s(10_000, 20_000, 2_000, 4_000);
    expect(fadeLevel(10_000, f)).toBe(0);
    expect(fadeLevel(11_000, f)).toBe(0.5);
    expect(fadeLevel(15_000, f)).toBe(1);
    expect(fadeLevel(18_000, f)).toBe(0.5);
    expect(fadeLevel(20_000, f)).toBe(0);
    expect(fadeLevel(15_000, s(10_000, 20_000))).toBe(1);
  });
});

describe("history", () => {
  it("undoes and redoes, ignoring repeats", () => {
    let h = startHistory(s(0, 10_000));
    h = record(h, s(0, 10_000));
    expect(h.past).toHaveLength(0);
    h = record(h, s(1_000, 10_000));
    h = record(h, s(2_000, 10_000));
    h = undo(h);
    expect(h.present).toEqual(s(1_000, 10_000));
    h = redo(h);
    expect(h.present).toEqual(s(2_000, 10_000));
    h = undo(undo(undo(h)));
    expect(h.present).toEqual(s(0, 10_000));
    h = record(h, s(5_000, 10_000));
    expect(h.future).toHaveLength(0);
    expect(sameSettings(h.present, s(5_000, 10_000))).toBe(true);
  });
});

describe("words", () => {
  it("names a version's state", () => {
    expect(versionLine({ number: 2, status: "READY", review_status: null, is_live: false })).toBe("Version 2 · made");
    expect(versionLine({ number: 1, status: "READY", review_status: "APPROVED", is_live: true })).toBe("Version 1 · live now");
    expect(versionLine({ number: 3, status: "READY", review_status: "RETURNED", is_live: false })).toBe("Version 3 · sent back");
  });
  it("turns problem codes into sentences", () => {
    expect(problemWords("TOO_LONG,FADE_TOO_LONG")).toEqual(["The teaser is too long.", "A fade is longer than allowed."]);
    expect(problemWords("UNKNOWN")).toEqual([]);
    expect(problemWords(null)).toEqual([]);
  });
});

describe("pickTarget", () => {
  const lines = { start: 100, end: 300, playhead: 200 };
  it("grabs the nearest line within reach", () => {
    expect(pickTarget(110, lines, 24)).toBe("start");
    expect(pickTarget(290, lines, 24)).toBe("end");
    expect(pickTarget(205, lines, 24)).toBe("playhead");
  });
  it("slides the chosen part or sets a new play point elsewhere", () => {
    expect(pickTarget(150, lines, 24)).toBe("region");
    expect(pickTarget(40, lines, 24)).toBe("scrub");
    expect(pickTarget(400, lines, 24)).toBe("scrub");
  });
  it("needs a mouse to be closer than a finger", () => {
    expect(pickTarget(120, lines, 24)).toBe("start");
    expect(pickTarget(120, lines, 10)).toBe("region");
  });
  it("lets an edge win a tie with the play line", () => {
    expect(pickTarget(100, { start: 100, end: 300, playhead: 100 }, 24)).toBe("start");
  });
  it("picks by side when both edges are under the finger", () => {
    const close = { start: 100, end: 110, playhead: null };
    expect(pickTarget(98, close, 24)).toBe("start");
    expect(pickTarget(112, close, 24)).toBe("end");
  });
  it("works with edges outside the view when zoomed in", () => {
    expect(pickTarget(110, { start: -400, end: 300, playhead: null }, 24)).toBe("region");
    expect(pickTarget(110, { start: -400, end: 900, playhead: null }, 24)).toBe("region");
    expect(pickTarget(110, { start: 500, end: 900, playhead: null }, 24)).toBe("scrub");
  });
});
