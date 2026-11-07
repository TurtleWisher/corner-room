/*
 * The Preview Studio editor, as pure maths and words (owner, 2026-11-07, D-TEASER-00 to D-TEASER-03).
 *
 * The editor never changes the master: it only chooses edit settings (start, end, fades, gain), and
 * the server cuts the teaser from the master with exactly those numbers. Every value here is a whole
 * number of milliseconds or hundredths of a dB, so what the artist sees is what gets saved. The
 * server checks everything again; these limits only keep the controls honest.
 */

import type {
  TeaserAction,
  TeaserLimits,
  TeaserReviewStatus,
  TeaserSettings,
  TeaserStatus,
  TeaserVersionRecord,
  TeaserVersionStatus,
} from "@/features/teasers/api";

export type Handle = "start" | "end";

/** Smallest view the artist can zoom into. */
export const MIN_VIEW_MS = 2_000;
/** Arrow keys move a handle by this much; Shift moves a whole second. */
export const FINE_STEP_MS = 10;
export const COARSE_STEP_MS = 1_000;
export const FADE_STEP_MS = 100;
export const GAIN_STEP_CDB = 10;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const whole = (v: number) => Math.round(Number.isFinite(v) ? v : 0);

/** Fades fit the teaser: never past the tool limit, never more than half its length. */
export function maxFadeMs(lengthMs: number, limits: Pick<TeaserLimits, "fade_max_ms">): number {
  const half = Math.floor(Math.max(0, lengthMs) / 2 / FADE_STEP_MS) * FADE_STEP_MS;
  return Math.max(0, Math.min(limits.fade_max_ms, half));
}

/** Keep settings inside the song, the length limits, the fade limits and the gain range. */
export function fitSettings(s: TeaserSettings, masterMs: number, limits: TeaserLimits): TeaserSettings {
  const max = limits.max_ms > 0 ? Math.min(limits.max_ms, masterMs) : masterMs;
  const min = Math.min(limits.min_ms, masterMs);
  let start = clamp(whole(s.start_ms), 0, Math.max(0, masterMs - min));
  let end = clamp(whole(s.end_ms), start + min, masterMs);
  if (end - start > max) end = start + max;
  if (end > masterMs) {
    end = masterMs;
    start = Math.max(0, end - max);
  }
  const fadeMax = maxFadeMs(end - start, limits);
  return {
    start_ms: start,
    end_ms: end,
    fade_in_ms: clamp(whole(s.fade_in_ms), 0, fadeMax),
    fade_out_ms: clamp(whole(s.fade_out_ms), 0, fadeMax),
    gain_cdb: clamp(whole(s.gain_cdb), limits.gain_min_cdb, limits.gain_max_cdb),
  };
}

/**
 * Move one handle. It stops where the teaser would get shorter than allowed; the other handle stays
 * put unless the teaser would get longer than allowed, and then it follows.
 */
export function moveHandle(s: TeaserSettings, handle: Handle, toMs: number, masterMs: number, limits: TeaserLimits): TeaserSettings {
  const max = limits.max_ms > 0 ? Math.min(limits.max_ms, masterMs) : masterMs;
  const min = Math.min(limits.min_ms, masterMs);
  const to = whole(toMs);
  if (handle === "start") {
    const start = clamp(to, 0, Math.max(0, s.end_ms - min));
    const end = s.end_ms - start > max ? start + max : s.end_ms;
    return fitSettings({ ...s, start_ms: start, end_ms: end }, masterMs, limits);
  }
  const end = clamp(to, Math.min(masterMs, s.start_ms + min), masterMs);
  const start = end - s.start_ms > max ? end - max : s.start_ms;
  return fitSettings({ ...s, start_ms: start, end_ms: end }, masterMs, limits);
}

/** Slide the whole selection, keeping its length. */
export function moveRegion(s: TeaserSettings, deltaMs: number, masterMs: number, limits: TeaserLimits): TeaserSettings {
  const length = s.end_ms - s.start_ms;
  const start = clamp(whole(s.start_ms + deltaMs), 0, Math.max(0, masterMs - length));
  return fitSettings({ ...s, start_ms: start, end_ms: start + length }, masterMs, limits);
}

export type View = { fromMs: number; toMs: number };

export function fullView(masterMs: number): View {
  return { fromMs: 0, toMs: Math.max(1, masterMs) };
}

/** Zoom by `factor` (0.5 = closer) around `centerMs`, staying inside the song. */
export function zoomView(view: View, factor: number, centerMs: number, masterMs: number): View {
  const span = view.toMs - view.fromMs;
  const next = clamp(Math.round(span * factor), Math.min(MIN_VIEW_MS, masterMs), Math.max(1, masterMs));
  const ratio = span > 0 ? (centerMs - view.fromMs) / span : 0.5;
  let from = Math.round(centerMs - next * clamp(ratio, 0, 1));
  from = clamp(from, 0, Math.max(0, masterMs - next));
  return { fromMs: from, toMs: from + next };
}

/** Scroll the view sideways by a share of its width. */
export function panView(view: View, share: number, masterMs: number): View {
  const span = view.toMs - view.fromMs;
  const from = clamp(Math.round(view.fromMs + span * share), 0, Math.max(0, masterMs - span));
  return { fromMs: from, toMs: from + span };
}

export function msToX(ms: number, view: View, width: number): number {
  const span = view.toMs - view.fromMs;
  return span > 0 ? ((ms - view.fromMs) / span) * width : 0;
}

export function xToMs(x: number, view: View, width: number): number {
  return width > 0 ? Math.round(view.fromMs + (x / width) * (view.toMs - view.fromMs)) : view.fromMs;
}

/** How far from a line a press still grabs it, in pixels: a finger needs much more room than a mouse. */
export const GRAB_PX = { touch: 24, mouse: 10 } as const;

export type WaveTarget = Handle | "region" | "playhead" | "scrub";

/**
 * What a press on the waveform at `x` takes hold of (D-TEASER-06): the nearest of the start edge,
 * end edge and play line within `grabPx`, else the chosen part (to slide it), else a new play point.
 * An edge wins a tie with the play line. When both edges sit under the finger, the side of the press
 * picks: left of them takes the start, right takes the end.
 */
export function pickTarget(
  x: number,
  /** Where the lines are, in pixels from the left (outside 0..width when zoomed past them); no play line while nothing plays. */
  lines: { start: number; end: number; playhead: number | null },
  grabPx: number,
): WaveTarget {
  const near: { t: Handle | "playhead"; d: number }[] = [];
  near.push({ t: "start", d: Math.abs(x - lines.start) });
  near.push({ t: "end", d: Math.abs(x - lines.end) });
  if (lines.playhead !== null) near.push({ t: "playhead", d: Math.abs(x - lines.playhead) + 0.5 });
  const grabbed = near.filter((n) => n.d <= grabPx).sort((a, b) => a.d - b.d);
  if (grabbed.length > 0) {
    const edges = grabbed.filter((n) => n.t !== "playhead");
    if (edges.length === 2 && Math.abs(lines.end - lines.start) <= grabPx) {
      return x <= (lines.start + lines.end) / 2 ? "start" : "end";
    }
    return grabbed[0].t;
  }
  return x > lines.start && x < lines.end ? "region" : "scrub";
}

/** The peaks inside the view, one bar per pixel column (max of the buckets it covers). */
export function barsFor(points: readonly number[], bucketMs: number, view: View, columns: number): number[] {
  if (columns <= 0 || bucketMs <= 0 || points.length === 0) return [];
  const out: number[] = [];
  const span = view.toMs - view.fromMs;
  for (let c = 0; c < columns; c += 1) {
    const a = Math.floor((view.fromMs + (c / columns) * span) / bucketMs);
    const b = Math.max(a + 1, Math.ceil((view.fromMs + ((c + 1) / columns) * span) / bucketMs));
    let peak = 0;
    for (let i = a; i < b && i < points.length; i += 1) if (points[i] > peak) peak = points[i];
    out.push(peak);
  }
  return out;
}

/** "1:05.250" from milliseconds. */
export function formatTime(ms: number): string {
  const v = Math.max(0, whole(ms));
  const m = Math.floor(v / 60_000);
  const s = Math.floor((v % 60_000) / 1000);
  const r = v % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(r).padStart(3, "0")}`;
}

/** "45.0 s" for a length. */
export function formatLength(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

/** Read "1:05.25", "65.25", "1:05" or "65" as milliseconds; null if it isn't a time. */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(",", ".");
  const match = /^(?:(\d+):)?(\d+)(?:\.(\d{1,3}))?$/.exec(t);
  if (!match) return null;
  const minutes = match[1] ? Number(match[1]) : 0;
  const seconds = Number(match[2]);
  if (match[1] && seconds >= 60) return null;
  const fraction = match[3] ? Number(match[3].padEnd(3, "0")) : 0;
  return minutes * 60_000 + seconds * 1000 + fraction;
}

/** "-3.5 dB", "+1.0 dB", "0 dB". */
export function formatGain(cdb: number): string {
  if (!cdb) return "0 dB";
  return `${cdb > 0 ? "+" : "−"}${(Math.abs(cdb) / 100).toFixed(1)} dB`;
}

/** Linear gain multiplier for the preview (the server applies the same dB). */
export function gainMultiplier(cdb: number): number {
  return Math.pow(10, cdb / 100 / 20);
}

/**
 * The volume at a moment of the teaser, 0 to 1 before gain: linear fades, as FFmpeg's default
 * `afade` curve, so the preview sounds like the finished teaser.
 */
export function fadeLevel(atMs: number, s: TeaserSettings): number {
  const length = s.end_ms - s.start_ms;
  const t = atMs - s.start_ms;
  if (t <= 0 || length <= 0) return s.fade_in_ms > 0 ? 0 : 1;
  if (t >= length) return s.fade_out_ms > 0 ? 0 : 1;
  let level = 1;
  if (s.fade_in_ms > 0 && t < s.fade_in_ms) level = Math.min(level, t / s.fade_in_ms);
  const toEnd = length - t;
  if (s.fade_out_ms > 0 && toEnd < s.fade_out_ms) level = Math.min(level, toEnd / s.fade_out_ms);
  return clamp(level, 0, 1);
}

export function sameSettings(a: TeaserSettings | null, b: TeaserSettings | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.start_ms === b.start_ms &&
    a.end_ms === b.end_ms &&
    a.fade_in_ms === b.fade_in_ms &&
    a.fade_out_ms === b.fade_out_ms &&
    a.gain_cdb === b.gain_cdb
  );
}

export function settingsOf(v: Pick<TeaserVersionRecord, keyof TeaserSettings>): TeaserSettings {
  return { start_ms: v.start_ms, end_ms: v.end_ms, fade_in_ms: v.fade_in_ms, fade_out_ms: v.fade_out_ms, gain_cdb: v.gain_cdb };
}

// --- undo / redo ------------------------------------------------------------------------------------

export type History = { past: TeaserSettings[]; present: TeaserSettings; future: TeaserSettings[] };

const HISTORY_LIMIT = 100;

export function startHistory(s: TeaserSettings): History {
  return { past: [], present: s, future: [] };
}

/** Record a change; the same settings again are not a new step. */
export function record(h: History, next: TeaserSettings): History {
  if (sameSettings(h.present, next)) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

/** Replace the present without a new undo step (a drag in progress). */
export function replacePresent(h: History, next: TeaserSettings): History {
  return { ...h, present: next };
}

export function undo(h: History): History {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

// --- words ------------------------------------------------------------------------------------------

export const TEASER_STATUS_LABEL: Record<TeaserStatus, string> = {
  DRAFT: "Not public",
  IN_REVIEW: "Waiting for Corner Room",
  PUBLISHED: "Live for everyone",
  UNPUBLISHED: "Taken off",
};

export const VERSION_STATUS_LABEL: Record<TeaserVersionStatus, string> = {
  DRAFT: "Settings saved",
  PROCESSING: "Being made",
  READY: "Made",
  FAILED: "Couldn't be made",
};

export const REVIEW_STATUS_LABEL: Record<TeaserReviewStatus, string> = {
  WAITING: "Waiting for review",
  APPROVED: "Approved",
  RETURNED: "Sent back",
  WITHDRAWN: "Taken back",
};

export const ACTION_LABEL: Record<TeaserAction, string> = {
  process: "Make the teaser",
  submit: "Send for review",
  withdraw: "Take back from review",
  unpublish: "Take off",
  republish: "Put back up",
  delete: "Delete",
};

/** One line about a version, in words. */
export function versionLine(v: Pick<TeaserVersionRecord, "status" | "review_status" | "is_live" | "number">): string {
  const parts = [`Version ${v.number}`];
  if (v.is_live) parts.push("live now");
  else if (v.review_status) parts.push(REVIEW_STATUS_LABEL[v.review_status].toLowerCase());
  else parts.push(VERSION_STATUS_LABEL[v.status].toLowerCase());
  return parts.join(" · ");
}

const PROBLEM_WORDS: Record<string, string> = {
  START_BEFORE_SONG: "The start is before the song begins.",
  END_AFTER_SONG: "The end is after the song finishes.",
  END_BEFORE_START: "The end must come after the start.",
  TOO_SHORT: "The teaser is too short.",
  TOO_LONG: "The teaser is too long.",
  FADE_TOO_LONG: "A fade is longer than allowed.",
  GAIN_OUT_OF_RANGE: "The volume change is out of range.",
};

/** Turn the API's problem codes (`TOO_LONG,FADE_TOO_LONG`) into sentences. */
export function problemWords(detail: string | null | undefined): string[] {
  if (!detail) return [];
  return detail
    .split(",")
    .map((code) => PROBLEM_WORDS[code.trim()])
    .filter((w): w is string => Boolean(w));
}

export const FAILURE_WORDS: Record<string, string> = {
  TEASER_FAILED: "The teaser couldn't be cut from the master.",
  TEASER_VERIFY_FAILED: "The made teaser didn't match its settings.",
  TOOL_TIMEOUT: "Making it took too long.",
  TOOL_MISSING: "The audio tool isn't available right now.",
  CANCELLED: "Corner Room stopped making it.",
};

export function failureWords(code: string | null | undefined): string {
  return (code && FAILURE_WORDS[code]) || "Something went wrong while making it.";
}

/** The limits in words, for the hint under the editor. */
export function limitsLine(limits: TeaserLimits): string {
  return `Between ${Math.round(limits.min_ms / 1000)} and ${Math.round(limits.max_ms / 1000)} seconds. Fades up to ${Math.round(
    limits.fade_max_ms / 1000,
  )} seconds each.`;
}
