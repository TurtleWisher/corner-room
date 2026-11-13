/*
 * The Studio release page in parts (owner, 2026-11-08, D-RELEASE-TABS-01): one part on screen at a
 * time (Details, Songs, Preview Studio, Price, Pre-sale, Review; Pre-sale got its own part on
 * 2026-11-13, D-RELEASE-PLAN-01) so an artist goes straight to what they came
 * for instead of scrolling past everything else. The part on show sits in the address's #hash, so the
 * old section links (#tracks, #presale, #submit) still open the right part. Words only: what is ready
 * comes from the server's readiness list, never decided here.
 */

import type { ReadinessItem, StudioTrack } from "@/features/studio/api";

export type ReleasePart = "details" | "songs" | "preview" | "price" | "presale" | "review";

export const RELEASE_PARTS: readonly { id: ReleasePart; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "songs", label: "Songs" },
  { id: "preview", label: "Preview Studio" },
  { id: "price", label: "Price" },
  { id: "presale", label: "Pre-sale" },
  { id: "review", label: "Review" },
];

/** Each part's own hash, plus the section links the page used before it was split. */
const HASHES: Record<string, ReleasePart> = {
  details: "details",
  cover: "details",
  songs: "songs",
  tracks: "songs",
  preview: "preview",
  teasers: "preview",
  price: "price",
  presale: "presale",
  "pre-sale": "presale",
  review: "review",
  submit: "review",
  history: "review",
  delete: "review",
};

/** The part a #hash opens, or null when the hash isn't one of the release page's own. */
export function partForHash(hash: string | null | undefined): ReleasePart | null {
  const key = (hash ?? "").replace(/^#/, "").trim().toLowerCase();
  return HASHES[key] ?? null;
}

/** Which part fixes a missing readiness item. */
const READINESS_PART: Record<string, ReleasePart> = {
  TITLE: "details",
  LANGUAGE: "details",
  GENRE: "details",
  P_LINE: "details",
  C_LINE: "details",
  COVER: "details",
  TRACKS: "songs",
  TRACK_ORDER: "songs",
  TRACK_TITLE: "songs",
  TRACK_AUDIO: "songs",
  PRICE: "price",
  TRACK_PRICE: "price",
};

/** How many things are still missing in each part (only parts with something missing are listed). */
export function missingByPart(items: readonly ReadinessItem[]): Partial<Record<ReleasePart, number>> {
  const out: Partial<Record<ReleasePart, number>> = {};
  for (const item of items) {
    if (item.ok) continue;
    const part = READINESS_PART[item.code];
    if (!part) continue;
    out[part] = (out[part] ?? 0) + 1;
  }
  return out;
}

export type SongPart = "song" | "audio" | "credits" | "lyrics";

export const SONG_PARTS: readonly { id: SongPart; label: string }[] = [
  { id: "song", label: "Song" },
  { id: "audio", label: "Audio" },
  { id: "credits", label: "Credits" },
  { id: "lyrics", label: "Lyrics" },
];

export type SongLine = { audio: string; tone: "good" | "attention" | "neutral"; credits: string; lyrics: string };

/** The one-line summary on a folded song: its audio, credits and lyrics, in words. */
export function songLine(track: Pick<StudioTrack, "audio" | "credits" | "lyrics" | "lyrics_waiting">): SongLine {
  const busy = track.audio.find((a) => a.status === "UPLOADING" || a.status === "PROCESSING");
  const current = track.audio.find((a) => a.is_current) ?? null;
  let audio: string;
  let tone: SongLine["tone"];
  if (busy && busy.has_audio) {
    audio = "Audio being checked";
    tone = "neutral";
  } else if (current && current.status === "READY") {
    audio = "Audio ready";
    tone = "good";
  } else if (current && current.status === "REJECTED") {
    audio = "Audio not accepted";
    tone = "attention";
  } else if (current && current.has_audio) {
    audio = "Audio being checked";
    tone = "neutral";
  } else {
    audio = "No audio yet";
    tone = "attention";
  }
  const n = track.credits.length;
  const credits = n === 0 ? "No credits" : n === 1 ? "1 credit" : `${n} credits`;
  const lyrics = track.lyrics_waiting ? "Lyrics waiting" : track.lyrics && track.lyrics.trim() ? "Lyrics" : "No lyrics";
  return { audio, tone, credits, lyrics };
}

/** Songs open by default: a single song is always open, a longer release starts folded. */
export function openByDefault(trackIds: readonly string[]): string[] {
  return trackIds.length === 1 ? [...trackIds] : [];
}

/** The song a just-made list adds (to open it), or null. */
export function addedSong(before: readonly string[], after: readonly string[]): string | null {
  const known = new Set(before);
  return after.find((id) => !known.has(id)) ?? null;
}
