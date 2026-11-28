import { describe, expect, it } from "vitest";

import { bpsToPercent, coverEarlierWords, matchesRateFilter, percentProblem, percentToBps, rateLabel, rateMeaning, spanWords } from "./royalty-rate-view";

describe("percentToBps", () => {
  it("reads whole and decimal percentages without floats", () => {
    expect(percentToBps("70")).toBe(7000);
    expect(percentToBps(" 12.5 ")).toBe(1250);
    expect(percentToBps("12.55")).toBe(1255);
    expect(percentToBps("0.05")).toBe(5);
    expect(percentToBps("33,3")).toBe(3330);
    expect(percentToBps("70%")).toBe(7000);
    expect(percentToBps("0")).toBe(0);
    expect(percentToBps("100")).toBe(10000);
    expect(percentToBps("7.")).toBe(700);
  });
  it("refuses anything outside 0 to 100 or with more than two decimals", () => {
    for (const bad of ["", "-1", "100.01", "101", "12.555", "abc", "1e2", "."]) expect(percentToBps(bad)).toBeNull();
  });
});

describe("bpsToPercent", () => {
  it("writes the shortest form", () => {
    expect(bpsToPercent(7000)).toBe("70");
    expect(bpsToPercent(1250)).toBe("12.5");
    expect(bpsToPercent(1255)).toBe("12.55");
    expect(bpsToPercent(5)).toBe("0.05");
    expect(bpsToPercent(0)).toBe("0");
    expect(bpsToPercent(10000)).toBe("100");
  });
  it("round-trips", () => {
    for (const bps of [0, 1, 99, 100, 1234, 5000, 9999, 10000]) expect(percentToBps(bpsToPercent(bps))).toBe(bps);
  });
});

describe("words", () => {
  it("labels and explains a rate", () => {
    expect(rateLabel(null)).toBe("No rate yet");
    expect(rateLabel(7000)).toBe("70%");
    expect(rateMeaning(7000)).toBe("The artist earns 70 of every 100 a fan pays for their music.");
    expect(rateMeaning(null)).toMatch(/agreed/);
    expect(percentProblem("")).toBe("Type a percentage.");
    expect(percentProblem("150")).toMatch(/0 to 100/);
    expect(percentProblem("50")).toBeNull();
  });
  it("describes spans and earlier sales", () => {
    expect(spanWords(null, null)).toBe("From the start, still in use");
    expect(spanWords(null, "2026-11-20T00:00:00Z")).toMatch(/^From the start until /);
    expect(spanWords("2026-11-20T00:00:00Z", null)).toMatch(/^Since /);
    expect(coverEarlierWords(0)).toBeNull();
    expect(coverEarlierWords(1)).toBe("Also give this rate to the 1 earlier sale with no rate yet");
    expect(coverEarlierWords(3)).toMatch(/3 earlier sales/);
  });
  it("filters", () => {
    expect(matchesRateFilter({ share_bps: null, no_rate_sales: 0 }, "no-rate")).toBe(true);
    expect(matchesRateFilter({ share_bps: 5000, no_rate_sales: 2 }, "no-rate")).toBe(true);
    expect(matchesRateFilter({ share_bps: 5000, no_rate_sales: 0 }, "no-rate")).toBe(false);
    expect(matchesRateFilter({ share_bps: 5000, no_rate_sales: 0 }, "with-rate")).toBe(true);
    expect(matchesRateFilter({ share_bps: null, no_rate_sales: 0 }, "all")).toBe(true);
  });
});
