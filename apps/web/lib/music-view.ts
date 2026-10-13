import type { ArtistRecord, BandRecord, PlayableTrackRecord, ReleaseRecord } from "@/lib/api";

/*
 * Pure helpers for release and track pages (music.md). Display only: counts and durations are
 * read from API records, never estimated.
 */

const RELEASE_TYPE_LABEL: Record<string, string> = {
  SINGLE: "Single",
  EP: "EP",
  ALBUM: "Album",
  COMPILATION: "Compilation",
  LIVE: "Live",
};

export function releaseTypeLabel(type: string | null | undefined): string {
  if (!type) return "Release";
  return RELEASE_TYPE_LABEL[type] ?? type.charAt(0) + type.slice(1).toLowerCase();
}

/** Name of the primary artist or band, looked up from lists the page already loaded. */
export function creditName(
  record: { primary_artist_id?: string | null; primary_band_id?: string | null },
  artists: Pick<ArtistRecord, "id" | "stage_name">[],
  bands: Pick<BandRecord, "id" | "name">[],
): string | null {
  if (record.primary_artist_id) {
    const artist = artists.find((a) => a.id === record.primary_artist_id);
    if (artist) return artist.stage_name;
  }
  if (record.primary_band_id) {
    const band = bands.find((b) => b.id === record.primary_band_id);
    if (band) return band.name;
  }
  return null;
}

/** Where the credit links to, when the page knows. */
export function creditHref(record: { primary_artist_id?: string | null; primary_band_id?: string | null }): string | null {
  if (record.primary_artist_id) return `/artists/${record.primary_artist_id}`;
  if (record.primary_band_id) return `/bands/${record.primary_band_id}`;
  return null;
}

/** "3:05" from milliseconds; null when unknown. */
export function formatDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * "5 tracks · 21 min" only when every duration is known, otherwise "5 tracks" (music.md copy rule).
 */
export function trackCountLabel(durations: (number | null | undefined)[]): string {
  const n = durations.length;
  const count = `${n} ${n === 1 ? "track" : "tracks"}`;
  if (n === 0 || durations.some((d) => typeof d !== "number" || !Number.isFinite(d))) return count;
  const minutes = Math.round((durations as number[]).reduce((a, b) => a + b, 0) / 60000);
  return `${count} · ${minutes} min`;
}

/** Eyebrow for a release: "EP · Kaal Bela · 5 tracks", skipping parts the page does not know. */
export function releaseEyebrow(release: Pick<ReleaseRecord, "release_type">, artist: string | null, trackCount: number | null): string {
  const parts = [releaseTypeLabel(release.release_type)];
  if (artist) parts.push(artist);
  if (trackCount !== null) parts.push(`${trackCount} ${trackCount === 1 ? "track" : "tracks"}`);
  return parts.join(" · ");
}

export type PlayState = { kind: "playable" } | { kind: "unavailable"; reason: string } | { kind: "unknown" };

/** What the play button can honestly say for a track, from the signed-in playback catalog. */
export function playState(record: PlayableTrackRecord | undefined): PlayState {
  if (!record) return { kind: "unknown" };
  if (record.catalog_playable && record.audio_deliverable) return { kind: "playable" };
  const reason = record.reason ? humanReason(record.reason) : "Not available to play right now";
  return { kind: "unavailable", reason };
}

function humanReason(reason: string): string {
  const words = reason.replace(/[_\-.]+/g, " ").trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "Not available to play right now";
}

/** Newest first by release date; undated releases last, then by title. */
export function sortReleases<T extends Pick<ReleaseRecord, "release_at" | "title">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = a.release_at ? Date.parse(a.release_at) : NaN;
    const tb = b.release_at ? Date.parse(b.release_at) : NaN;
    const ha = !Number.isNaN(ta);
    const hb = !Number.isNaN(tb);
    if (ha && hb && ta !== tb) return tb - ta;
    if (ha !== hb) return ha ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

/** A row a play can start from: its track, and the title and artist to show while it loads. */
export type QueueRow = { trackId: string; title?: string | null; artist?: string | null };

/**
 * Up next for a list (owner decision 2026-10-13): the rows the customer can play right now, in the
 * list's order. Rows that are unavailable or not owned are left out, so Next never lands on a
 * track that is known to fail. The API still decides access when each one plays.
 */
export function playQueue(
  rows: readonly QueueRow[],
  playable: ReadonlyMap<string, PlayableTrackRecord>,
  owns: (trackId: string) => boolean,
): { id: string; title: string; artist: string | null }[] {
  const out: { id: string; title: string; artist: string | null }[] = [];
  for (const row of rows) {
    const rec = playable.get(row.trackId);
    if (playState(rec).kind !== "playable" || !owns(row.trackId)) continue;
    out.push({ id: row.trackId, title: row.title || rec?.title || "", artist: row.artist ?? null });
  }
  return out;
}
