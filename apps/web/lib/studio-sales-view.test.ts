import { describe, expect, it } from "vitest";

import { buyersSummary, money, namesToShow, saleKindLabel, salesCountText } from "./studio-sales-view";

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

describe("buyers' names (D-BUYERS-01)", () => {
  it("words the count with the release type", () => {
    expect(buyersSummary({ subject_type: "RELEASE", release_type: "ALBUM", names: ["Arif", "Zara"] })).toBe("Album · 2 buyers");
    expect(buyersSummary({ subject_type: "TRACK", release_type: null, names: ["Arif"] })).toBe("Song · 1 buyer");
  });

  it("shows the first names, then all once opened", () => {
    const names = Array.from({ length: 15 }, (_, i) => `Fan ${i + 1}`);
    expect(namesToShow(names, false)).toEqual({ shown: names.slice(0, 12), hidden: 3 });
    expect(namesToShow(names, true)).toEqual({ shown: names, hidden: 0 });
    expect(namesToShow(["Arif"], false)).toEqual({ shown: ["Arif"], hidden: 0 });
  });
});

