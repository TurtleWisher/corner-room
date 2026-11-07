import { describe, expect, it } from "vitest";

import { doubleClickFullscreen, lyricsChoice, lyricsOnFrom, lyricsSwitch, ROOM_CONTROLS } from "./room-controls-view";

describe("lyricsOnFrom", () => {
  it("is on for a first visit or blocked storage", () => {
    expect(lyricsOnFrom(null)).toBe(true);
    expect(lyricsOnFrom(undefined)).toBe(true);
  });
  it("respects a listener who turned lyrics off", () => {
    expect(lyricsOnFrom("0")).toBe(false);
  });
  it("is on when they were turned on", () => {
    expect(lyricsOnFrom("1")).toBe(true);
  });
  it("round-trips with lyricsChoice", () => {
    expect(lyricsOnFrom(lyricsChoice(false))).toBe(false);
    expect(lyricsOnFrom(lyricsChoice(true))).toBe(true);
  });
});

describe("lyricsSwitch", () => {
  it("stays hidden while the lyrics load", () => {
    expect(lyricsSwitch({ loaded: false, lineCount: 0, on: true })).toEqual({ kind: "hidden" });
  });
  it("gives a reason for songs without lyrics instead of pretending", () => {
    const s = lyricsSwitch({ loaded: true, lineCount: 0, on: true });
    expect(s.kind).toBe("none");
    if (s.kind === "none") expect(s.reason).toBe("No lyrics for this song yet");
  });
  it("shows the state in words as well as the switch", () => {
    expect(lyricsSwitch({ loaded: true, lineCount: 12, on: true })).toMatchObject({ kind: "ready", checked: true, stateText: "On" });
    expect(lyricsSwitch({ loaded: true, lineCount: 12, on: false })).toMatchObject({ kind: "ready", checked: false, stateText: "Off" });
  });
});

describe("doubleClickFullscreen", () => {
  const base = { supported: true, onControl: false, pageFullscreen: false, browserFullscreen: false };
  it("goes into full screen from a double-click on empty space", () => {
    expect(doubleClickFullscreen(base)).toBe("enter");
  });
  it("comes out again with the same double-click", () => {
    expect(doubleClickFullscreen({ ...base, pageFullscreen: true })).toBe("exit");
  });
  it("does nothing on a button or other control", () => {
    expect(doubleClickFullscreen({ ...base, onControl: true })).toBeNull();
    expect(doubleClickFullscreen({ ...base, onControl: true, pageFullscreen: true })).toBeNull();
  });
  it("leaves the browser's own full screen and browsers without it alone", () => {
    expect(doubleClickFullscreen({ ...base, browserFullscreen: true })).toBeNull();
    expect(doubleClickFullscreen({ ...base, supported: false })).toBeNull();
  });
  it("counts the room's controls as controls", () => {
    for (const s of ["button", "a[href]", '[role="switch"]', '[role="slider"]', ".lr-bar"]) expect(ROOM_CONTROLS).toContain(s);
  });
});
