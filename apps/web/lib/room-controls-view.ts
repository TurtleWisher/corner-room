/*
 * The listening room's lyrics switch and full screen (owner, 2026-11-06 and 2026-11-07, D-ROOM-05).
 * Pure helpers, so the defaults and the "when do we ask the browser" rules are tested.
 */

/** The per-browser key for the listener's lyrics choice ("1" on, "0" off). */
export const LYRICS_PREF = "cr.room.lyrics";

/**
 * Whether the room shows lyrics, from what this browser remembered. Lyrics are on unless the
 * listener turned them off here: a first visit (nothing stored, or storage blocked) is on.
 */
export function lyricsOnFrom(stored: string | null | undefined): boolean {
  return stored !== "0";
}

/** What to remember after the listener sets lyrics on or off. */
export function lyricsChoice(on: boolean): "1" | "0" {
  return on ? "1" : "0";
}

/** What the lyrics switch shows for the playing song. */
export type LyricsSwitch =
  | { kind: "hidden" }
  | { kind: "none"; reason: string }
  | { kind: "ready"; checked: boolean; stateText: string; title: string };

/**
 * The switch for a song: hidden while its lyrics are still loading (so a song that has them never
 * flashes "none"), shown off and disabled with a reason when it has none, otherwise on or off.
 */
export function lyricsSwitch(input: { loaded: boolean; lineCount: number; on: boolean }): LyricsSwitch {
  if (!input.loaded) return { kind: "hidden" };
  if (input.lineCount <= 0) return { kind: "none", reason: "No lyrics for this song yet" };
  return input.on
    ? { kind: "ready", checked: true, stateText: "On", title: "Hide the lyrics round the cover" }
    : { kind: "ready", checked: false, stateText: "Off", title: "Show the lyrics round the cover" };
}

/**
 * Everything in the room that is a control (or part of one). A double-click there is two clicks
 * on that control, never a request for full screen (owner, 2026-11-07).
 */
export const ROOM_CONTROLS =
  'a[href], button, input, select, textarea, label, [role="button"], [role="switch"], [role="slider"], .lr-bar, .lr-focus-console, .lr-lyrics-control';

/**
 * What a double-click (or double-tap) on the room does with real browser full screen (owner,
 * 2026-11-07, D-ROOM-05, like a video site): on empty space it goes in, and the same again comes
 * out. On a control it does nothing. A window the browser made full screen itself (F11) is left to
 * the browser. Leaving full screen also works with the browser's own ✕ at the top or Escape.
 */
export function doubleClickFullscreen(state: {
  supported: boolean;
  onControl: boolean;
  /** document.fullscreenElement is set: full screen this page asked for. */
  pageFullscreen: boolean;
  /** The browser's own full screen (F11), which a page cannot end. */
  browserFullscreen: boolean;
}): "enter" | "exit" | null {
  if (state.onControl || !state.supported) return null;
  if (state.pageFullscreen) return "exit";
  if (state.browserFullscreen) return null;
  return "enter";
}
