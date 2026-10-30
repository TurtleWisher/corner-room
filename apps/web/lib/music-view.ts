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

/**
 * Who a song credit names (owner, 2026-10-27: Studio credits were saved but showed "Not available"):
 * the linked Corner Room profile when there is one, else the name typed in Studio, with the
 * instrument when given. Null only when the credit names nobody.
 */
export function creditPerson(
  credit: { artist_id?: string | null; display_name?: string | null; instrument?: string | null },
  artists: Pick<ArtistRecord, "id" | "stage_name">[],
  bands: Pick<BandRecord, "id" | "name">[] = [],
): string | null {
  // A credit may point at a band too: every band is an artist (D-ARTIST-UNIFY-01).
  const linked = credit.artist_id
    ? (artists.find((a) => a.id === credit.artist_id)?.stage_name ?? bands.find((b) => b.id === credit.artist_id)?.name)
    : null;
  const name = (linked || credit.display_name || "").trim();
  if (!name) return null;
  const instrument = (credit.instrument || "").trim();
  return instrument ? `${name} (${instrument})` : name;
}

export type CreditLine = { key: string; role: string; name: string; href: string | null };
export type PlayedLine = { key: string; name: string; plays: string; href: string | null };

const sameName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

/**
 * Where a credited person's name links (owner, 2026-10-31): to their Corner Room page when they
 * have one, so every artist can be found from the songs they worked on. A credit linked to an artist
 * or band opens that page; a typed name opens the one public artist or band with exactly that name.
 * Anyone else (or a name two profiles share) stays plain text.
 */
export function creditLink(
  credit: { artist_id?: string | null; display_name?: string | null },
  artists: Pick<ArtistRecord, "id" | "stage_name">[],
  bands: Pick<BandRecord, "id" | "name">[] = [],
): string | null {
  if (credit.artist_id) {
    if (artists.some((a) => a.id === credit.artist_id)) return `/artists/${credit.artist_id}`;
    // Every band is an artist too (D-ARTIST-UNIFY-01): a credit may point at a band.
    if (bands.some((b) => b.id === credit.artist_id)) return `/bands/${credit.artist_id}`;
  }
  const typed = sameName(credit.display_name || "");
  if (!typed) return null;
  const matches = [
    ...artists.filter((a) => sameName(a.stage_name) === typed).map((a) => `/artists/${a.id}`),
    ...bands.filter((b) => sameName(b.name) === typed).map((b) => `/bands/${b.id}`),
  ];
  return matches.length === 1 ? matches[0] : null;
}

/** A credit for playing on the song rather than making it (D-CREDITS-02). */
const roleOf = (c: { credit_role: string; role_key?: string | null }) => (c.role_key || c.credit_role).toLowerCase();
const isMusician = (c: { credit_role: string; role_key?: string | null }) => roleOf(c) === "musician";

/**
 * Song page credits. The main list names who made the song, one line per role (no instruments).
 * "Track credits" says who played what on this one song, instrument first, in the order they were
 * entered (owner, 2026-10-30: "guitars this guy, bass this guy ... vocal, drums", per song only,
 * so the band's lineup is not repeated here). A role the artist named themselves ("Cover art") is a
 * main credit under that name (D-CREDITS-02).
 */
export function creditDetails(
  credits: { id: string; credit_role: string; role_key?: string | null; artist_id?: string | null; display_name?: string | null; instrument?: string | null }[],
  artists: Pick<ArtistRecord, "id" | "stage_name">[],
  roleLabel: (role: string) => string,
  bands: Pick<BandRecord, "id" | "name">[] = [],
): { main: CreditLine[]; played: PlayedLine[] } {
  const main: CreditLine[] = [];
  const played: PlayedLine[] = [];
  for (const c of credits) {
    const name = creditPerson({ artist_id: c.artist_id, display_name: c.display_name }, artists, bands);
    if (!name) continue;
    const instrument = (c.instrument || "").trim();
    const href = creditLink(c, artists, bands);
    if (roleOf(c) === "custom") {
      main.push({ key: c.id, role: instrument || "Credit", name, href });
      continue;
    }
    if (instrument || isMusician(c)) played.push({ key: `p-${c.id}`, name, plays: instrument || "Played on this song", href });
    if (!isMusician(c)) main.push({ key: c.id, role: roleLabel(c.credit_role), name, href });
  }
  return { main, played };
}

/**
 * Whether this person reviews and releases music (staff), as opposed to the song's own artist, who
 * also gets the management box but only for their song (owner, 2026-10-27: "Manage this song").
 * UX only: the API checks every action.
 */
export function canModerateMusic(permissions: readonly string[] | undefined): boolean {
  return (permissions ?? []).includes("music.approve");
}

/**
 * The primary artist's or band's approved picture, as a cover source (owner, 2026-10-27: artists
 * are recognised by their picture on every page, not only their own). Null when there is none.
 */
export function creditPicture(
  record: { primary_artist_id?: string | null; primary_band_id?: string | null },
  artists: Pick<ArtistRecord, "id" | "portrait_asset_id">[],
  bands: Pick<BandRecord, "id" | "portrait_asset_id">[],
): { artist: string; picture: string } | { band: string; picture: string } | null {
  if (record.primary_artist_id) {
    const picture = artists.find((a) => a.id === record.primary_artist_id)?.portrait_asset_id;
    return picture ? { artist: record.primary_artist_id, picture } : null;
  }
  if (record.primary_band_id) {
    const picture = bands.find((b) => b.id === record.primary_band_id)?.portrait_asset_id;
    return picture ? { band: record.primary_band_id, picture } : null;
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
