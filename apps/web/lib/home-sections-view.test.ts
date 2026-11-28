import { describe, expect, it } from "vitest";

import { ARTIST_POINTS, BLOOM_WHOLE, FACES, LISTEN_STEPS, QUESTIONS, settleTurn, worldProgress, worldStages, worldTurn } from "./home-sections-view";

describe("home copy", () => {
  it("links only to pages that exist", () => {
    const known = new Set(["/events", "/listen", "/store", "/register", "/refunds", "/artists/apply"]);
    for (const face of FACES) expect(known.has(face.href)).toBe(true);
    for (const q of QUESTIONS) if (q.link) expect(known.has(q.link.href)).toBe(true);
  });

  it("states no numbers, prices or guarantees", () => {
    const all = [
      ...FACES.flatMap((f) => [f.title, f.body, ...f.points]),
      ...LISTEN_STEPS.flatMap((s) => [s.title, s.body]),
      ...ARTIST_POINTS.flatMap((s) => [s.title, s.body]),
      ...QUESTIONS.flatMap((q) => [q.q, q.a]),
    ].join(" ");
    expect(all).not.toMatch(/\d/);
    expect(all).not.toMatch(/guarantee|instant|free forever|৳|%/i);
  });

  it("never says teaser", () => {
    const all = JSON.stringify([FACES, LISTEN_STEPS, ARTIST_POINTS, QUESTIONS]);
    expect(all).not.toMatch(/teaser/i);
  });
});

describe("worldProgress", () => {
  const h = 1000;
  it("is Ember until the zone comes up into the window", () => {
    expect(worldProgress(1400, 1600, h)).toBe(0);
    expect(worldProgress(900, 1100, h)).toBe(0);
  });
  it("is Sky once the zone's bottom has risen past the upper third", () => {
    expect(worldProgress(150, 350, h)).toBe(1);
    expect(worldProgress(-900, -700, h)).toBe(1);
  });
  it("moves evenly in between", () => {
    const a = worldProgress(700, 900, h);
    const b = worldProgress(500, 700, h);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(1);
  });
  it("survives a window with no height", () => {
    expect(worldProgress(10, 20, 0)).toBe(0);
  });
});

describe("worldTurn (owner, 2026-11-28)", () => {
  it("starts on Ember, ends on Sky, eased at both ends", () => {
    expect(worldTurn(0)).toBe(0);
    expect(worldTurn(1)).toBe(1);
    expect(worldTurn(0.5)).toBeCloseTo(0.5);
    expect(worldTurn(0.1)).toBeLessThan(0.1);
    expect(worldTurn(0.9)).toBeGreaterThan(0.9);
  });
  it("holds outside the hand-over and ignores nonsense", () => {
    expect(worldTurn(-2)).toBe(0);
    expect(worldTurn(7)).toBe(1);
    expect(worldTurn(Number.NaN)).toBe(0);
  });
});

describe("worldStages (owner, 2026-11-28, D-WORLD-04)", () => {
  it("is plain Ember at the start and plain Sky with its light at the end", () => {
    expect(worldStages(0)).toEqual({ cover: 0, drawing: false, veil: 0, sky: 0 });
    expect(worldStages(1)).toEqual({ cover: 1, drawing: false, veil: 1, sky: 1 });
  });
  it("draws the bloom in between, and the plain night takes over only once it is whole", () => {
    const mid = worldStages(0.4);
    expect(mid.drawing).toBe(true);
    expect(mid.veil).toBe(0);
    expect(mid.cover).toBeCloseTo(0.4 / BLOOM_WHOLE);
    expect(worldStages(BLOOM_WHOLE)).toMatchObject({ cover: 1, drawing: false, veil: 1, sky: 0 });
  });
  it("brings the Sky light up only after the bloom is whole", () => {
    expect(worldStages(BLOOM_WHOLE - 0.01).sky).toBe(0);
    expect(worldStages((BLOOM_WHOLE + 1) / 2).sky).toBeCloseTo(0.5);
    expect(worldStages(Number.NaN)).toEqual(worldStages(0));
  });
});

describe("settleTurn", () => {
  it("finishes a part-way turn in the way the reader was going", () => {
    expect(settleTurn(0.3, 1)).toBe(1);
    expect(settleTurn(0.7, -1)).toBe(0);
  });
  it("leaves a room that is square on alone", () => {
    expect(settleTurn(0, 1)).toBe(0);
    expect(settleTurn(1, -1)).toBe(1);
    expect(settleTurn(0.001, 1)).toBe(0);
    expect(settleTurn(0.9995, -1)).toBe(1);
  });
});
