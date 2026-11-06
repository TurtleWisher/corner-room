import { describe, expect, it } from "vitest";

import { isRoomGestureKey, lyricsChoice, lyricsOnFrom, lyricsSwitch, shouldAskFullscreen } from "./room-controls-view";

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

describe("isRoomGestureKey", () => {
  it("counts deliberate keys", () => {
    for (const key of ["Enter", " ", "ArrowRight", "k"]) expect(isRoomGestureKey(key)).toBe(true);
  });
  it("never counts leaving, moving focus or modifiers", () => {
    for (const key of ["Escape", "Tab", "Shift", "Control", "Alt", "Meta", "F11", ""]) expect(isRoomGestureKey(key)).toBe(false);
  });
});

describe("shouldAskFullscreen", () => {
  const base = { asked: false, supported: true, alreadyFullscreen: false, leavesRoom: false, typing: false };
  it("asks on the first gesture", () => {
    expect(shouldAskFullscreen(base)).toBe(true);
  });
  it("asks once per visit", () => {
    expect(shouldAskFullscreen({ ...base, asked: true })).toBe(false);
  });
  it("never asks where the browser cannot, or when already full screen", () => {
    expect(shouldAskFullscreen({ ...base, supported: false })).toBe(false);
    expect(shouldAskFullscreen({ ...base, alreadyFullscreen: true })).toBe(false);
  });
  it("never asks for a gesture that leaves the room or types", () => {
    expect(shouldAskFullscreen({ ...base, leavesRoom: true })).toBe(false);
    expect(shouldAskFullscreen({ ...base, typing: true })).toBe(false);
  });
});
