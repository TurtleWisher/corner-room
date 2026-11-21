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

/** One short state for a song in the search list. */
export function songMark(song: Pick<LyricSong, "lines" | "timed" | "lyrics_waiting">): SongMark {
  if (song.lyrics_waiting) return { label: "Change waiting", tone: "wait" };
  if (song.lines === 0) return { label: "No lyrics", tone: "none" };
  if (song.timed) return { label: "Synced", tone: "ok" };
  return { label: "Not synced", tone: "todo" };
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
}): SaveAction {
  const lines = lyricLines(tidyLyrics(o.draft));
  const allTimed = lines.length > 0 && o.times.length === lines.length;
  if (wordsChanged(o.draft, o.live)) {
    if (!o.approvesAtOnce) return { label: "Send words for approval", words: true, times: false };
    return { label: allTimed ? "Save words and timings" : "Save words", words: true, times: allTimed };
  }
  const timesChanged = JSON.stringify(o.times) !== JSON.stringify(o.stored ?? []);
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

/** Where each tap sits along the song, 0 to 1, for the marks on the sync page's timeline. */
export function tapMarks(timesMs: readonly number[], durationS: number): number[] {
  if (!(durationS > 0)) return [];
  return timesMs.map((t) => Math.min(1, Math.max(0, t / 1000 / durationS)));
}

/** The line before, the one on show and the next, for the sync page's three-line view. */
export function lineWindow(lines: readonly string[], index: number): { before: string | null; now: string | null; after: string | null } {
  return {
    before: index > 0 ? (lines[index - 1] ?? null) : null,
    now: index >= 0 ? (lines[index] ?? null) : null,
    after: lines[index + 1] ?? null,
  };
}
