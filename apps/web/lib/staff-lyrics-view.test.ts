import { describe, expect, it } from "vitest";

import { carryTimes, saveAction, songContext, songIdIn, songMark, tidyLyrics, wordsChanged } from "./staff-lyrics-view";

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
