/* Trending Corner in WebGL (owner, 2026-11-15, D-TRENDING-02): the maths behind the real 3D discs.
 * Pure functions only, so every pose, spring and framing is tested; `components/home/trending-gl.ts`
 * builds the three.js scene and writes these numbers onto it. The carousel's own positions still come
 * from `discPose` in lib/trending-view.ts, so the 3D ring and the DOM fallback stand the discs alike. */

import { COVER_SIZES, type CoverSize } from "@/lib/cover-view";
import { clamp01, discPose, spinBoost } from "@/lib/trending-view";

/**
 * A real CD, in disc radii (1 = 60 mm): the 15 mm hole, clear polycarbonate round it with the raised
 * stacking ring, the silver mirror band where the data layer shows, then the printed picture out to
 * a thin clear rim. 1.2 mm thick.
 */
export const DISC = {
  hole: 7.5 / 60,
  stackInner: 16.6 / 60,
  stackOuter: 18 / 60,
  clearOuter: 19.5 / 60,
  mirrorOuter: 23 / 60,
  printOuter: 59.2 / 60,
  rim: 1,
  thickness: 1.2 / 60,
  /** The raised stacking ring stands this far proud of the face. */
  stackHeight: 0.25 / 60,
} as const;

/** The DOM carousel's disc in px that `discPose`'s numbers are measured against. */
export const POSE_DISC_PX = 280;
/** How far the discs float above their reflection, in disc radii. */
export const FLOAT_GAP = 0.16;

/** One full turn of a disc at rest, and how much faster it turns while its music plays. */
export const SPIN_REST_MS = 16000;
export const SPIN_PLAYING_RATE = 3.2;

export type WorldPose = {
  x: number;
  z: number;
  /** Turn about the upright axis, in radians (positive turns the face to the left). */
  rotY: number;
  scale: number;
  opacity: number;
  shade: number;
  label: number;
};

/**
 * Where a disc `d` steps from the front stands in the 3D room: the same pose as the DOM carousel,
 * converted from px to disc radii (a 280 px disc is 2 radii across).
 */
export function worldPose(d: number, n: number): WorldPose {
  const step = POSE_DISC_PX * 0.84;
  const p = discPose(d, n, step);
  const k = 2 / POSE_DISC_PX;
  return {
    x: p.x * k,
    z: p.z * k,
    rotY: (p.rotateY * Math.PI) / 180,
    scale: p.scale,
    opacity: p.opacity,
    shade: p.shade,
    label: p.label,
  };
}

/**
 * One step of a damped spring toward `target` (semi-implicit Euler, stable for any frame time: long
 * frames are cut into small steps). Returns the new value and velocity.
 */
export function springStep(value: number, velocity: number, target: number, dt: number, stiffness = 170, damping = 22): [number, number] {
  let v = value;
  let vel = velocity;
  let left = Math.min(Math.max(dt, 0), 0.25);
  while (left > 0) {
    const h = Math.min(left, 1 / 120);
    vel += (stiffness * (target - v) - damping * vel) * h;
    v += vel * h;
    left -= h;
  }
  return [v, vel];
}

/** Has a spring come to rest (close enough that no pixel would change)? */
export function springAtRest(value: number, velocity: number, target: number, eps = 1e-4): boolean {
  return Math.abs(target - value) < eps && Math.abs(velocity) < eps * 10;
}

/** How fast a disc turns on its own axis, as a multiple of the rest spin. */
export function spinRate({ boosted, speed, playing }: { boosted: boolean; speed: number; playing: boolean }): number {
  if (boosted) return spinBoost(speed);
  return playing ? SPIN_PLAYING_RATE : 1;
}

/** Radians a disc turns in `dt` seconds at `rate`. */
export function spinAngle(dt: number, rate: number): number {
  return ((Math.PI * 2) / (SPIN_REST_MS / 1000)) * rate * dt;
}

/**
 * The lean the discs take while the ring travels (radians about the upright axis), like cards in a
 * rack pushed by air: grows with the speed in steps per second, never past about 14 degrees.
 */
export function leanFor(speed: number): number {
  const max = 0.24;
  return -max * Math.tanh(speed * 0.18);
}

/**
 * The tilt a pointed-at disc takes toward the pointer. `u`, `v` are the pointer on the disc from -1
 * to 1 (right and up positive). The near edge dips toward the pointer, as if pressed by a finger.
 */
export function tiltToward(u: number, v: number, max = 0.32): { x: number; y: number } {
  const cu = Math.max(-1, Math.min(1, u));
  const cv = Math.max(-1, Math.min(1, v));
  return { x: -cv * max, y: cu * max };
}

/** The four-point twinkle that flares once when a disc is pointed at: 0 to 1 and back over 900 ms. */
export function twinkle(ms: number): number {
  if (ms <= 0 || ms >= 900) return 0;
  const t = ms / 900;
  return t < 0.4 ? easeOut(t / 0.4) : 1 - easeIn((t - 0.4) / 0.6);
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
function easeIn(t: number): number {
  return t * t;
}

export type CameraFrame = {
  /** Camera distance from the front disc, in disc radii. */
  distance: number;
  /** Height the camera looks at, in disc radii (the front disc's centre is at 0). */
  lookY: number;
  /** Disc radii per CSS pixel at the front disc. */
  perPx: number;
  /** The camera's vertical field of view, degrees. */
  fov: number;
};

/**
 * Frame the 3D room so the front disc is drawn exactly as big and as high as the DOM disc would be:
 * `discPx` across, its centre `discCenterPx` from the top of a viewport `heightPx` tall.
 */
export function cameraFrame({ heightPx, discPx, discCenterPx, fov = 26 }: { heightPx: number; discPx: number; discCenterPx: number; fov?: number }): CameraFrame {
  const perPx = 2 / Math.max(discPx, 1);
  const visible = Math.max(heightPx, 1) * perPx;
  const distance = visible / 2 / Math.tan(((fov / 2) * Math.PI) / 180);
  const lookY = -(Math.max(heightPx, 1) / 2 - discCenterPx) * perPx;
  return { distance, lookY, perPx, fov };
}

/** The smallest cover copy that stays sharp for a disc `discPx` across on a `dpr` screen. */
export function coverSizeFor(discPx: number, dpr: number): CoverSize {
  const need = discPx * Math.min(Math.max(dpr, 1), 2);
  return COVER_SIZES.find((s) => s >= 480 && s >= need) ?? COVER_SIZES[COVER_SIZES.length - 1];
}

/** The device pixel ratio the canvas draws at: sharp, but never more than the GPU needs. */
export function canvasDpr(dpr: number, widthPx: number): number {
  const cap = widthPx > 1200 ? 1.5 : 2;
  return Math.min(Math.max(dpr || 1, 1), cap);
}

/** A disc's printed-picture brightness for its shade (0 front, darker further back). */
export function printTone(shade: number): number {
  return 1 - clamp01(shade) * 0.85;
}
