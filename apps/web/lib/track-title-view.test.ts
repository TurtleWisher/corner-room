import { describe, expect, it } from "vitest";

import { titleWithVersion } from "./track-title-view";

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
});
