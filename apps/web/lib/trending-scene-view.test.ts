import { describe, expect, it } from "vitest";

import {
  DISC,
  SPIN_PLAYING_RATE,
  cameraFrame,
  canvasDpr,
  coverSizeFor,
  leanFor,
  printTone,
  spinAngle,
  spinRate,
  springAtRest,
  springStep,
  tiltToward,
  twinkle,
  worldPose,
} from "@/lib/trending-scene-view";
import { discPose } from "@/lib/trending-view";

describe("DISC (a real CD in disc radii)", () => {
  it("keeps the rings in order from the hole to the rim", () => {
    const order = [DISC.hole, DISC.stackInner, DISC.stackOuter, DISC.clearOuter, DISC.mirrorOuter, DISC.printOuter, DISC.rim];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(DISC.hole * 120).toBeCloseTo(15, 5);
    expect(DISC.thickness * 60).toBeCloseTo(1.2, 5);
  });
});

describe("worldPose", () => {
  it("stands the front disc in the middle, flat and full size", () => {
    const p = worldPose(0, 5);
    expect(p).toMatchObject({ x: 0, rotY: -0, scale: 1, opacity: 1, shade: 0, label: 1 });
    expect(p.z).toBeCloseTo(0, 6);
  });

  it("is the DOM pose converted to disc radii, so both carousels stand the discs alike", () => {
    const dom = discPose(1, 5, 280 * 0.84);
    const p = worldPose(1, 5);
    expect(p.x).toBeCloseTo((dom.x * 2) / 280, 6);
    expect(p.z).toBeCloseTo((dom.z * 2) / 280, 6);
    expect(p.rotY).toBeCloseTo((dom.rotateY * Math.PI) / 180, 6);
    expect(p.x).toBeGreaterThan(1.5);
    expect(p.z).toBeLessThan(0);
  });

  it("mirrors left and right", () => {
    const l = worldPose(-1.5, 6);
    const r = worldPose(1.5, 6);
    expect(l.x).toBeCloseTo(-r.x, 6);
    expect(l.rotY).toBeCloseTo(-r.rotY, 6);
    expect(l.z).toBeCloseTo(r.z, 6);
  });
});

describe("springStep", () => {
  it("settles on its target from any start, without overshooting much", () => {
    let v = 0;
    let vel = 0;
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      [v, vel] = springStep(v, vel, 1, 1 / 60);
      peak = Math.max(peak, v);
    }
    expect(v).toBeCloseTo(1, 3);
    expect(peak).toBeLessThan(1.1);
    expect(springAtRest(v, vel, 1, 1e-3)).toBe(true);
  });

  it("stays stable on a long frame (a tab coming back)", () => {
    const [v] = springStep(0, 0, 1, 5);
    expect(Number.isFinite(v)).toBe(true);
    expect(Math.abs(v)).toBeLessThan(2);
  });

  it("does nothing with no time", () => {
    expect(springStep(0.3, 0.2, 1, 0)).toEqual([0.3, 0.2]);
  });
});

describe("spin", () => {
  it("turns once in 16 s at rest, faster while playing and fastest while the ring travels", () => {
    expect(spinAngle(16, 1)).toBeCloseTo(Math.PI * 2, 6);
    expect(spinRate({ boosted: false, speed: 0, playing: false })).toBe(1);
    expect(spinRate({ boosted: false, speed: 0, playing: true })).toBe(SPIN_PLAYING_RATE);
    expect(spinRate({ boosted: true, speed: 3, playing: false })).toBeGreaterThan(SPIN_PLAYING_RATE);
  });
});

describe("leanFor", () => {
  it("leans against the travel, never past about 14 degrees", () => {
    expect(leanFor(0)).toBeCloseTo(0, 9);
    expect(leanFor(2)).toBeLessThan(0);
    expect(leanFor(-2)).toBeGreaterThan(0);
    expect(Math.abs(leanFor(1000))).toBeLessThanOrEqual(0.24);
  });
});

describe("tiltToward", () => {
  it("dips the side the pointer is on, and clamps outside the disc", () => {
    expect(tiltToward(1, 0)).toEqual({ x: -0, y: 0.32 });
    expect(tiltToward(0, 1)).toEqual({ x: -0.32, y: 0 });
    expect(tiltToward(5, -5)).toEqual({ x: 0.32, y: 0.32 });
  });
});

describe("twinkle", () => {
  it("flares up and fades out once over 900 ms", () => {
    expect(twinkle(0)).toBe(0);
    expect(twinkle(360)).toBeCloseTo(1, 6);
    expect(twinkle(200)).toBeGreaterThan(0);
    expect(twinkle(700)).toBeGreaterThan(0);
    expect(twinkle(700)).toBeLessThan(1);
    expect(twinkle(900)).toBe(0);
  });
});

describe("cameraFrame", () => {
  it("draws the front disc as big as the DOM disc, at the same height", () => {
    const f = cameraFrame({ heightPx: 440, discPx: 280, discCenterPx: 164, fov: 26 });
    // At the camera's distance the view is 440 px tall, which is 440 * (2 / 280) disc radii.
    const visible = 2 * f.distance * Math.tan((13 * Math.PI) / 180);
    expect(visible).toBeCloseTo((440 * 2) / 280, 6);
    // The disc sits above the middle, so the camera looks below its centre.
    expect(f.lookY).toBeCloseTo(-((220 - 164) * 2) / 280, 6);
  });
});

describe("coverSizeFor and canvasDpr", () => {
  it("takes the smallest sharp cover copy", () => {
    expect(coverSizeFor(200, 2)).toBe(480);
    expect(coverSizeFor(280, 2)).toBe(1200);
    expect(coverSizeFor(280, 1)).toBe(480);
    expect(coverSizeFor(2000, 3)).toBe(1200);
  });

  it("never draws more pixels than the screen has, and fewer on very wide canvases", () => {
    expect(canvasDpr(1, 800)).toBe(1);
    expect(canvasDpr(3, 800)).toBe(2);
    expect(canvasDpr(3, 1400)).toBe(1.5);
    expect(canvasDpr(0, 800)).toBe(1);
  });
});

describe("printTone", () => {
  it("is full brightness in front and darker further back", () => {
    expect(printTone(0)).toBe(1);
    expect(printTone(0.62)).toBeLessThan(0.5);
    expect(printTone(2)).toBeCloseTo(0.15, 6);
  });
});
