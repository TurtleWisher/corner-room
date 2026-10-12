import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";
import { clock, listenedMs, playProblem, problemMessage } from "@/lib/player-model";

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
});
