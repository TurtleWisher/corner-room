import { describe, expect, it } from "vitest";

import { MIN_TITLE_FIT, titleFit, titleParts, titleWithVersion } from "./track-title-view";

describe("song title with its version (D-VERSION-01)", () => {
  it("puts the version in brackets after the title", () => {
    expect(titleWithVersion("Meghe Dhaka Dhrubotara", "Acoustic Demo")).toBe("Meghe Dhaka Dhrubotara (Acoustic Demo)");
  });

  it("keeps the plain title when there is no version", () => {
    expect(titleWithVersion("Night Bus", null)).toBe("Night Bus");
    expect(titleWithVersion("Night Bus", "   ")).toBe("Night Bus");
  });

  it("never doubles brackets or a version already in the title", () => {
    expect(titleWithVersion("Night Bus", "(Live)")).toBe("Night Bus (Live)");
    expect(titleWithVersion("Night Bus (live)", "Live")).toBe("Night Bus (live)");
  });

  it("works for Bangla", () => {
    expect(titleWithVersion("মেঘে ঢাকা ধ্রুবতারা", "অ্যাকুস্টিক")).toBe("মেঘে ঢাকা ধ্রুবতারা (অ্যাকুস্টিক)");
  });

  it("gives the title and the version apart, so the version can be drawn smaller", () => {
    expect(titleParts("Meghe Dhaka Dhrubotara", "Acoustic Demo")).toEqual({ title: "Meghe Dhaka Dhrubotara", version: "Acoustic Demo" });
    expect(titleParts("Night Bus (Live)", "Live")).toEqual({ title: "Night Bus (Live)", version: null });
  });
});

describe("room title on one line", () => {
  it("keeps a title that fits at full size", () => {
    expect(titleFit(800, 600)).toBe(1);
  });

  it("shrinks a long title just enough to fit", () => {
    expect(titleFit(600, 1200)).toBe(0.485);
    expect(titleFit(700, 1100) * 1100).toBeLessThanOrEqual(700);
  });

  it("never shrinks below the floor, and ignores sizes it can't measure", () => {
    expect(titleFit(100, 5000)).toBe(MIN_TITLE_FIT);
    expect(titleFit(0, 500)).toBe(1);
    expect(titleFit(500, 0)).toBe(1);
  });
});
