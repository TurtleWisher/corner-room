import { describe, expect, it } from "vitest";

import { LOGO_TILT_MAX, logoTilt, withinTilt } from "./logo-tilt";

const box = { left: 100, top: 50, width: 200, height: 100 };

describe("logoTilt", () => {
  it("is flat in the middle", () => {
    expect(logoTilt({ ...box, x: 200, y: 100 })).toEqual({ rx: 0, ry: 0 });
  });
  it("turns toward the side under the pointer", () => {
    expect(logoTilt({ ...box, x: 300, y: 100 }).ry).toBe(LOGO_TILT_MAX);
    expect(logoTilt({ ...box, x: 100, y: 100 }).ry).toBe(-LOGO_TILT_MAX);
    expect(logoTilt({ ...box, x: 200, y: 50 }).rx).toBeGreaterThan(0);
    expect(logoTilt({ ...box, x: 200, y: 150 }).rx).toBeLessThan(0);
  });
  it("never goes past the limit, even outside the box", () => {
    const t = logoTilt({ ...box, x: 5000, y: -5000 });
    expect(withinTilt(t)).toBe(true);
    expect(Math.abs(t.ry)).toBe(LOGO_TILT_MAX);
  });
  it("stays flat for a box with no size", () => {
    expect(logoTilt({ x: 1, y: 1, left: 0, top: 0, width: 0, height: 0 })).toEqual({ rx: 0, ry: 0 });
  });
});
