import { describe, expect, it } from "vitest";

import { carryTimes, lineWindow, matchParts, saveAction, searchWords, songContext, songIdIn, songMark, tidyLyrics, wordsChanged } from "./staff-lyrics-view";

describe("staff lyrics sync helpers", () => {
  it("reads a song id out of a pasted address", () => {
    expect(songIdIn("https://www.cornerroom.live/tracks/0F8E6D2C-1111-4222-8333-944455556666?x=1")).toBe("0f8e6d2c-1111-4222-8333-944455556666");
    expect(songIdIn("Night Bus")).toBeNull();
  });

  it("tidies words the way the server keeps them", () => {
    expect(tidyLyrics("\r\nOne  \r\nTwo\t\n\n\n\nThree\n\n")).toBe("One\nTwo\n\nThree");
    expect(tidyLyrics("   \n  ")).toBeNull();
    expect(wordsChanged("One\n\n\nTwo  ", "One\n\nTwo")).toBe(false);
    expect(wordsChanged("One\nTwo", "One\n\nTwo")).toBe(true);
  });

  it("keeps every time for a fix with the same lines, and the times before an added line", () => {
    expect(carryTimes(["a", "b", "c"], ["a", "B!", "c"], [1, 2, 3])).toEqual([1, 2, 3]);
    expect(carryTimes(["a", "b", "c"], ["a", "x", "b", "c"], [1, 2, 3])).toEqual([1]);
    expect(carryTimes(["a", "b"], ["a", "b", "c"], [1, 2])).toEqual([1, 2]);
    expect(carryTimes(["a", "b", "c"], ["a", "b"], [1, 2, 3])).toEqual([1, 2]);
  });

  it("marks each song in the list with one state", () => {
    expect(songMark({ lines: 0, timed: false, lyrics_waiting: false }).label).toBe("No lyrics");
    expect(songMark({ lines: 4, timed: false, lyrics_waiting: false }).label).toBe("Not synced");
    expect(songMark({ lines: 4, timed: true, lyrics_waiting: false }).label).toBe("Synced");
    expect(songMark({ lines: 4, timed: true, lyrics_waiting: true }).label).toBe("Change waiting");
    expect(songContext({ title: "Rumi", profile_name: "Kaal Bela", release_title: "Rumi" })).toBe("Kaal Bela");
    expect(songContext({ title: "Rumi", profile_name: null, release_title: "Night Bus" })).toBe("Night Bus");
  });

  it("names what the one Save button does", () => {
    const base = { live: "a\nb", stored: [1, 2], approvesAtOnce: true };
    expect(saveAction({ ...base, draft: "a\nb", times: [1, 2] })).toBeNull();
    expect(saveAction({ ...base, draft: "a\nb", times: [1, 3] })).toEqual({ label: "Save timings", words: false, times: true });
    expect(saveAction({ ...base, draft: "a\nb", times: [1] })).toBeNull();
    expect(saveAction({ ...base, draft: "a\nB", times: [1, 2] })).toEqual({ label: "Save words and timings", words: true, times: true });
    expect(saveAction({ ...base, draft: "a\nb\nc", times: [1, 2] })).toEqual({ label: "Save words", words: true, times: false });
    expect(saveAction({ ...base, approvesAtOnce: false, draft: "a\nB", times: [1, 2] })?.label).toBe("Send words for approval");
  });
});

describe("finder and sync page helpers (owner, 2026-11-21)", () => {
  it("shows no list until something is typed", () => {
    expect(searchWords("")).toEqual([]);
    expect(searchWords("   ")).toEqual([]);
    expect(searchWords(" kaal  stop ")).toEqual(["kaal", "stop"]);
  });

  it("marks the typed words in a title, any case, overlapping words merged", () => {
    expect(matchParts("Last Stop", "stop")).toEqual([
      { text: "Last ", hit: false },
      { text: "Stop", hit: true },
    ]);
    expect(matchParts("Kaal Bela", "KAAL bel")).toEqual([
      { text: "Kaal", hit: true },
      { text: " ", hit: false },
      { text: "Bel", hit: true },
      { text: "a", hit: false },
    ]);
    expect(matchParts("Rumi", "")).toEqual([{ text: "Rumi", hit: false }]);
    expect(matchParts("", "x")).toEqual([]);
  });

  it("gives the line before, on show and next", () => {
    expect(lineWindow(["a", "b", "c"], 1)).toEqual({ before: "a", now: "b", after: "c" });
    expect(lineWindow(["a", "b"], 0)).toEqual({ before: null, now: "a", after: "b" });
    expect(lineWindow(["a"], -1)).toEqual({ before: null, now: null, after: "a" });
  });
});

describe("line ends (D-LYRICS-05)", () => {
  it("a hold starts the line on press and ends it on letting go", async () => {
    const { pressTap, releaseTap, tapsDone, canPress } = await import("./staff-lyrics-view");
    let t = pressTap({ times: [], ends: [] }, 1000.4, 2);
    expect(t).toEqual({ times: [1000], ends: [] });
    t = releaseTap(t, 1000, 2600);
    expect(t).toEqual({ times: [1000], ends: [2600] });
    t = releaseTap(pressTap(t, 3000, 2), 3000, 4100);
    expect(t).toEqual({ times: [1000, 3000], ends: [2600, 4100] });
    expect(tapsDone(t, 2)).toBe(true);
    expect(canPress(t, 2)).toBe(false);
  });

  it("a quick tap leaves the line open until the next press, and one more tap ends the last line", async () => {
    const { pressTap, releaseTap, isOpen, tapsDone, canPress } = await import("./staff-lyrics-view");
    let t = releaseTap(pressTap({ times: [], ends: [] }, 1000, 2), 1000, 1080);
    expect(isOpen(t)).toBe(true);
    t = releaseTap(pressTap(t, 3000, 2), 3000, 3050);
    expect(t).toEqual({ times: [1000, 3000], ends: [3000] });
    expect(canPress(t, 2)).toBe(true);
    t = pressTap(t, 5200, 2);
    expect(t).toEqual({ times: [1000, 3000], ends: [3000, 5200] });
    expect(tapsDone(t, 2)).toBe(true);
  });

  it("never starts a line before the one before it ended", async () => {
    const { pressTap } = await import("./staff-lyrics-view");
    expect(pressTap({ times: [1000], ends: [2600] }, 2500, 3)).toEqual({ times: [1000, 2600], ends: [2600] });
    expect(pressTap({ times: [1000], ends: [] }, 1000, 3)).toEqual({ times: [1000, 1001], ends: [1001] });
  });

  it("loads start-only songs as lines that end when the next starts, the last one open", async () => {
    const { loadTaps } = await import("./staff-lyrics-view");
    expect(loadTaps([1000, 3000, 5000], null)).toEqual({ times: [1000, 3000, 5000], ends: [3000, 5000] });
    expect(loadTaps([1000, 3000], [2000, 4000])).toEqual({ times: [1000, 3000], ends: [2000, 4000] });
    expect(loadTaps(null, null)).toEqual({ times: [], ends: [] });
  });

  it("retakes, nudges and draws the sung spans", async () => {
    const { tapsBefore, shiftTaps, tapSpans } = await import("./staff-lyrics-view");
    const t = { times: [1000, 3000, 5000], ends: [2000, 4000] };
    expect(tapsBefore(t, 1)).toEqual({ times: [1000], ends: [2000] });
    expect(shiftTaps({ times: [50, 3000], ends: [60, 4000] }, -100)).toEqual({ times: [0, 2900], ends: [1, 3900] });
    expect(tapSpans(t, 10)).toEqual([
      { from: 0.1, to: 0.2 },
      { from: 0.3, to: 0.4 },
      { from: 0.5, to: null },
    ]);
  });

  it("saves the times only once every line has its end, and an end change is a change", () => {
    const base = { draft: "a\nb", live: "a\nb", stored: [1, 5], approvesAtOnce: true };
    expect(saveAction({ ...base, times: [1, 5], ends: [3], storedEnds: null })).toBeNull();
    expect(saveAction({ ...base, times: [1, 5], ends: [3, 7], storedEnds: null })?.label).toBe("Save timings");
    expect(saveAction({ ...base, times: [1, 5], ends: [3, 7], storedEnds: [3, 7] })).toBeNull();
    expect(saveAction({ ...base, times: [1, 5], ends: [4, 7], storedEnds: [3, 7] })?.label).toBe("Save timings");
    expect(songMark({ lines: 4, timed: true, line_ends: false, lyrics_waiting: false }).label).toBe("Needs line ends");
    expect(songMark({ lines: 4, timed: true, line_ends: true, lyrics_waiting: false }).label).toBe("Synced");
  });
});
