/*
 * The player bar steps aside while you browse (owner, 2026-11-01, D-MOTION-03): it slides down
 * while the page scrolls or the pointer moves, and rises again once things are still. Pure, so it
 * is tested; components/music/player.tsx applies it.
 */

/** How long things must be still before the bar comes back. */
export const DOCK_SETTLE_MS = 1400;
/** A pointer this close to the bottom edge wants the bar: it stays, or comes back at once. */
export const DOCK_REVEAL_PX = 140;
/** Pointer jitter smaller than this is not "moving". */
export const DOCK_MOVE_PX = 4;

export type DockActivity = {
  /** The pointer's height on screen, when the activity was a pointer move. */
  pointerY?: number | null;
  viewportHeight: number;
  /** A control in the bar has keyboard focus, or the pointer is over the bar. */
  engaged: boolean;
};

/** True when this activity should leave the bar up instead of tucking it away. */
export function dockStaysUp({ pointerY, viewportHeight, engaged }: DockActivity): boolean {
  if (engaged) return true;
  return typeof pointerY === "number" && pointerY >= viewportHeight - DOCK_REVEAL_PX;
}

/** Whether a pointer move from `from` to `to` counts as moving, not a tremor. */
export function movedEnough(from: { x: number; y: number } | null, to: { x: number; y: number }): boolean {
  if (!from) return false;
  return Math.abs(to.x - from.x) + Math.abs(to.y - from.y) >= DOCK_MOVE_PX;
}
