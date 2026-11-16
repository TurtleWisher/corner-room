/*
 * Keyboard shortcuts for the player bar (owner, 2026-11-15: "tools more handy"). Pure, so the rule
 * for when a key belongs to the player is tested: never while typing, never on a control that uses
 * the key itself, never with a modifier, and never on pages that use the same keys for their own
 * work (the listening room, staff lyric timing, the Preview Studio editor).
 */

export type BarKeyAction = "toggle" | "back" | "forward" | "mute" | "next" | "previous";

/** Seconds one arrow press moves, the same step as the bar's scrubber. */
export const KEY_SEEK_SECONDS = 5;

export type KeyTarget = { tag: string; role?: string | null; editable?: boolean };

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);
/** Controls that act on Space or the arrows themselves. */
const OWN_KEYS = new Set(["BUTTON", "A", "SUMMARY", "VIDEO", "AUDIO"]);
const OWN_ROLES = new Set(["slider", "tab", "switch", "menuitem", "option", "textbox", "button", "radio", "checkbox", "combobox", "listbox"]);

/** Pages that use Space or the arrows for their own work. */
export function pageKeepsKeys(pathname: string | null): boolean {
  if (!pathname) return false;
  return /^\/listen\/[^/]+$/.test(pathname) || pathname.startsWith("/staff/catalog/lyrics-timing") || /^\/studio\/releases\/[^/]+\/(previews|teasers)\/[^/]+$/.test(pathname);
}

export function barKeyAction(
  key: string,
  mods: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean },
  target: KeyTarget | null,
  pathname: string | null,
): BarKeyAction | null {
  if (mods.ctrl || mods.meta || mods.alt) return null;
  if (pageKeepsKeys(pathname)) return null;
  if (target) {
    if (target.editable || TYPING.has(target.tag)) return null;
    if (OWN_KEYS.has(target.tag) || (target.role && OWN_ROLES.has(target.role))) return null;
  }
  if (mods.shift) {
    if (key === "N" || key === "n") return "next";
    if (key === "P" || key === "p") return "previous";
    return null;
  }
  switch (key) {
    case " ":
    case "k":
    case "K":
      return "toggle";
    case "ArrowLeft":
      return "back";
    case "ArrowRight":
      return "forward";
    case "m":
    case "M":
      return "mute";
    default:
      return null;
  }
}

/** Share of the song played, 0 to 1, for the line on the bar's top edge. */
export function playedShare(position: number, duration: number): number {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(1, Math.max(0, position / duration));
}

/** The songs after the current one, with their place in the queue. */
export function upNext<T>(queue: readonly T[], index: number): { item: T; at: number }[] {
  if (index < 0) return [];
  return queue.slice(index + 1).map((item, i) => ({ item, at: index + 1 + i }));
}
