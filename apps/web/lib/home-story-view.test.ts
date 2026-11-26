import { describe, expect, it } from "vitest";

import {
  doorAngle,
  enterProgress,
  faceLight,
  frontFace,
  glide,
  leanToward,
  prismTurn,
  sceneProgress,
  scrollForFace,
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

describe("enterProgress", () => {
  it("is 0 below the fold and 1 once risen", () => {
    expect(enterProgress(1200, 1000)).toBe(0);
    expect(enterProgress(980, 1000)).toBe(0);
    expect(enterProgress(980 - 450, 1000)).toBeCloseTo(1);
    expect(enterProgress(0, 1000)).toBe(1);
  });
  it("shows everything without a window", () => {
    expect(enterProgress(5000, 0)).toBe(1);
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
  it("glides toward the target and lands on it", () => {
    const a = glide(0, 1, 1 / 60);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
    let v = 0;
    for (let i = 0; i < 400; i++) v = glide(v, 1, 1 / 60);
    expect(v).toBe(1);
    expect(glide(Number.NaN, 0.3, 0.016)).toBe(0.3);
  });
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
