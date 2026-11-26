/*
 * The home page's closing story (owner, 2026-11-26): the parts that explain Corner Room sit at the
 * end of the page, after the music, and move in 3D. Scrolling or the pointer starts every movement
 * (brand section 10, no ambient motion), and since 2026-11-27 each one plays through to its finished
 * frame by itself, so wherever the reader stops, everything on screen is whole and readable.
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

/**
 * Whether a block should be shown (owner, 2026-11-27: an entrance never stops half-way where the
 * reader stops scrolling). It comes in once its top rises above `enter` of the window and then plays
 * through by itself; it goes back only when its top drops below `leave` of the window again (scrolling
 * up, at the bottom edge where it is no longer read). Between the two lines it keeps what it had, so
 * it never flickers on the line. Blocks scrolled up past the top stay shown.
 */
export function shouldShow(top: number, vh: number, shown: boolean, enter = 0.88, leave = 0.97): boolean {
  if (!(vh > 0)) return true;
  if (top < enter * vh) return true;
  if (top > leave * vh) return false;
  return shown;
}

/** The entrance curve: fast away, a long soft landing (like the logo's corner turning). */
export function easeOutExpo(t: number): number {
  const k = clamp01(t);
  return k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
}

/** Smooth both ends, for the prism turning from one face to the next. */
export function easeInOutCubic(t: number): number {
  const k = clamp01(t);
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

/** A value moving from `from` to `to` over `durationMs`, `elapsedMs` after it started (eased). */
export function tween(from: number, to: number, elapsedMs: number, durationMs: number, ease: (t: number) => number = easeOutExpo): number {
  if (!(durationMs > 0) || elapsedMs >= durationMs) return to;
  if (elapsedMs <= 0) return from;
  return from + (to - from) * ease(elapsedMs / durationMs);
}

/** How long an entrance takes: in, and the quicker way back out. */
export const ENTER_MS = 1100;
export const LEAVE_MS = 520;
/** How long the prism takes to turn from one face to the next. */
export const TURN_MS = 1050;

/**
 * The face the prism should show for scene progress `p`: the face whose resting stretch the reader
 * is in, so the prism always turns all the way to a face and never stops between two.
 */
export function faceFor(p: number, n: number): number {
  return frontFace(prismTurn(p, n), n);
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
