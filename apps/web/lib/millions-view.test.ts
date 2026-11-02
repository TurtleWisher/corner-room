import { describe, expect, it } from "vitest";

import { counterPlaces, inMillions } from "./millions-view";

describe("inMillions", () => {
  it("writes small counts as exact fractions of a million", () => {
    expect(inMillions(500)).toBe("0.0005");
    expect(inMillions(753)).toBe("0.000753");
    expect(inMillions(1)).toBe("0.000001");
    expect(inMillions(120_000)).toBe("0.12");
  });

  it("keeps every digit of large counts, with no rounding", () => {
    expect(inMillions(1_000_000)).toBe("1");
    expect(inMillions(1_234_567)).toBe("1.234567");
    expect(inMillions(25_000_001)).toBe("25.000001");
    expect(inMillions(1_200_000_000)).toBe("1200");
  });

  it("reads nothing as zero and never goes negative", () => {
    expect(inMillions(0)).toBe("0");
    expect(inMillions(-5)).toBe("0");
    expect(inMillions(Number.NaN)).toBe("0");
    expect(inMillions(752.9)).toBe("0.000752");
  });
});

describe("counterPlaces", () => {
  it("turns the last digit most and each place to its left one fewer", () => {
    expect(counterPlaces("0.0005")).toEqual([
      { kind: "digit", value: 0, turns: 0 },
      { kind: "point" },
      { kind: "digit", value: 0, turns: 0 },
      { kind: "digit", value: 0, turns: 1 },
      { kind: "digit", value: 0, turns: 2 },
      { kind: "digit", value: 5, turns: 3 },
    ]);
  });

  it("handles a whole number with no point", () => {
    expect(counterPlaces("12", 2)).toEqual([
      { kind: "digit", value: 1, turns: 1 },
      { kind: "digit", value: 2, turns: 2 },
    ]);
  });
});
