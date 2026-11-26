import { describe, expect, it } from "vitest";

import {
  doorAngle,
  easeInOutCubic,
  easeOutExpo,
  faceFor,
  faceLight,
  frontFace,
  leanToward,
  prismTurn,
  sceneProgress,
  scrollForFace,
  shouldShow,
  smoothstep,
  tween,
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

describe("shouldShow (owner, 2026-11-27: entrances play through wherever the reader stops)", () => {
  it("comes in once the top rises into the window", () => {
    expect(shouldShow(1200, 1000, false)).toBe(false);
    expect(shouldShow(870, 1000, false)).toBe(true);
    expect(shouldShow(-4000, 1000, false)).toBe(true);
  });
  it("goes back only when it drops out at the bottom edge", () => {
    expect(shouldShow(900, 1000, true)).toBe(true);
    expect(shouldShow(990, 1000, true)).toBe(false);
  });
  it("keeps what it had between the two lines, so it never flickers", () => {
    expect(shouldShow(930, 1000, false)).toBe(false);
    expect(shouldShow(930, 1000, true)).toBe(true);
  });
  it("shows everything without a window", () => {
    expect(shouldShow(5000, 0, false)).toBe(true);
  });
});

describe("tween", () => {
  it("runs from start to end over its time and then rests at the end", () => {
    expect(tween(0, 1, -50, 1000)).toBe(0);
    expect(tween(0, 1, 0, 1000)).toBe(0);
    const mid = tween(0, 1, 500, 1000);
    expect(mid).toBeGreaterThan(0.9); // fast away, long soft landing
    expect(mid).toBeLessThan(1);
    expect(tween(0, 1, 1000, 1000)).toBe(1);
    expect(tween(0.4, 0, 9999, 500)).toBe(0);
  });
  it("turns back from wherever it is", () => {
    expect(tween(0.6, 0, 0, 500)).toBe(0.6);
    expect(tween(0.6, 0, 250, 500)).toBeLessThan(0.6);
  });
  it("eases both curves from 0 to 1", () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(2)).toBe(1);
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
  it("always picks a whole face for the prism to turn to", () => {
    expect(faceFor(0, 3)).toBe(0);
    expect(faceFor(0.2, 3)).toBe(0);
    expect(faceFor(0.3, 3)).toBe(1);
    expect(faceFor(0.5, 3)).toBe(1);
    expect(faceFor(0.8, 3)).toBe(2);
    expect(faceFor(1, 3)).toBe(2);
  });
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
