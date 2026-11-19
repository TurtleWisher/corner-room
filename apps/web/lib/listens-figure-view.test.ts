import { describe, expect, it } from "vitest";

import { figureFit, figureGlyphs, figureLayout, rollEase, rollTarget, rollTiming } from "@/lib/listens-figure-view";

describe("figureGlyphs", () => {
  it("keys each place by where it stands from the point", () => {
    expect(figureGlyphs(753).map((g) => g.key)).toEqual(["i0", "p", "f1", "f2", "f3", "f4", "f5", "f6"]);
    expect(figureGlyphs(12_500_000).map((g) => g.key)).toEqual(["i1", "i0", "p", "f1"]);
  });

  it("reads the count in millions, exactly", () => {
    const digits = (n: number) =>
      figureGlyphs(n)
        .map((g) => (g.kind === "point" ? "." : String(g.value)))
        .join("");
    expect(digits(753)).toBe("0.000753");
    expect(digits(18)).toBe("0.000018");
    expect(digits(1_000_000)).toBe("1");
    expect(digits(0)).toBe("0");
  });

  it("turns places to the right more, never below none", () => {
    const turns = figureGlyphs(753).flatMap((g) => (g.kind === "digit" ? [g.turns] : []));
    expect(turns).toEqual([0, 0, 0, 0, 0, 1, 2]);
  });
});

describe("figureLayout", () => {
  it("centres the figure on 0 with a narrower point", () => {
    const { width, xs } = figureLayout(figureGlyphs(12_500_000), { digit: 1, point: 0.4 });
    expect(width).toBeCloseTo(3.4);
    expect(xs.i1).toBeCloseTo(-1.2);
    expect(xs.p).toBeCloseTo(0.5);
    expect(xs.f1).toBeCloseTo(1.2);
  });
});

describe("rollTarget", () => {
  it("only rolls forward, like a counter", () => {
    expect(rollTarget(7, 3, 0)).toBe(13);
    expect(rollTarget(0, 5, 0)).toBe(5);
  });

  it("adds whole turns, and stays put on the same digit", () => {
    expect(rollTarget(2, 4, 2)).toBe(24);
    expect(rollTarget(14, 4, 3)).toBe(14);
  });
});

describe("rollTiming and rollEase", () => {
  it("matches the song page's timing", () => {
    expect(rollTiming(0, 0)).toEqual({ delayMs: 240, durationMs: 1100 });
    expect(rollTiming(2, 3)).toEqual({ delayMs: 450, durationMs: 1860 });
  });

  it("starts at 0, ends at 1 and runs ahead early", () => {
    expect(rollEase(0)).toBe(0);
    expect(rollEase(1)).toBe(1);
    expect(rollEase(0.25)).toBeGreaterThan(0.6);
    expect(rollEase(0.5)).toBeLessThanOrEqual(1);
  });
});

describe("figureFit", () => {
  it("shrinks a figure wider than the room, never grows one", () => {
    expect(figureFit(10, 5)).toBe(0.5);
    expect(figureFit(4, 8)).toBe(1);
    expect(figureFit(0, 8)).toBe(1);
  });
});
