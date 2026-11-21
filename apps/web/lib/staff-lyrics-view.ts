/*
 * Staff lyrics sync (owner, 2026-11-21, D-LYRICS-04): find a released song, fix its words and time
 * them on one page. Pure helpers; the server cleans and checks everything again.
 */

import type { LyricSong } from "@/features/studio/api";
import { lyricLines } from "@/lib/lyrics-view";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A song id inside a pasted song page address (or the id itself), else null. */
export function songIdIn(text: string): string | null {
  return text.match(UUID)?.[0]?.toLowerCase() ?? null;
}

/** The words as the server keeps them (`clean_lyrics`): Unix newlines, no trailing spaces, at most
 * one empty line between verses, nothing at the ends. Empty means no lyrics. */
export function tidyLyrics(text: string | null | undefined): string | null {
  const out = (text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
  return out.trim() ? out : null;
}

/** True when the draft would change what listeners read. */
export function wordsChanged(draft: string, live: string | null | undefined): boolean {
  return tidyLyrics(draft) !== tidyLyrics(live);
}

/**
 * The taps still right after the words change. Same number of sung lines: every time stays (a
 * spelling or spacing fix). A line added or taken away: times stay for the lines before the first
 * one that differs, and tapping carries on from there.
 */
export function carryTimes(before: readonly string[], after: readonly string[], times: readonly number[]): number[] {
  if (before.length === after.length) return times.slice(0, after.length);
  let same = 0;
  while (same < before.length && same < after.length && before[same] === after[same]) same += 1;
  return times.slice(0, Math.min(same, times.length));
}

export type SongMark = { label: string; tone: "ok" | "todo" | "wait" | "none" };

/** One short state for a song in the search list. A song synced before line ends existed
 * (D-LYRICS-05) still needs its ends. */
export function songMark(song: Pick<LyricSong, "lines" | "timed" | "lyrics_waiting"> & { line_ends?: boolean }): SongMark {
  if (song.lyrics_waiting) return { label: "Change waiting", tone: "wait" };
  if (song.lines === 0) return { label: "No lyrics", tone: "none" };
  if (song.timed && song.line_ends === false) return { label: "Needs line ends", tone: "todo" };
  if (song.timed) return { label: "Synced", tone: "ok" };
  return { label: "Not synced", tone: "todo" };
}

/*
 * Line ends (owner, 2026-11-21, D-LYRICS-05). Staff hold the tap key while a line is sung: pressing
 * starts the line, letting go ends it. A quick tap instead leaves the line open, and it ends when
 * the next line starts (one more tap after the last line ends the song's last line). `ends` is
 * always as long as `times`, or one shorter while the last tapped line is still open.
 */
export type Taps = { times: number[]; ends: number[] };

/** Shorter than this a press is a tap, not a hold: the line stays open until the next press. */
export const HOLD_MS = 220;

/** The last tapped line has no end yet. */
export function isOpen(t: Taps): boolean {
  return t.ends.length < t.times.length;
}

/** The ends a song loaded with start times only gets: each line until the next one starts, the
 * last one open for one more tap. Kept ends are used as they are. */
export function loadTaps(times: readonly number[] | null, ends: readonly number[] | null): Taps {
  const t = [...(times ?? [])];
  if (ends && ends.length === t.length) return { times: t, ends: [...ends] };
  return { times: t, ends: t.slice(1) };
}

/** A press of the tap key: ends the open line here, then starts the next untimed line (never
 * before the line before it ended). */
export function pressTap(t: Taps, atMs: number, lineCount: number): Taps {
  const at = Math.round(Math.max(0, atMs));
  const ends = [...t.ends];
  if (isOpen(t)) ends.push(Math.max(t.times[t.times.length - 1] + 1, at));
  if (t.times.length >= lineCount) return { times: [...t.times], ends };
  const floor = Math.max(t.times[t.times.length - 1] ?? 0, ends[ends.length - 1] ?? 0);
  return { times: [...t.times, Math.max(floor, at)], ends };
}

/** Letting go: a hold ends the line it started; a quick tap leaves it open. */
export function releaseTap(t: Taps, pressedAtMs: number, atMs: number): Taps {
  if (!isOpen(t) || atMs - pressedAtMs < HOLD_MS) return t;
  const start = t.times[t.times.length - 1];
  return { times: t.times, ends: [...t.ends, Math.max(start + 1, Math.round(atMs))] };
}

/** Taps can be pressed now: a line still to start, or the last one still to end. */
export function canPress(t: Taps, lineCount: number): boolean {
  return lineCount > 0 && (t.times.length < lineCount || isOpen(t));
}

/** Every line has its start and its end. */
export function tapsDone(t: Taps, lineCount: number): boolean {
  return lineCount > 0 && t.times.length === lineCount && t.ends.length === lineCount;
}

/** Back to before line `i` (a retake, or undo of the last line). */
export function tapsBefore(t: Taps, i: number): Taps {
  const n = Math.max(0, i);
  return { times: t.times.slice(0, n), ends: t.ends.slice(0, n) };
}

/** Every start and end moved by `deltaMs`, never before the song starts and never ending at or
 * before its own start. */
export function shiftTaps(t: Taps, deltaMs: number): Taps {
  const times = t.times.map((v) => Math.max(0, Math.round(v + deltaMs)));
  return { times, ends: t.ends.map((v, i) => Math.max(times[i] + 1, Math.round(v + deltaMs))) };
}

/** Where each line is sung along the song, 0 to 1 (`to` null while it is still open). */
export function tapSpans(t: Taps, durationS: number): { from: number; to: number | null }[] {
  if (!(durationS > 0)) return [];
  const at = (ms: number) => Math.min(1, Math.max(0, ms / 1000 / durationS));
  return t.times.map((s, i) => ({ from: at(s), to: t.ends[i] === undefined ? null : at(t.ends[i]) }));
}

/** "Artist · Release" under a song's title, skipping what is unknown or the same as the title. */
export function songContext(song: Pick<LyricSong, "title" | "profile_name" | "release_title">): string {
  const parts = [song.profile_name, song.release_title && song.release_title !== song.title ? song.release_title : null];
  return parts.filter(Boolean).join(" · ");
}

export type SaveAction = { label: string; words: boolean; times: boolean } | null;

/**
 * What the one Save button does now. Words changed: save them, with the times when every line of
 * the new words is timed ("Send for approval" when the person waits for it). Only times changed:
 * save the times once every line has one.
 */
export function saveAction(o: {
  draft: string;
  live: string | null;
  times: readonly number[];
  stored: readonly number[] | null;
  approvesAtOnce: boolean;
  /** D-LYRICS-05: each line's end; every line needs one before the times are saved. */
  ends?: readonly number[];
  storedEnds?: readonly number[] | null;
}): SaveAction {
  const lines = lyricLines(tidyLyrics(o.draft));
  const allTimed = lines.length > 0 && o.times.length === lines.length && (o.ends === undefined || o.ends.length === lines.length);
  if (wordsChanged(o.draft, o.live)) {
    if (!o.approvesAtOnce) return { label: "Send words for approval", words: true, times: false };
    return { label: allTimed ? "Save words and timings" : "Save words", words: true, times: allTimed };
  }
  const timesChanged =
    JSON.stringify(o.times) !== JSON.stringify(o.stored ?? []) ||
    (o.ends !== undefined && JSON.stringify(o.ends) !== JSON.stringify(o.storedEnds ?? []));
  if (allTimed && timesChanged) return { label: "Save timings", words: false, times: true };
  return null;
}

/** The words someone typed into the song finder; nothing typed means no list (owner, 2026-11-21:
 * the list unfolds only once they start writing). */
export function searchWords(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean).slice(0, 6);
}

export type MatchPart = { text: string; hit: boolean };

/** A title or name split into pieces, the ones matching a typed word marked, for highlighting. */
export function matchParts(text: string, q: string): MatchPart[] {
  const words = searchWords(q).map((w) => w.toLowerCase());
  if (!text || !words.length) return text ? [{ text, hit: false }] : [];
  const lower = text.toLowerCase();
  const hit = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let at = lower.indexOf(w); at >= 0; at = lower.indexOf(w, at + 1)) hit.fill(true, at, at + w.length);
  }
  const parts: MatchPart[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const last = parts[parts.length - 1];
    if (last && last.hit === hit[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: hit[i] });
  }
  return parts;
}

/** The line before, the one on show and the next, for the sync page's three-line view. */
export function lineWindow(lines: readonly string[], index: number): { before: string | null; now: string | null; after: string | null } {
  return {
    before: index > 0 ? (lines[index - 1] ?? null) : null,
    now: index >= 0 ? (lines[index] ?? null) : null,
    after: lines[index + 1] ?? null,
  };
}
