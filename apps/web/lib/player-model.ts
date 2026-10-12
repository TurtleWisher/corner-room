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
