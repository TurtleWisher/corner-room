import { describe, expect, it } from "vitest";

import { INTRO_COPY, INTRO_TRACKS } from "./copy";
import {
  cubicBezier,
  depthArrival,
  DURATION_S,
  frameCount,
  ramp,
  ROOM_FOCUS_AT,
  ROOM_NEXT_AT,
  ROOM_START_INDEX,
  roomIndex,
  roomPlaying,
  SCENES,
  sceneAt,
  slotPose,
} from "./timeline";

describe("intro video timeline", () => {
  it("runs 40 s at 30 fps with scenes that tile the film without gaps", () => {
    expect(DURATION_S).toBe(40);
    expect(frameCount()).toBe(1200);
    const spans = Object.values(SCENES);
    expect(spans[0][0]).toBe(0);
    expect(spans.at(-1)?.[1]).toBe(DURATION_S);
    for (let i = 1; i < spans.length; i += 1) expect(spans[i][0]).toBe(spans[i - 1][1]);
  });

  it("gives the listening room the longest scene", () => {
    const len = (n: keyof typeof SCENES) => SCENES[n][1] - SCENES[n][0];
    const others = (Object.keys(SCENES) as (keyof typeof SCENES)[]).filter((n) => n !== "room");
    for (const n of others) expect(len("room")).toBeGreaterThan(len(n));
    expect(sceneAt(20)).toBe("room");
  });

  it("matches the brand curves at their ends", () => {
    const ease = cubicBezier(0.2, 0.7, 0.1, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeGreaterThan(0.5);
    expect(ramp(5, 6, 1)).toBe(0);
    expect(ramp(8, 6, 1)).toBe(1);
  });

  it("arrives from up-left along the 117 degree depth axis", () => {
    const start = depthArrival(0, 100);
    expect(start.x).toBeLessThan(0);
    expect(start.y).toBeLessThan(0);
    const end = depthArrival(1, 100);
    expect(Math.abs(end.x) + Math.abs(end.y)).toBeCloseTo(0);
  });

  it("uses the carousel poses of listen.css", () => {
    expect(slotPose(0)).toMatchObject({ tx: 0, tz: 0, ry: 0, s: 1, dim: 0 });
    expect(slotPose(-1)).toMatchObject({ tx: -0.6, tz: -120, ry: 16, s: 0.84 });
    expect(slotPose(2)).toMatchObject({ tx: 1.05, tz: -240, ry: -24, s: 0.7 });
    expect(slotPose(0.5).tx).toBeCloseTo(0.3);
  });

  it("turns the carousel one card per Next and stays inside the queue", () => {
    expect(roomIndex(SCENES.room[0])).toBe(ROOM_START_INDEX);
    expect(roomIndex(ROOM_FOCUS_AT)).toBeCloseTo(ROOM_START_INDEX + ROOM_NEXT_AT.length);
    expect(roomPlaying(ROOM_FOCUS_AT) + 1).toBeLessThan(INTRO_TRACKS.length);
  });

  it("only uses copy that names the page it came from", () => {
    const walk = (v: unknown): { text: string; source: string }[] =>
      v && typeof v === "object" && "text" in v ? [v as { text: string; source: string }] : Object.values(v as object).flatMap(walk);
    const items = walk(INTRO_COPY);
    expect(items.length).toBeGreaterThan(15);
    for (const item of items) expect(item.source.startsWith("/")).toBe(true);
  });
});
