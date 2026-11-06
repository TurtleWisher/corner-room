/*
 * The listening room's lyrics switch and full screen (owner, 2026-11-06, D-ROOM-05). Pure helpers,
 * so the defaults and the "when do we ask the browser" rules are tested.
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

/** Keys that never count as the gesture that takes the room into real full screen. */
const NOT_A_GESTURE = new Set(["Escape", "Tab", "Shift", "Control", "Alt", "Meta", "CapsLock", "F11", "ContextMenu"]);

/** Whether a key press is a deliberate action in the room (and so may ask for full screen). */
export function isRoomGestureKey(key: string): boolean {
  return key !== "" && !NOT_A_GESTURE.has(key);
}

/**
 * Whether this gesture should ask the browser for real full screen. Asked at most once per visit
 * to the room, only where the browser offers it, never when the window is already full screen
 * (the browser's own full screen or F11), and never for a gesture that leaves the room (the close
 * button, a link) or one the listener used to type.
 */
export function shouldAskFullscreen(state: {
  asked: boolean;
  supported: boolean;
  alreadyFullscreen: boolean;
  leavesRoom: boolean;
  typing: boolean;
}): boolean {
  return !state.asked && state.supported && !state.alreadyFullscreen && !state.leavesRoom && !state.typing;
}
