/*
 * The logo's 3D tilt under the pointer (owner, 2026-11-07, D-LOGO-01). Pure, so the limits are
 * tested: the logo turns toward the pointer, never more than LOGO_TILT_MAX degrees.
 */

/** The most the logo turns on either axis, in degrees. */
export const LOGO_TILT_MAX = 10;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Rotation for a pointer at (x, y) over a box, as CSS rotateX / rotateY degrees: the side under the
 * pointer dips a little away, as if the finger pressed it (right edge: rotateY positive; top edge:
 * rotateX positive). The middle is flat; outside the box it is held at the limit.
 */
export function logoTilt(p: { x: number; y: number; left: number; top: number; width: number; height: number }): { rx: number; ry: number } {
  if (p.width <= 0 || p.height <= 0) return { rx: 0, ry: 0 };
  const nx = clamp((p.x - p.left) / p.width, 0, 1) * 2 - 1;
  const ny = clamp((p.y - p.top) / p.height, 0, 1) * 2 - 1;
  const round = (n: number) => Math.round(n * 10) / 10 + 0;
  return { rx: round(-ny * LOGO_TILT_MAX * 0.8), ry: round(nx * LOGO_TILT_MAX) };
}

/** Whether a tilt is inside the limits (used by the tests and as a guard). */
export function withinTilt(t: { rx: number; ry: number }): boolean {
  return Math.abs(t.rx) <= LOGO_TILT_MAX && Math.abs(t.ry) <= LOGO_TILT_MAX;
}
