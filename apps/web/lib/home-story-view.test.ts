import { describe, expect, it } from "vitest";

import {
  doorAngle,
  enterProgress,
  followTarget,
  faceLight,
  frontFace,
  glide,
  leanToward,
  prismTurn,
  sceneProgress,
  scrollForFace,
  settleFace,
  settleK,
  smoothstep,
} from "./home-story-view";

describe("sceneProgress", () => {
  it("runs from 0 at the top to 1 when the scene's end reaches the window's end", () => {
    expect(sceneProgress(100, 3000, 1000)).toBe(0);
    expect(sceneProgress(0, 3000, 1000)).toBe(0);
    expect(sceneProgress(-1000, 3000, 1000)).toBe(0.5);
    expect(sceneProgress(-2000, 3000, 1000)).toBe(1);
    expect(sceneProgress(-9000, 3000, 1000)).toBe(1);
  });
  it("is a step when the scene is no taller than the window", () => {
    expect(sceneProgress(10, 800, 1000)).toBe(0);
    expect(sceneProgress(-10, 800, 1000)).toBe(1);
  });
});

describe("following the scroll (owner, 2026-11-27)", () => {
  it("comes in with the scroll and goes back with it", () => {
    expect(enterProgress(1200, 1000)).toBe(0);
    expect(enterProgress(980, 1000)).toBe(0);
    const half = enterProgress(980 - 210, 1000);
    expect(half).toBeCloseTo(0.5);
    expect(enterProgress(0, 1000)).toBe(1);
    expect(enterProgress(5000, 0)).toBe(1);
  });
  it("glides toward where the scroll puts it and lands exactly", () => {
    const a = glide(0, 1, 1 / 60, 14);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
    let v = 0;
    for (let i = 0; i < 300; i++) v = glide(v, 1, 1 / 60, 5);
    expect(v).toBe(1);
    expect(glide(Number.NaN, 0.3, 0.016, 5)).toBe(0.3);
  });
});

describe("settling once the reader stops", () => {
  it("finishes any block that shows on screen, and only empties those below the fold", () => {
    expect(settleK(900, 1000)).toBe(1);
    expect(settleK(-3000, 1000)).toBe(1);
    expect(settleK(990, 1000)).toBe(0);
    expect(settleK(10, 0)).toBe(1);
  });
  it("keeps what settled until the scroll catches up, and reverses when the reader goes back", () => {
    // A block finished on screen does not fold back while scrolling on down.
    expect(followTarget(0.6, 1, 1)).toEqual({ target: 1, held: 1 });
    // Scrolling up from there follows the scroll back.
    expect(followTarget(0.6, 1, -1)).toEqual({ target: 0.6, held: null });
    // The prism finished its turn to face 1; scrolling on down holds it until the scroll gets there.
    expect(followTarget(0.4, 1, 1)).toEqual({ target: 1, held: 1 });
    expect(followTarget(1.2, 1, 1)).toEqual({ target: 1.2, held: null });
    // Nothing held: just follow.
    expect(followTarget(0.3, null, 1)).toEqual({ target: 0.3, held: null });
  });
  it("finishes the prism's turn in the way the reader was scrolling", () => {
    expect(settleFace(0.3, 1, 3)).toBe(1);
    expect(settleFace(0.3, -1, 3)).toBe(0);
    expect(settleFace(1.7, -1, 3)).toBe(1);
    expect(settleFace(1.7, 1, 3)).toBe(2);
    expect(settleFace(1.01, 1, 3)).toBe(1);
    expect(settleFace(2, 1, 3)).toBe(2);
    expect(settleFace(-0.4, -1, 3)).toBe(0);
  });
});

describe("prismTurn", () => {
  it("rests on each face and turns between them", () => {
    expect(prismTurn(0, 3)).toBe(0);
    expect(prismTurn(0.05, 3)).toBe(0);
    expect(prismTurn(0.25, 3)).toBeCloseTo(0.5);
    expect(prismTurn(0.5, 3)).toBe(1);
    expect(prismTurn(0.95, 3)).toBe(2);
    expect(prismTurn(1, 3)).toBe(2);
  });
  it("never goes backwards as the reader scrolls on", () => {
    let last = -1;
    for (let p = 0; p <= 1; p += 0.01) {
      const t = prismTurn(p, 3);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });
  it("stays on the one face there is", () => {
    expect(prismTurn(0.7, 1)).toBe(0);
  });
});

describe("faces", () => {
  it("lights the face in front and darkens the others", () => {
    expect(faceLight(0, 0, 3)).toBeCloseTo(1);
    expect(faceLight(1, 0, 3)).toBe(0);
    expect(faceLight(1, 0.5, 3)).toBeCloseTo(Math.cos(Math.PI / 3));
    expect(frontFace(1.4, 3)).toBe(1);
    expect(frontFace(9, 3)).toBe(2);
  });
  it("finds the scroll position that brings a face to the front", () => {
    expect(scrollForFace(0, 3, 5000, 3000, 1000)).toBe(5000);
    expect(scrollForFace(1, 3, 5000, 3000, 1000)).toBe(6000);
    expect(scrollForFace(2, 3, 5000, 3000, 1000)).toBe(7000);
  });
});

describe("motion helpers", () => {
  it("opens the door fully and never past it", () => {
    expect(doorAngle(0)).toBe(0);
    expect(doorAngle(1)).toBe(84);
    expect(doorAngle(4)).toBe(84);
    expect(doorAngle(0.5)).toBeGreaterThan(42);
  });
  it("leans within the limit", () => {
    expect(leanToward(1, 0)).toEqual({ rx: -0, ry: 7 });
    expect(leanToward(0, 5, 6).rx).toBe(-6);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
  });
});
