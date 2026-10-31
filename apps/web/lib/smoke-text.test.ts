import { describe, expect, it } from "vitest";

import { SmokeField, sampleHomes, wrapBalanced } from "./smoke-text";

const measure = (s: string) => s.length * 10;

/** A fixed sequence instead of Math.random, so the smoke is the same every run. */
function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** A 60 x 20 block of ink, as the words would be. */
function block(): Float32Array {
  const homes: number[] = [];
  for (let y = 20; y < 40; y += 4) for (let x = 20; x < 80; x += 4) homes.push(x, y);
  return Float32Array.from(homes);
}

describe("wrapBalanced", () => {
  it("keeps a short line whole", () => {
    expect(wrapBalanced("Hold the rail", measure, 400)).toEqual(["Hold the rail"]);
    expect(wrapBalanced("   ", measure, 400)).toEqual([]);
  });

  it("splits a long line into even rows, none wider than the limit", () => {
    const rows = wrapBalanced("We ride until the river lights go out tonight", measure, 300);
    expect(rows.join(" ")).toBe("We ride until the river lights go out tonight");
    expect(rows.length).toBe(2);
    for (const row of rows) expect(measure(row)).toBeLessThanOrEqual(300);
    expect(Math.abs(measure(rows[0]) - measure(rows[1]))).toBeLessThanOrEqual(60);
  });

  it("gives a word wider than the limit its own row", () => {
    expect(wrapBalanced("a supercalifragilistic b", measure, 100)).toEqual(["a", "supercalifragilistic", "b"]);
  });
});

describe("sampleHomes", () => {
  it("puts particles only where the words are inked", () => {
    const w = 20;
    const h = 10;
    const rgba = new Uint8ClampedArray(w * h * 4);
    // Ink the left half.
    for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) rgba[(y * w + x) * 4 + 3] = 255;
    const homes = sampleHomes(rgba, w, h, 2, 110, () => 0.5);
    expect(homes.length / 2).toBe(5 * 5);
    for (let i = 0; i < homes.length; i += 2) expect(homes[i]).toBeLessThan(w / 2);
  });
});

describe("SmokeField", () => {
  it("holds the words when nothing stirs it", () => {
    const field = new SmokeField(block(), 100, 60, { random: seeded() });
    for (let i = 0; i < 240; i++) field.step(1, i / 60);
    expect(field.spread()).toBeLessThan(6);
  });

  it("gathers a loose line into the words", () => {
    const field = new SmokeField(block(), 100, 60, { loose: 1, random: seeded() });
    const start = field.spread();
    field.setDissolve(0);
    for (let i = 0; i < 600; i++) field.step(1, i / 60);
    expect(start).toBeGreaterThan(8);
    expect(field.spread()).toBeLessThan(6);
  });

  it("is blown apart along a pointer stroke, swirls on, then settles back", () => {
    const field = new SmokeField(block(), 100, 60, { random: seeded() });
    for (let i = 0; i < 60; i++) field.step(1, i / 60);
    const calm = field.spread();
    field.stir(0, 30, 100, 30, 40);
    expect(field.windAt(50, 30)[0]).toBeGreaterThan(1);
    let most = 0;
    for (let i = 0; i < 40; i++) {
      field.step(1, 1 + i / 60);
      most = Math.max(most, field.spread());
    }
    expect(most).toBeGreaterThan(calm + 5);
    // The wind has died away and the words have come back together.
    for (let i = 0; i < 900; i++) field.step(1, 2 + i / 60);
    expect(Math.abs(field.windAt(50, 30)[0])).toBeLessThan(0.01);
    expect(field.spread()).toBeLessThan(calm + 4);
  });

  it("dissolves into smoke when its line leaves", () => {
    const field = new SmokeField(block(), 100, 60, { random: seeded() });
    for (let i = 0; i < 60; i++) field.step(1, i / 60);
    field.setDissolve(1);
    for (let i = 0; i < 240; i++) field.step(1, 1 + i / 60);
    expect(field.loose).toBeGreaterThan(0.9);
    expect(field.spread()).toBeGreaterThan(20);
  });

  it("never lets a flick blow faster than its limit", () => {
    const field = new SmokeField(block(), 100, 60, { random: seeded() });
    for (let i = 0; i < 20; i++) field.stir(0, 30, 5000, 30, 60);
    const [wx] = field.windAt(50, 30);
    expect(Math.abs(wx)).toBeLessThanOrEqual(26);
  });
});
