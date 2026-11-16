/*
 * The line across the top of the window while a page loads (owner, 2026-11-15: page-to-page
 * navigation "premium, easy"). Pure decisions; components/shell/nav-progress.tsx runs them.
 */

/** Does a click on this in-app link open another page? Same page, or only a new #part, does not. */
export function opensAnotherPage(from: string, to: string | null): boolean {
  if (!to) return false;
  const strip = (s: string) => s.split("#")[0].replace(/\/+$/, "") || "/";
  return strip(from) !== strip(to);
}

/**
 * How full the line is after `elapsedMs` of waiting: quick at first, then slower and slower, never
 * reaching the end by itself (it completes only when the new page arrives). 0 to 0.9.
 */
export function trickle(elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 0;
  return 0.9 * (1 - Math.exp(-elapsedMs / 900));
}

/** Longest the line waits for a page before giving up quietly. */
export const NAV_GIVE_UP_MS = 12_000;

/** Pages that bring themselves in (the listening room has its own way in and its own 3D space). */
export function skipsEntrance(pathname: string | null): boolean {
  return Boolean(pathname && /^\/listen\/[^/]+$/.test(pathname));
}
