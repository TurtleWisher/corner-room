import { ApiError } from "@/lib/api";

/*
 * Pure pieces of the persistent player (music.md section 5 states). The API decides access; this
 * only turns its answer into what the player bar says and offers.
 */

export type PlayProblem =
  | { kind: "signed_out" }
  | { kind: "needs_access" }
  | { kind: "taken_down" }
  | { kind: "unavailable"; reason?: string }
  | { kind: "stopped" };

/** Map a failed open or delivery call to a player state. */
export function playProblem(err: unknown): PlayProblem {
  if (err instanceof ApiError) {
    if (err.status === 401) return { kind: "signed_out" };
    if (err.code === "ENTITLEMENT_REQUIRED" || err.status === 403) return { kind: "needs_access" };
    if (err.code === "TRACK_TAKEN_DOWN") return { kind: "taken_down" };
    if (err.code === "TRACK_AUDIO_UNAVAILABLE" || err.status === 404) return { kind: "unavailable" };
  }
  return { kind: "stopped" };
}

/** Copy for each problem (music.md copy section). */
export function problemMessage(p: PlayProblem): string {
  switch (p.kind) {
    case "signed_out":
      return "Sign in to listen.";
    case "needs_access":
      return "Subscription required. Buy this track or choose a plan to play it.";
    case "taken_down":
      return "This track is no longer available.";
    case "unavailable":
      return p.reason ? `Not available to play right now: ${p.reason}.` : "Not available to play right now.";
    case "stopped":
      return "Playback stopped. Try again.";
  }
}

/** "1:05" from seconds; "0:00" for anything unknown. */
export function clock(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Whole milliseconds actually listened, for the playback event (never more than the media length). */
export function listenedMs(currentTime: number, duration: number): number {
  const t = Number.isFinite(currentTime) ? currentTime : 0;
  const d = Number.isFinite(duration) && duration > 0 ? duration : t;
  return Math.max(0, Math.round(Math.min(t, d) * 1000));
}

/** Duration label: "--:--" until the media has reported a real, finite length. */
export function durationLabel(seconds: number | null | undefined): string {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? clock(seconds) : "--:--";
}

/*
 * Up next (owner decision 2026-10-13): playing from a list queues that list, in its order, for
 * this visit only. Nothing is stored; there is no reordering or removing.
 */
export type QueueTrack = { id: string };

/** The queue and position to use when `track` is played, optionally from `list`. */
export function queueFor<T extends QueueTrack>(track: T, list?: readonly T[] | null): { tracks: T[]; index: number } {
  const tracks = list && list.length > 0 ? [...list] : [];
  const index = tracks.findIndex((t) => t.id === track.id);
  if (index >= 0) {
    tracks[index] = { ...tracks[index], ...track };
    return { tracks, index };
  }
  return { tracks: [track], index: 0 };
}

/** The queue position `step` away, or null at either end. */
export function stepIndex(index: number, length: number, step: 1 | -1): number | null {
  const to = index + step;
  return to >= 0 && to < length ? to : null;
}

/**
 * What Previous does (owner, 2026-10-14: "there is no option to go backward"): go back one track
 * whenever there is one; on the first track, restart it.
 */
export function previousAction(index: number): "restart" | "previous" {
  return index > 0 ? "previous" : "restart";
}

/** The browser refused to start audio without a click or key press (autoplay policy). */
export function isAutoplayBlocked(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "NotAllowedError";
}

/** A play() call that was cut short because a newer source replaced it. */
export function isSuperseded(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError";
}

/** Clamp a seek target into the media's length. */
export function seekTarget(seconds: number, duration: number): number | null {
  if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.min(Math.max(0, seconds), duration);
}
