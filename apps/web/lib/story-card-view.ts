/*
 * Story cards (owner, 2026-11-08, D-STORY-01). Someone who owns a song picks a moment of it, at most
 * the server's `clip_max_ms` (30 s), and gets a 1080 x 1920 video of a Corner Room listening-room
 * card with that moment's sound, for Instagram, Facebook and other apps' stories. The look takes
 * only the liquid glass style the owner showed (frosted, see-through, a lit rim, glossy depth); the
 * card keeps Corner Room's own cut corner and Sky colours. Everything here is a pure function of
 * time, so the preview and the video are the same frames.
 */

import { lyricAgeAt, lyricIndexAt, lyricLines, lyricTimes } from "@/lib/lyrics-view";

export const STORY_W = 1080;
export const STORY_H = 1920;
export const STORY_FPS = 30;
/** Fades so the story starts and ends softly instead of cutting into the song. */
export const FADE_IN_S = 0.35;
export const FADE_OUT_S = 0.8;

export type StoryReason = "OK" | "NOT_SIGNED_IN" | "NOT_OWNED" | "NOT_RELEASED" | "SHARING_OFF" | "STORIES_OFF";

/** Why the button isn't there, in words, for the rare case someone reaches the dialog anyway. */
export function storyReasonText(reason: string): string {
  switch (reason) {
    case "OK":
      return "";
    case "NOT_OWNED":
      return "Only people who own this song can share it as a story.";
    case "NOT_RELEASED":
      return "This song isn't out yet, so it can't be shared as a story.";
    case "SHARING_OFF":
      return "The artist has turned story sharing off for this music.";
    case "STORIES_OFF":
      return "Story sharing isn't open right now.";
    default:
      return "This song can't be shared as a story right now.";
  }
}

/** The moment, kept inside the song and no longer than allowed. Milliseconds in, milliseconds out. */
export function clipWindow(startMs: number, songMs: number, maxMs: number): { startMs: number; endMs: number } {
  const song = Math.max(0, Math.floor(songMs));
  const length = Math.max(0, Math.min(Math.floor(maxMs), song));
  if (length === 0) return { startMs: 0, endMs: 0 };
  const start = Math.max(0, Math.min(Math.floor(Number.isFinite(startMs) ? startMs : 0), song - length));
  return { startMs: start, endMs: start + length };
}

/**
 * Where the picker starts: a beat before the first timed line (the singing is what people share),
 * else the start of the song.
 */
export function defaultStartMs(songMs: number, maxMs: number, timingsMs?: readonly number[] | null): number {
  const first = timingsMs && timingsMs.length > 0 ? timingsMs[0] : 0;
  return clipWindow(Math.max(0, first - 600), songMs, maxMs).startMs;
}

/** "1:05" for the picker. */
export function clockLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A file name people recognise in their gallery, from the song's title (Bangla kept). */
export function storyFileName(title: string): string {
  const base = title
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${base || "Song"} - Corner Room story.mp4`;
}

/**
 * How the finished video leaves the page: the phone's share sheet when it can take a video file
 * (Instagram, Facebook, WhatsApp and others show up there), else a download.
 */
export function shareRoute(nav: { canShare?: (data: { files: File[] }) => boolean } | undefined, file: File | null): "share" | "download" {
  if (!nav || !file || typeof nav.canShare !== "function") return "download";
  try {
    return nav.canShare({ files: [file] }) ? "share" : "download";
  } catch {
    return "download";
  }
}

/** Loudness per video frame (0..1), smoothed, from the clip's samples: drives the card's glow. */
export function levelsPerFrame(samples: Float32Array, sampleRate: number, fps = STORY_FPS): Float32Array {
  const per = Math.max(1, Math.round(sampleRate / fps));
  const frames = Math.max(1, Math.ceil(samples.length / per));
  const out = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const from = f * per;
    const to = Math.min(samples.length, from + per);
    for (let i = from; i < to; i++) sum += samples[i] * samples[i];
    out[f] = Math.sqrt(sum / Math.max(1, to - from));
    peak = Math.max(peak, out[f]);
  }
  // Rise fast, fall slow, like the room's light; scaled so the loudest moment is 1.
  let held = 0;
  for (let f = 0; f < frames; f++) {
    const v = peak > 0 ? out[f] / peak : 0;
    held = v > held ? held + (v - held) * 0.6 : held + (v - held) * 0.12;
    out[f] = held;
  }
  return out;
}

export type StoryInput = {
  title: string;
  artist: string;
  /** The song's own lyrics text, null without lyrics. */
  lyrics: string | null;
  lyricsTimingsMs: readonly number[] | null;
  songMs: number;
  startMs: number;
  endMs: number;
  levels?: Float32Array | null;
};

export type StoryLyric = { text: string; age: number };

export type StoryFrame = {
  /** 0..1 as the card arrives in the first moments. */
  arrive: number;
  /** Gentle float, in story pixels, and a slight lean in degrees. */
  floatY: number;
  lean: number;
  /** Where the gloss sweep is across the card, 0..1 (outside that range it is off the card). */
  sheen: number;
  /** Loudness now, 0..1. */
  glow: number;
  /** Share of the moment played, 0..1. */
  progress: number;
  /** Lines in the air: age 0 is the line now, -1 the one leaving, 1 the next one arriving. */
  lines: StoryLyric[];
  /** How far through the line now (0..1) for timed lyrics; null when paced. */
  sung: number | null;
};

const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/** The card at `t` seconds into the story. */
export function storyFrame(input: StoryInput, t: number): StoryFrame {
  const length = Math.max(0.001, (input.endMs - input.startMs) / 1000);
  const time = Math.min(length, Math.max(0, t));
  const songS = input.startMs / 1000 + time;
  const songDurS = input.songMs / 1000;
  const lines = lyricLines(input.lyrics);
  const times = lyricTimes(lines.length, input.lyricsTimingsMs);
  const index = lyricIndexAt(lines.length, songS, songDurS, times);
  const out: StoryLyric[] = [];
  let sung: number | null = null;
  if (lines.length > 0) {
    // The line now, the one before leaving, the next waiting (before the first line: the first).
    const now = Math.max(0, index);
    const ageNow = lyricAgeAt(now, lines.length, songS, songDurS, times);
    // As each line takes over, the stack glides up one place: +1 (waiting) to 0 (now) in the
    // line's first stretch. Before the first line nothing moves.
    const glide = index < 0 || !Number.isFinite(ageNow) ? 0 : 1 - easeOut(Math.max(0, ageNow) / 0.18);
    for (const i of [now - 1, now, now + 1]) {
      if (i < 0 || i >= lines.length || (index < 0 && i < now)) continue;
      out.push({ text: lines[i], age: i - now + glide });
    }
    if (times && index >= 0 && Number.isFinite(ageNow)) sung = Math.min(1, Math.max(0, ageNow));
  }
  const levels = input.levels;
  const glow = levels && levels.length > 0 ? levels[Math.min(levels.length - 1, Math.floor(time * STORY_FPS))] : 0.4;
  return {
    arrive: easeOut(time / 0.9),
    floatY: Math.sin(time * 0.9) * 10,
    lean: Math.sin(time * 0.55 + 0.6) * 1.1,
    sheen: ((time + 1.2) % 6) / 3.2 - 0.3,
    glow,
    progress: time / length,
    lines: out,
    sung,
  };
}

/** Audio gain at `t` seconds: soft in, soft out. */
export function fadeGain(t: number, lengthS: number): number {
  if (t < 0 || t > lengthS) return 0;
  const inG = Math.min(1, t / FADE_IN_S);
  const outG = Math.min(1, (lengthS - t) / FADE_OUT_S);
  return Math.max(0, Math.min(inG, outG));
}
