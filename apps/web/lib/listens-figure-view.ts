/*
 * Trending Corner's listens in millions (owner, 2026-11-18): the front disc's listens (an album's or
 * EP's total, as the API counts it) stand far back in the 3D room as a very large figure in the song
 * page's style (`components/music/listens-in-millions.tsx`): 753 listens reads 0.000753. When the
 * front changes the figure runs on like a counter: each place rolls forward to its new digit, places
 * to the right turning more. Pure maths only; `components/home/trending-gl.ts` draws it.
 */

import { counterPlaces, inMillions } from "@/lib/millions-view";

/**
 * One character of the figure. `key` says where it stands from the decimal point (`i0` ones, `i1`
 * tens, `p` the point, `f1` tenths...), so a place keeps its key, and rolls, from one figure to the
 * next even when the figures are different lengths.
 */
export type FigureGlyph = { key: string; kind: "digit"; value: number; turns: number } | { key: "p"; kind: "point" };

/** The figure for a listen count, place by place, left to right. */
export function figureGlyphs(listens: number, maxTurns = 2): FigureGlyph[] {
  const text = inMillions(listens);
  const point = text.indexOf(".");
  const whole = point === -1 ? text.length : point;
  return counterPlaces(text, maxTurns).map((place, i) => {
    if (place.kind === "point") return { key: "p", kind: "point" };
    const key = i < whole ? `i${whole - 1 - i}` : `f${i - whole}`;
    return { key, kind: "digit", value: place.value, turns: place.turns };
  });
}

/**
 * Where each glyph's centre stands, left to right, with the whole figure centred on 0. `digit` and
 * `point` are how far each moves the next one along.
 */
export function figureLayout(glyphs: FigureGlyph[], advance: { digit: number; point: number }): { width: number; xs: Record<string, number> } {
  const width = glyphs.reduce((sum, g) => sum + (g.kind === "point" ? advance.point : advance.digit), 0);
  const xs: Record<string, number> = {};
  let x = -width / 2;
  for (const g of glyphs) {
    const w = g.kind === "point" ? advance.point : advance.digit;
    xs[g.key] = x + w / 2;
    x += w;
  }
  return { width, xs };
}

/**
 * Where a place's roll ends: never backwards, like a counter. From `current` (in digits rolled) it
 * goes on to the next `digit`, then `turns` more full turns. A place already showing its digit stays.
 */
export function rollTarget(current: number, digit: number, turns: number): number {
  const now = Math.round(current);
  const at = ((now % 10) + 10) % 10;
  const ahead = (((digit - at) % 10) + 10) % 10;
  if (ahead === 0) return now;
  return now + ahead + Math.max(0, turns) * 10;
}

/** The song page's roll timing (`.lm-strip` in music.css): longer for more turns, left places first. */
export function rollTiming(turns: number, order: number): { delayMs: number; durationMs: number } {
  return { delayMs: 240 + order * 70, durationMs: 1100 + Math.max(0, turns) * 380 };
}

/** The song page's roll curve, cubic-bezier(0.12, 0.8, 0.16, 1): fast away, a long soft landing. */
export function rollEase(t: number): number {
  const k = Math.min(Math.max(t, 0), 1);
  if (k === 0 || k === 1) return k;
  return bezier(0.12, 0.8, 0.16, 1, k);
}

/** A CSS cubic-bezier at time `x`: the curve parameter is found by halving (x rises with it). */
function bezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 30; i++) {
    if (at(x1, x2, t) < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return at(y1, y2, t);
}

/**
 * How big the figure may be: its width scaled down to fit `fit` (the room's width at its depth), never
 * up past its own size.
 */
export function figureFit(width: number, fit: number): number {
  if (!(width > 0) || !(fit > 0)) return 1;
  return Math.min(1, fit / width);
}
