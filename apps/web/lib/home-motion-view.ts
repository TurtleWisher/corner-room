/*
 * The home page's hover depth (owner, 2026-11-28): cards, tiles, buttons and the trending case lean
 * toward a mouse, lift a little and catch its light; the hero's layers drift apart under it. The
 * maths, kept pure so it is tested; components/home/home-motion.ts writes the results as CSS
 * variables and app/styles/modules/home-motion.css turns them into transform and light.
 */

/** Where the pointer is over a box: x and y from -1 (left, top) to 1 (right, bottom), and the same
 * as percentages for a light. Outside the box it is held at the edge. */
export function pointerIn(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }) {
  const sx = box.width > 0 ? Math.min(1, Math.max(0, (clientX - box.left) / box.width)) : 0.5;
  const sy = box.height > 0 ? Math.min(1, Math.max(0, (clientY - box.top) / box.height)) : 0.5;
  return { x: sx * 2 - 1, y: sy * 2 - 1, mx: Math.round(sx * 100), my: Math.round(sy * 100) };
}

/** The largest lean an element asks for (`data-lean="8"`), in degrees; anything odd falls back, and
 * nothing leans further than MAX_LEAN (brand: subtle, never a spin). */
export const MAX_LEAN = 16;
export function leanDegrees(attr: string | undefined | null, fallback = 6): number {
  const n = attr === undefined || attr === null || attr.trim() === "" ? fallback : Number(attr);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_LEAN, Math.max(0, n));
}

/** The lean for pointer (x, y): the side under the pointer comes toward the reader. Degrees:
 * `turnY` turns about the vertical axis (rotateY), `turnX` about the horizontal (rotateX). */
export function leanFor(x: number, y: number, max: number): { turnX: number; turnY: number } {
  const cx = Math.max(-1, Math.min(1, Number.isFinite(x) ? x : 0));
  const cy = Math.max(-1, Math.min(1, Number.isFinite(y) ? y : 0));
  return { turnX: -cy * max + 0, turnY: cx * max + 0 };
}

/** How fast a lean follows the pointer and how fast it rests again, per second (exponential). */
export const LEAN_RATE = 11;
export const REST_RATE = 6;
