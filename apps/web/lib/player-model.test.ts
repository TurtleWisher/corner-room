import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";
import {
  acceptCodecs,
  afterEnd,
  clock,
  durationLabel,
  formatLabel,
  isAutoplayBlocked,
  isSuperseded,
  levelMultiplier,
  listenedMs,
  nextRepeat,
  outputLevels,
  playProblem,
  previousAction,
  problemMessage,
  queueFor,
  repeatLabel,
  seekTarget,
  shuffled,
  stepIndex,
  stepWithRepeat,
} from "@/lib/player-model";

describe("repeat and shuffle", () => {
  it("cycles repeat and names it", () => {
    expect(nextRepeat("off")).toBe("all");
    expect(nextRepeat("all")).toBe("one");
    expect(nextRepeat("one")).toBe("off");
    expect(repeatLabel("one")).toBe("Repeat: this track");
  });

  it("wraps only with repeat all", () => {
    expect(stepWithRepeat(2, 3, 1, "off")).toBeNull();
    expect(stepWithRepeat(2, 3, 1, "all")).toBe(0);
    expect(stepWithRepeat(0, 3, -1, "all")).toBe(2);
    expect(stepWithRepeat(0, 1, 1, "all")).toBeNull();
    expect(stepWithRepeat(0, 3, 1, "one")).toBe(1);
  });

  it("decides what follows the end of a track", () => {
    expect(afterEnd(0, 3, "off")).toEqual({ kind: "go", index: 1 });
    expect(afterEnd(2, 3, "off")).toEqual({ kind: "stop" });
    expect(afterEnd(2, 3, "all")).toEqual({ kind: "go", index: 0 });
    expect(afterEnd(1, 3, "one")).toEqual({ kind: "replay" });
    expect(afterEnd(0, 1, "all")).toEqual({ kind: "stop" });
  });

  it("shuffles with the current track first and every track kept once", () => {
    const list = ["a", "b", "c", "d", "e"];
    let seed = 0.37;
    const random = () => (seed = (seed * 9301 + 0.49297) % 1);
    const out = shuffled(list, 2, random);
    expect(out[0]).toBe("c");
    expect([...out].sort()).toEqual(list);
    expect(shuffled(["only"], 0)).toEqual(["only"]);
    expect(shuffled([], 0)).toEqual([]);
  });
});

describe("codecs and levelling", () => {
  it("asks for what the browser can decode, MP3 always included", () => {
    expect(acceptCodecs((m) => (m.includes("opus") || m === "audio/mpeg" ? "probably" : ""))).toEqual(["opus", "mp3"]);
    expect(acceptCodecs(() => "")).toEqual(["mp3"]);
    expect(
      acceptCodecs(() => {
        throw new Error("no");
      }),
    ).toEqual(["mp3"]);
    expect(formatLabel("opus", 160)).toBe("Opus · 160 kbps");
    expect(formatLabel(null, 320)).toBeNull();
  });

  it("turns gain into levels, never louder than the volume without a gain stage", () => {
    expect(levelMultiplier(-6, true)).toBeCloseTo(0.501, 3);
    expect(levelMultiplier(-6, false)).toBe(1);
    expect(levelMultiplier(null, true)).toBe(1);
    // Loud song, not routed: the element carries the cut.
    expect(outputLevels(0.8, false, 0.5, false)).toEqual({ element: 0.4, gain: 1 });
    // Quiet song, not routed: plays at its own level.
    expect(outputLevels(0.8, false, 1.5, false)).toEqual({ element: 0.8, gain: 1 });
    // Routed: the element stays neutral and the gain stage does it all.
    expect(outputLevels(0.8, false, 1.5, true)).toEqual({ element: 1, gain: 0.8 * 1.5 });
    expect(outputLevels(0.8, true, 1.5, true)).toEqual({ element: 1, gain: 0 });
    expect(outputLevels(0.8, true, 0.5, false).element).toBe(0);
  });
});

describe("player model", () => {
  it("maps API answers to player states", () => {
    expect(playProblem(new ApiError({ status: 401, code: "UNAUTHORIZED" }))).toEqual({ kind: "signed_out" });
    expect(playProblem(new ApiError({ status: 403, code: "ENTITLEMENT_REQUIRED" }))).toEqual({ kind: "needs_access" });
    expect(playProblem(new ApiError({ status: 409, code: "TRACK_TAKEN_DOWN" }))).toEqual({ kind: "taken_down" });
    expect(playProblem(new Error("x"))).toEqual({ kind: "stopped" });
    expect(problemMessage({ kind: "needs_access" })).toMatch(/Subscription required/);
  });

  it("formats time and caps listened time at the media length", () => {
    expect(clock(65.4)).toBe("1:05");
    expect(clock(NaN)).toBe("0:00");
    expect(listenedMs(12.3456, 20)).toBe(12346);
    expect(listenedMs(25, 20)).toBe(20000);
    expect(listenedMs(NaN, NaN)).toBe(0);
  });

  it("shows an unknown duration as --:-- rather than 0:00", () => {
    expect(durationLabel(20)).toBe("0:20");
    expect(durationLabel(0)).toBe("--:--");
    expect(durationLabel(Infinity)).toBe("--:--");
    expect(durationLabel(NaN)).toBe("--:--");
  });
});

describe("up next queue", () => {
  const a = { id: "a", title: "A" };
  const b = { id: "b", title: "B" };
  const c = { id: "c", title: "C" };

  it("queues the list a track was played from, at that track", () => {
    expect(queueFor(b, [a, b, c])).toEqual({ tracks: [a, b, c], index: 1 });
  });

  it("plays a lone track when it is not in the list", () => {
    expect(queueFor(c, [a, b])).toEqual({ tracks: [c], index: 0 });
    expect(queueFor(a)).toEqual({ tracks: [a], index: 0 });
  });

  it("keeps the newer details of the played track", () => {
    expect(queueFor({ id: "b", title: "B (Live)" }, [a, b]).tracks[1].title).toBe("B (Live)");
  });

  it("steps within the queue and stops at either end", () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBeNull();
    expect(stepIndex(0, 3, -1)).toBeNull();
  });

  it("goes back one track with Previous, and restarts only the first track", () => {
    expect(previousAction(2)).toBe("previous");
    expect(previousAction(1)).toBe("previous");
    expect(previousAction(0)).toBe("restart");
  });
});

describe("browser playback answers", () => {
  it("recognises autoplay refusals and superseded loads", () => {
    expect(isAutoplayBlocked(new DOMException("x", "NotAllowedError"))).toBe(true);
    expect(isAutoplayBlocked(new Error("x"))).toBe(false);
    expect(isSuperseded(new DOMException("x", "AbortError"))).toBe(true);
  });

  it("clamps seeking into the media and refuses an unknown length", () => {
    expect(seekTarget(30, 20)).toBe(20);
    expect(seekTarget(-4, 20)).toBe(0);
    expect(seekTarget(5, 0)).toBeNull();
    expect(seekTarget(5, Infinity)).toBeNull();
  });
});
