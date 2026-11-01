/*
 * The player bar follows the scroll (owner, 2026-11-01, D-MOTION-04, replacing D-MOTION-03's
 * "tuck while busy, return when still"): reading down the page fades and slides it away in step
 * with the distance scrolled, over about its own height; scrolling back up brings it back the same
 * way. When the scroll stops halfway it settles to shown or hidden, whichever is nearer. At the top
 * and near the end of the page it shows. Pure, so it is tested; components/music/player.tsx applies
 * it with one passive scroll listener and one animation frame, writing transform and opacity only.
 */

/** Scroll distance that takes the bar from shown to hidden, as a share of its own height. */
export const DOCK_TRAVEL_SCALE = 1.25;
/** Once the scroll has been still this long, the bar settles to shown or hidden. */
export const DOCK_IDLE_MS = 160;
/** This close to the end of the page, the bar shows again. */
export const DOCK_END_PX = 96;
/** A mouse this close to the bottom edge wants the bar back (pointers that can hover only). */
export const DOCK_REVEAL_PX = 140;

export type DockStep = {
  /** How far the bar has gone, in scroll px: 0 is fully shown, `travel` fully hidden. */
  offset: number;
  /** Scroll change since the last frame; positive is reading down. */
  delta: number;
  travel: number;
  /** At the top of the page, or near its end. */
  atEdge: boolean;
  /** A control in the bar has keyboard focus, or the pointer is over it. */
  engaged: boolean;
};

/** The bar's new offset after a scroll step. */
export function stepDock({ offset, delta, travel, atEdge, engaged }: DockStep): number {
  if (engaged || atEdge || travel <= 0) return 0;
  return Math.min(travel, Math.max(0, offset + delta));
}

/** Where a bar left halfway settles: fully shown or fully hidden, whichever is nearer. */
export function settleDock(offset: number, travel: number): number {
  if (travel <= 0) return 0;
  return offset >= travel / 2 ? travel : 0;
}

/** The scroll distance for the whole fade, from the bar's height. */
export function dockTravel(barHeight: number): number {
  return Math.max(0, Math.round(barHeight * DOCK_TRAVEL_SCALE));
}

/** At the top of the page, near its end, or on a page too short to scroll. */
export function atPageEdge(scrollY: number, viewportHeight: number, pageHeight: number): boolean {
  return scrollY <= 0 || pageHeight - (scrollY + viewportHeight) <= DOCK_END_PX;
}

/** A mouse near the bottom edge of the window asks for the bar. */
export function pointerWantsDock(pointerY: number, viewportHeight: number): boolean {
  return pointerY >= viewportHeight - DOCK_REVEAL_PX;
}

export type DockLook = { y: number; opacity: number; hidden: boolean };

/**
 * How the bar looks at an offset. `distance` is how far down it must move to be out of sight (its
 * height, plus the phone tab bar it sits on). Under reduced motion it only fades, never moves.
 */
export function dockLook(offset: number, travel: number, distance: number, reducedMotion: boolean): DockLook {
  const progress = travel > 0 ? Math.min(1, Math.max(0, offset / travel)) : 0;
  return {
    y: reducedMotion ? 0 : Math.round(progress * distance * 10) / 10,
    opacity: Math.round((1 - progress) * 1000) / 1000,
    hidden: progress >= 1,
  };
}
