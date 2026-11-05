import { describe, expect, it } from "vitest";

import { fisheyeMap } from "./fisheye-map";

function at(map: Uint8ClampedArray, size: number, x: number, y: number): [number, number] {
  const i = (y * size + x) * 4;
  return [map[i], map[i + 1]];
}

describe("fisheye displacement map", () => {
  const size = 64;
  const map = fisheyeMap(size);

  it("leaves the centre and the far corners where they are", () => {
    const [cx, cy] = at(map, size, 32, 32);
    expect(Math.abs(cx - 128)).toBeLessThanOrEqual(2);
    expect(Math.abs(cy - 128)).toBeLessThanOrEqual(2);
    const [kx, ky] = at(map, size, 0, 0);
    expect(Math.abs(kx - 128)).toBeLessThanOrEqual(2);
    expect(Math.abs(ky - 128)).toBeLessThanOrEqual(2);
  });

  it("pulls the middle ring towards the centre (the screen swells)", () => {
    const [rx] = at(map, size, 48, 32); // right of centre: sample from the left
    const [lx] = at(map, size, 16, 32); // left of centre: sample from the right
    const [, by] = at(map, size, 32, 48); // below centre: sample from above
    expect(rx).toBeLessThan(128);
    expect(lx).toBeGreaterThan(128);
    expect(by).toBeLessThan(128);
  });

  it("is symmetric and never clips", () => {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const [ax] = at(map, size, x, y);
        const [bx] = at(map, size, size - 1 - x, y);
        expect(ax + bx).toBeGreaterThanOrEqual(254);
        expect(ax + bx).toBeLessThanOrEqual(256);
        expect(ax).toBeGreaterThan(0);
        expect(ax).toBeLessThan(255);
      }
    }
  });
});
