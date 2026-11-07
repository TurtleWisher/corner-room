import { describe, expect, it } from "vitest";

import { coverSrcSet, coverUrl, offerCoverSource } from "./cover-view";

describe("coverSrcSet", () => {
  it("offers the 480 and 1200 px copies so large covers stay sharp", () => {
    expect(coverSrcSet({ track: "t1" }, "http://api.example")).toBe(
      "http://api.example/api/v1/covers/tracks/t1/480 480w, http://api.example/api/v1/covers/tracks/t1/1200 1200w",
    );
  });

  it("is null when it is known there is no cover", () => {
    expect(coverSrcSet({ release: "r1", hasCover: false }, "http://api.example")).toBeNull();
    expect(coverSrcSet({ signed: null }, "http://api.example")).toBeNull();
  });
});

const BASE = "http://api.example";

describe("coverUrl", () => {
  it("builds public addresses for released music", () => {
    expect(coverUrl({ release: "r1" }, 1200, BASE)).toBe("http://api.example/api/v1/covers/releases/r1/1200");
    expect(coverUrl({ track: "t1" }, 160, BASE)).toBe("http://api.example/api/v1/covers/tracks/t1/160");
    expect(coverUrl({ release: "r1" }, undefined, BASE)).toBe("http://api.example/api/v1/covers/releases/r1/480");
    expect(coverUrl({ event: "e1" }, 480, BASE)).toBe("http://api.example/api/v1/covers/events/e1/480");
    expect(coverUrl({ event: "e1", hasCover: false }, 480, BASE)).toBeNull();
  });

  it("skips the request when the release is known to have no cover", () => {
    expect(coverUrl({ release: "r1", hasCover: false }, 480, BASE)).toBeNull();
    expect(coverUrl({ release: "r1", hasCover: true }, 480, BASE)).toContain("/releases/r1/480");
  });

  it("uses signed links as given, or nothing", () => {
    expect(coverUrl({ signed: "/api/v1/covers/signed/abc/480" }, 480, BASE)).toBe("http://api.example/api/v1/covers/signed/abc/480");
    expect(coverUrl({ signed: null }, 480, BASE)).toBeNull();
  });
});

describe("offerCoverSource", () => {
  it("uses the release or song an offer sells, and nothing for plans", () => {
    expect(offerCoverSource("RELEASE", "r1")).toEqual({ release: "r1" });
    expect(offerCoverSource("TRACK", "t1")).toEqual({ track: "t1" });
    expect(offerCoverSource("SUBSCRIPTION_PLAN", "p1")).toBeNull();
    expect(offerCoverSource("CATALOG_ACCESS", "x")).toBeNull();
    expect(offerCoverSource("RELEASE", null)).toBeNull();
  });
});
