import { describe, expect, it } from "vitest";

import { belongsTo, shouldForget } from "./offline-view";

describe("offline songs", () => {
  it("forgets a copy only when the API says the account may not have it", () => {
    expect(shouldForget(403, "DOWNLOAD_NOT_OWNED")).toBe(true); // refunded or never bought
    expect(shouldForget(409, "TRACK_TAKEN_DOWN")).toBe(true); // legal takedown
    expect(shouldForget(404, null)).toBe(true);
    expect(shouldForget(503, "RATE_LIMIT_UNAVAILABLE")).toBe(false);
    expect(shouldForget(429, "RATE_LIMITED")).toBe(false);
    expect(shouldForget(0, null)).toBe(false); // offline
    expect(shouldForget(401, null)).toBe(false); // signed out: keep until we know
  });

  it("shows only the songs of the signed-in account", () => {
    const songs = [{ userId: "a", trackId: "1" }, { userId: "b", trackId: "2" }];
    expect(belongsTo(songs, "a")).toEqual([{ userId: "a", trackId: "1" }]);
    expect(belongsTo(songs, null)).toEqual([]);
  });
});
