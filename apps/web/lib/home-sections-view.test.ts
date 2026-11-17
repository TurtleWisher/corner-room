import { describe, expect, it } from "vitest";

import { ARTIST_POINTS, FACES, LISTEN_STEPS, QUESTIONS, worldLayers, worldProgress } from "./home-sections-view";

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

describe("worldLayers", () => {
  it("brings the dark in first and the Sky light only after it", () => {
    expect(worldLayers(0)).toEqual({ veil: 0, sky: 0 });
    expect(worldLayers(0.25)).toEqual({ veil: 0.5, sky: 0 });
    expect(worldLayers(0.5)).toEqual({ veil: 1, sky: 0 });
    expect(worldLayers(0.75)).toEqual({ veil: 1, sky: 0.5 });
    expect(worldLayers(1)).toEqual({ veil: 1, sky: 1 });
  });
  it("stays inside its range", () => {
    expect(worldLayers(-3)).toEqual({ veil: 0, sky: 0 });
    expect(worldLayers(9)).toEqual({ veil: 1, sky: 1 });
  });
});
