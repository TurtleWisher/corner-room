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

/* Repeat and shuffle (AUDIO Phase 8; owner spec: visible state, predictable queue handling). */
export type RepeatMode = "off" | "all" | "one";

/** The button cycles off -> all -> one -> off. */
export function nextRepeat(mode: RepeatMode): RepeatMode {
  return mode === "off" ? "all" : mode === "all" ? "one" : "off";
}

/** Accessible name for the repeat button, saying the current state. */
export function repeatLabel(mode: RepeatMode): string {
  return mode === "all" ? "Repeat: all tracks" : mode === "one" ? "Repeat: this track" : "Repeat: off";
}

/** The queue position `step` away; with repeat all, the ends wrap round. */
export function stepWithRepeat(index: number, length: number, step: 1 | -1, repeat: RepeatMode): number | null {
  const to = stepIndex(index, length, step);
  if (to !== null || repeat !== "all" || length < 2) return to;
  return step === 1 ? 0 : length - 1;
}

/** What happens when a track plays to its end. */
export function afterEnd(index: number, length: number, repeat: RepeatMode): { kind: "replay" } | { kind: "go"; index: number } | { kind: "stop" } {
  if (repeat === "one") return { kind: "replay" };
  const to = stepWithRepeat(index, length, 1, repeat);
  if (to === null) return { kind: "stop" };
  return to === index ? { kind: "replay" } : { kind: "go", index: to };
}

/**
 * Shuffle reorders the queue itself, so Up next and the room always show what will really play:
 * the current track first, then the others in random order. Turning shuffle off restores the
 * list's own order (the player keeps it). `random` is injectable for tests.
 */
export function shuffled<T>(tracks: readonly T[], current: number, random: () => number = Math.random): T[] {
  const first = tracks[current];
  const rest = tracks.filter((_, i) => i !== current);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first === undefined ? rest : [first, ...rest];
}

/*
 * Codec choice (design 8): the browser says what it can decode; the API sends the best match
 * first plus alternates to fall back to on a decode error, without another permission round-trip.
 */
const CODEC_TESTS: [codec: string, mime: string][] = [
  ["opus", 'audio/ogg; codecs="opus"'],
  ["mp3", "audio/mpeg"],
];

/** Codecs this browser reports it can play, best first. MP3 is always last-resort included. */
export function acceptCodecs(canPlayType: (mime: string) => string): string[] {
  const out = CODEC_TESTS.filter(([, mime]) => {
    try {
      return canPlayType(mime) !== "";
    } catch {
      return false;
    }
  }).map(([codec]) => codec);
  return out.includes("mp3") ? out : [...out, "mp3"];
}

/** "Opus · 160 kbps" for the format line; null when the API did not say (older demo audio). */
export function formatLabel(codec: string | null | undefined, kbps: number | null | undefined): string | null {
  if (!codec) return null;
  const name = codec === "opus" ? "Opus" : codec === "mp3" ? "MP3" : codec.toUpperCase();
  return kbps ? `${name} · ${kbps} kbps` : name;
}

/*
 * Volume levelling (D-AUDIO-08: analyse only, level at play time to about -14 LUFS). The API sends
 * gain_db per track. Turning a loud track down only needs the media element's own volume; turning
 * a quiet track up needs a Web Audio gain stage, used only where the player has one.
 */

/** Linear multiplier for a gain in decibels; 1 when the gain is unknown or levelling is off. */
export function levelMultiplier(gainDb: number | null | undefined, normalise: boolean): number {
  if (!normalise || typeof gainDb !== "number" || !Number.isFinite(gainDb)) return 1;
  return Math.pow(10, gainDb / 20);
}

/**
 * How to apply the listener's volume and the levelling. Without a gain stage everything goes on
 * the audio element (0..1), so quiet songs play at their own level, never louder than the
 * listener's volume. Once the element is routed through a Web Audio gain node, the element stays
 * at 1 and the node carries volume, mute and levelling together (browsers differ on whether the
 * element's own volume still applies after routing, so it is kept neutral).
 */
export function outputLevels(volume: number, muted: boolean, multiplier: number, routed: boolean): { element: number; gain: number } {
  const v = Math.min(1, Math.max(0, volume));
  if (routed) return { element: 1, gain: muted ? 0 : v * multiplier };
  return { element: muted ? 0 : v * Math.min(1, multiplier), gain: 1 };
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
