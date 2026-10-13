import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";
import {
  clock,
  durationLabel,
  isAutoplayBlocked,
  isSuperseded,
  listenedMs,
  playProblem,
  previousAction,
  problemMessage,
  queueFor,
  seekTarget,
  stepIndex,
} from "@/lib/player-model";

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
