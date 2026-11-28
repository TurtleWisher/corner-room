import { describe, expect, it } from "vitest";

import { MAX_LEAN, leanDegrees, leanFor, pointerIn } from "./home-motion-view";

const box = { left: 100, top: 50, width: 200, height: 100 };

describe("pointerIn", () => {
  it("reads the centre as 0 and the corners as -1 and 1", () => {
    expect(pointerIn(200, 100, box)).toEqual({ x: 0, y: 0, mx: 50, my: 50 });
    expect(pointerIn(100, 50, box)).toEqual({ x: -1, y: -1, mx: 0, my: 0 });
    expect(pointerIn(300, 150, box)).toEqual({ x: 1, y: 1, mx: 100, my: 100 });
  });
  it("holds a pointer outside the box at its edge", () => {
    expect(pointerIn(-500, 900, box)).toEqual({ x: -1, y: 1, mx: 0, my: 100 });
  });
  it("treats an empty box as its centre", () => {
    expect(pointerIn(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0, mx: 50, my: 50 });
  });
});

describe("leanDegrees", () => {
  it("reads the attribute, with a fallback for nothing or nonsense", () => {
    expect(leanDegrees("8")).toBe(8);
    expect(leanDegrees("1.5")).toBe(1.5);
    expect(leanDegrees("")).toBe(6);
    expect(leanDegrees(undefined, 4)).toBe(4);
    expect(leanDegrees("wobble", 3)).toBe(3);
  });
  it("never leans past the cap or below flat", () => {
    expect(leanDegrees("90")).toBe(MAX_LEAN);
    expect(leanDegrees("-4")).toBe(0);
  });
});

describe("leanFor", () => {
  it("brings the side under the pointer toward the reader", () => {
    expect(leanFor(1, 0, 8)).toEqual({ turnX: 0, turnY: 8 });
    expect(leanFor(0, 1, 8)).toEqual({ turnX: -8, turnY: 0 });
    expect(leanFor(0, -1, 8)).toEqual({ turnX: 8, turnY: 0 });
  });
  it("stays flat in the middle and within the limit outside", () => {
    expect(leanFor(0, 0, 8)).toEqual({ turnX: 0, turnY: 0 });
    expect(leanFor(5, -5, 8)).toEqual({ turnX: 8, turnY: 8 });
    expect(leanFor(Number.NaN, 0, 8)).toEqual({ turnX: 0, turnY: 0 });
  });
});
