/*
 * Intro video timeline: pure maths, so every frame is a function of time alone and the film
 * renders frame-exact (scripts/render-intro-video.mjs) instead of being screen-recorded.
 *
 * Motion follows BRAND_GUIDELINE section 10: things arrive along the logo's depth axis
 * (up-left to down-right), faces fold in, light spills from a corner, the Ember light stays
 * still. The listening room keeps its own lifted rules (OD-32): its backdrop drifts, the light
 * behind the cover breathes and the cover floats, with the exact curves of listen.css.
 */

export const FPS = 30;
export const DURATION_S = 40;
export const WIDTH = 1920;
export const HEIGHT = 1080;

/** Scene boundaries in seconds. */
export const SCENES = {
  hero: [0, 6.4],
  events: [6.4, 13.2],
  handover: [13.2, 15.2],
  room: [15.2, 29.2],
  yours: [29.2, 33.6],
  store: [33.6, 36.8],
  end: [36.8, 40],
} as const satisfies Record<string, readonly [number, number]>;

export type SceneName = keyof typeof SCENES;

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** CSS cubic-bezier as a function of x in [0, 1]. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const e = sx(t) - x;
      const d = dx(t);
      if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    // Bisection fallback keeps steep curves exact.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24 && Math.abs(sx(t) - x) > 1e-5; i += 1) {
      t = (lo + hi) / 2;
      if (sx(t) < x) lo = t;
      else hi = t;
    }
    return sy(t);
  };
}

/** --ease-corner (tokens.css): the brand's arrival curve. */
export const easeCorner = cubicBezier(0.2, 0.7, 0.1, 1);
/** --lr-ease (listen.css): the listening room's curve. */
export const easeRoom = cubicBezier(0.22, 0.8, 0.16, 1);
/** CSS ease-in-out, used by the room's ambient loops. */
export const easeInOut = cubicBezier(0.42, 0, 0.58, 1);

/** 0 before `start`, 1 after `start + dur`, eased in between. */
export function ramp(t: number, start: number, dur: number, ease: (x: number) => number = easeCorner) {
  return ease(clamp((t - start) / dur));
}

/** Rises in at `inAt`, falls out at `outAt` (each over `dur`). */
export function window01(t: number, inAt: number, outAt: number, dur = 0.5, ease = easeCorner) {
  return Math.min(ramp(t, inAt, dur, ease), 1 - ramp(t, outAt, dur, ease));
}

/** An `alternate` CSS keyframe loop: 0 -> 1 -> 0 ..., eased each way. */
export function alternate(t: number, period: number, ease = easeInOut, delay = 0) {
  const p = (t + delay) / period;
  const n = Math.floor(p);
  const f = p - n;
  const k = ease(f < 0 ? f + 1 : f);
  return n % 2 === 0 ? k : 1 - k;
}

/** lr-float: 0 -> -9 px -> 0 over one period, ease-in-out (listen.css). */
export function float(t: number, period: number, amp = 9) {
  const f = (((t / period) % 1) + 1) % 1;
  const half = f < 0.5 ? f * 2 : (1 - f) * 2;
  return -amp * easeInOut(half);
}

/** Arrival offset along the 117 degree depth axis: starts up-left, settles at 0. */
export function depthArrival(k: number, distance = 64) {
  const a = (117 * Math.PI) / 180;
  const d = (1 - k) * distance;
  // The axis runs down-right, so arrival comes from the opposite direction (up-left).
  return { x: Math.sin(a) * -d, y: Math.cos(a) * d };
}

/* ---------- Listening room carousel (listen.css .lr-slot, desktop rules) ---------- */

export type SlotPose = { tx: number; tz: number; ry: number; s: number; o: number; dim: number };

const POSES: Record<number, SlotPose> = {
  0: { tx: 0, tz: 0, ry: 0, s: 1, o: 1, dim: 0 },
  1: { tx: 0.6, tz: -120, ry: -16, s: 0.84, o: 1, dim: 0.3 },
  2: { tx: 1.05, tz: -240, ry: -24, s: 0.7, o: 1, dim: 0.55 },
  3: { tx: 1.4, tz: -340, ry: -28, s: 0.58, o: 0, dim: 0.55 },
};

function poseAt(offset: number): SlotPose {
  const a = Math.min(3, Math.abs(offset));
  const p = POSES[a];
  const sign = offset < 0 ? -1 : 1;
  return { ...p, tx: p.tx * sign, ry: p.ry * sign };
}

/** Pose for a fractional offset (a card mid-turn). */
export function slotPose(offset: number): SlotPose {
  const lo = Math.floor(offset);
  const hi = Math.ceil(offset);
  if (lo === hi) return poseAt(lo);
  const k = offset - lo;
  const a = poseAt(lo);
  const b = poseAt(hi);
  return {
    tx: lerp(a.tx, b.tx, k),
    tz: lerp(a.tz, b.tz, k),
    ry: lerp(a.ry, b.ry, k),
    s: lerp(a.s, b.s, k),
    o: lerp(a.o, b.o, k),
    dim: lerp(a.dim, b.dim, k),
  };
}

/** The room's Next presses, in seconds, and how long each turn takes (--lr-move 640 ms). */
export const ROOM_START_INDEX = 2;
export const ROOM_NEXT_AT = [18.8, 21.6] as const;
export const ROOM_MOVE_S = 0.64;
/** When the front card is chosen and the room opens the focus view. */
export const ROOM_FOCUS_AT = 24.4;
/** When the next cover turns in from the right edge in focus view. */
export const ROOM_PEEK_AT = 26.2;

/** Fractional playing index at time t (each Next turns every card one place). */
export function roomIndex(t: number): number {
  let i = ROOM_START_INDEX;
  for (const at of ROOM_NEXT_AT) i += ramp(t, at, ROOM_MOVE_S, easeRoom);
  return i;
}

/** The track whose title is showing (it changes the moment Next is pressed). */
export function roomPlaying(t: number): number {
  return ROOM_START_INDEX + ROOM_NEXT_AT.filter((at) => t >= at).length;
}

/** When the current title started (for the lr-rise entrance). */
export function roomTitleSince(t: number): number {
  const passed = ROOM_NEXT_AT.filter((at) => t >= at);
  return passed.length ? passed[passed.length - 1] : SCENES.room[0] + 0.5;
}

/** lr-drift (36 s, alternate, ease-in-out per keyframe segment). */
export function drift(t: number, speed = 1.6) {
  const k = alternate(t * speed, 36, (x) => x);
  const seg = k < 0.5 ? easeInOut(k * 2) : easeInOut((k - 0.5) * 2);
  const A = { x: -50, y: -50, r: -5, s: 1.04 };
  const B = { x: -46.5, y: -52.5, r: 3, s: 1.14 };
  const C = { x: -53, y: -47.5, r: -1, s: 1.08 };
  const [p, q] = k < 0.5 ? [A, B] : [B, C];
  return { x: lerp(p.x, q.x, seg), y: lerp(p.y, q.y, seg), r: lerp(p.r, q.r, seg), s: lerp(p.s, q.s, seg) };
}

/** Which scene a time falls in. */
export function sceneAt(t: number): SceneName {
  const names = Object.keys(SCENES) as SceneName[];
  return names.find((n) => t >= SCENES[n][0] && t < SCENES[n][1]) ?? "end";
}

export function frameCount() {
  return Math.round(DURATION_S * FPS);
}
