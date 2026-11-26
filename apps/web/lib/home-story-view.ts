/*
 * The home page's closing story (owner, 2026-11-26): the parts that explain Corner Room sit at the
 * end of the page, after the music, and move in 3D. Scrolling or the pointer starts every movement
 * (brand section 10, no ambient motion): it follows the scroll both ways, and since 2026-11-27 it
 * finishes by itself when the reader stops, so everything on screen is whole and readable.
 * Pure maths only; components/home/story-motion.tsx writes the results as CSS variables.
 */

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

/** The smooth 0-to-1 step between two edges (GLSL's smoothstep). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * How far through a pinned scene the reader is: 0 when its top meets the top of the window, 1 when
 * its bottom meets the bottom (the sticky stage inside has then been held for `height - vh`).
 */
export function sceneProgress(top: number, height: number, vh: number): number {
  const run = height - vh;
  if (!(run > 0)) return top <= 0 ? 1 : 0;
  return clamp01(-top / run) + 0; // + 0 turns -0 into 0
}

/*
 * Follow, then settle (owner, 2026-11-27): while the reader scrolls, every movement follows the
 * scroll position, forward and back, at the reader's own speed. Once they stop (no scroll for
 * IDLE_MS), whatever is part-way finishes by itself: a block on screen completes to its finished,
 * readable frame, and the prism completes its turn to the next face in the way the reader was going.
 * Scrolling again picks up from wherever things are, with no jump.
 */

/** No scroll for this long counts as stopped. */
export const IDLE_MS = 140;
/** How closely values follow the scroll (higher is tighter), and how they settle once stopped. */
export const FOLLOW_RATE = 14;
export const SETTLE_RATE = 6;
export const TURN_SETTLE_RATE = 3.6;

/**
 * How far a block has come in while scrolling: 0 while its top is still `start` window heights from
 * the top (below the fold), 1 once it has risen `range` window heights more.
 */
export function enterProgress(top: number, vh: number, range = 0.42, start = 0.98): number {
  if (!(vh > 0)) return 1;
  return clamp01((start * vh - top) / (range * vh));
}

/**
 * Where a block settles once the reader stops: finished (1) while any of it shows above the bottom
 * edge of the window, so nothing on screen is left half-arrived; gone (0) only below the fold.
 */
export function settleK(top: number, vh: number, edge = 0.97): number {
  if (!(vh > 0)) return 1;
  return top < edge * vh ? 1 : 0;
}

/**
 * The face the prism settles on once the reader stops: the turn it was in finishes in the way the
 * reader was scrolling (`direction` 1 down, -1 up), and a prism resting on a face stays there.
 */
export function settleFace(turn: number, direction: number, n: number): number {
  if (n < 1) return 0;
  const near = Math.round(turn);
  const face = Math.abs(turn - near) < 0.02 ? near : direction < 0 ? Math.floor(turn) : Math.ceil(turn);
  return Math.min(Math.max(face, 0), n - 1);
}

/**
 * Where to follow once the reader scrolls again after a settle. A settled value (`held`) stays put
 * while the scroll is still catching up with it in the way it is going (a block finished on screen
 * doesn't fold back as the reader scrolls on down; a prism that finished its turn doesn't turn back),
 * and is let go once the scroll passes it or the reader goes the other way, from where it then
 * follows the scroll again (reverses with the reader).
 */
export function followTarget(scrub: number, held: number | null, direction: number): { target: number; held: number | null } {
  if (held === null) return { target: scrub, held: null };
  if (direction > 0 ? scrub < held : direction < 0 ? scrub > held : true) return { target: held, held };
  return { target: scrub, held: null };
}

/**
 * Moves `current` toward `target` by an exponential step over `dt` seconds: smooth to follow, and it
 * lands exactly on the target.
 */
export function glide(current: number, target: number, dt: number, rate: number): number {
  if (!Number.isFinite(current)) return target;
  const k = 1 - Math.exp(-Math.max(dt, 0) * rate);
  const next = current + (target - current) * k;
  return Math.abs(target - next) < 5e-4 ? target : next;
}

/**
 * The prism's turn for scene progress `p` with `n` faces: each face rests in front for a while and
 * the turn between two faces is eased, so the prism settles on every face instead of drifting.
 * Returns a face position: 0 is the first face in front, n - 1 the last.
 */
export function prismTurn(p: number, n: number, rest = 0.42): number {
  if (n < 2) return 0;
  const t = clamp01(p) * (n - 1);
  const i = Math.min(Math.floor(t), n - 2);
  const f = t - i;
  const half = clamp01(rest) / 2;
  return i + smoothstep(half, 1 - half, f);
}

/** The face nearest the front for a turn. */
export function frontFace(turn: number, n: number): number {
  if (n < 1) return 0;
  return Math.min(Math.max(Math.round(turn), 0), n - 1);
}

/** Degrees between faces of an n-sided prism (three faces: 120). */
export function faceStep(n: number): number {
  return n > 0 ? 360 / n : 0;
}

/**
 * How lit a face is, 0 to 1: full facing the reader, dark turned away (the cosine of its angle to
 * the front, so the light falls off the way it does on a real turning block).
 */
export function faceLight(i: number, turn: number, n: number): number {
  const angle = ((i - turn) * faceStep(n) * Math.PI) / 180;
  return clamp01(Math.cos(angle));
}

/**
 * The page scroll position at which face `i` is in front: scene progress i / (n - 1) along the
 * scene's run (`sceneTop` is the scene's top in page coordinates).
 */
export function scrollForFace(i: number, n: number, sceneTop: number, height: number, vh: number): number {
  const run = Math.max(height - vh, 0);
  const p = n > 1 ? Math.min(Math.max(i, 0), n - 1) / (n - 1) : 0;
  return Math.round(sceneTop + p * run);
}

/** The closing door: closed at k = 0, swung open (the given degrees) by k = 1, eased out. */
export function doorAngle(k: number, open = 84): number {
  const t = clamp01(k);
  return open * (1 - (1 - t) * (1 - t) * (1 - t));
}

/**
 * A card's lean toward the pointer: `x` and `y` are the pointer across the card from -1 to 1. The
 * card's far edge tips away from the pointer, at most `max` degrees.
 */
export function leanToward(x: number, y: number, max = 7): { rx: number; ry: number } {
  const cx = Math.max(-1, Math.min(1, Number.isFinite(x) ? x : 0));
  const cy = Math.max(-1, Math.min(1, Number.isFinite(y) ? y : 0));
  return { rx: -cy * max, ry: cx * max };
}
