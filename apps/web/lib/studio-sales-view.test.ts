import { describe, expect, it } from "vitest";

import { money, saleKindLabel, salesCountText } from "./studio-sales-view";

describe("studio sales view", () => {
  it("names what was sold", () => {
    expect(saleKindLabel({ subject_type: "TRACK", release_type: null })).toBe("Song");
    expect(saleKindLabel({ subject_type: "RELEASE", release_type: "ALBUM" })).toBe("Album");
    expect(saleKindLabel({ subject_type: "RELEASE", release_type: "SINGLE" })).toBe("Single");
    expect(saleKindLabel({ subject_type: "RELEASE", release_type: "MIXTAPE" })).toBe("Release");
    expect(saleKindLabel({ subject_type: "RELEASE", release_type: null })).toBe("Release");
  });

  it("counts sales and refunds in words", () => {
    expect(salesCountText(1, 0)).toBe("1 sale");
    expect(salesCountText(3, 0)).toBe("3 sales");
    expect(salesCountText(3, 1)).toBe("3 sales · 1 refunded");
  });

  it("passes API amounts through unchanged", () => {
    expect(money(150000, "BDT")).toEqual({ amount_minor: 150000, currency_code: "BDT" });
  });
});
