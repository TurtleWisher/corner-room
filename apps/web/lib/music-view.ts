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

export type PlayedLine = { key: string; name: string; plays: string; href: string | null };
/** One credit line; an act's line carries the people who played in it (D-CREDITS-05). */
export type CreditLine = { key: string; role: string; name: string; href: string | null; members: PlayedLine[] };

const sameName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

/**
 * The Corner Room profile a credit names, if any (owner, 2026-10-31): a credit linked to an artist
 * or band, or a typed name that is exactly one public profile's stage name (case and spacing
 * ignored). Its name is always the profile's public stage name, never what was typed.
 */
export function creditProfile(
  credit: { artist_id?: string | null; display_name?: string | null },
  artists: Pick<ArtistRecord, "id" | "stage_name">[],
  bands: Pick<BandRecord, "id" | "name">[] = [],
): { href: string; name: string } | null {
  if (credit.artist_id) {
    const artist = artists.find((a) => a.id === credit.artist_id);
    if (artist) return { href: `/artists/${artist.id}`, name: artist.stage_name };
    // Every band is an artist too (D-ARTIST-UNIFY-01): a credit may point at a band.
    const band = bands.find((b) => b.id === credit.artist_id);
    if (band) return { href: `/bands/${band.id}`, name: band.name };
  }
  const typed = sameName(credit.display_name || "");
  if (!typed) return null;
  const matches = [
    ...artists.filter((a) => sameName(a.stage_name) === typed).map((a) => ({ href: `/artists/${a.id}`, name: a.stage_name })),
    ...bands.filter((b) => sameName(b.name) === typed).map((b) => ({ href: `/bands/${b.id}`, name: b.name })),
  ];
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Where a credited person's name links (owner, 2026-10-31): to their Corner Room page when they
 * have one, so every artist can be found from the songs they worked on. Anyone else (or a name two
 * profiles share) stays plain text.
 */
export function creditLink(
  credit: { artist_id?: string | null; display_name?: string | null },
  artists: Pick<ArtistRecord, "id" | "stage_name">[],
  bands: Pick<BandRecord, "id" | "name">[] = [],
): string | null {
  return creditProfile(credit, artists, bands)?.href ?? null;
}

/** A credit for playing on the song rather than making it (D-CREDITS-02). */
const roleOf = (c: { credit_role: string; role_key?: string | null }) => (c.role_key || c.credit_role).toLowerCase();

type SongCredit = {
  id: string;
  credit_role: string;
  role_key?: string | null;
  artist_id?: string | null;
  display_name?: string | null;
  instrument?: string | null;
  part_of_artist_id?: string | null;
  part_of_name?: string | null;
};

/** Who an act credit is, to match the musicians who name it (D-CREDITS-05). */
const actKey = (id?: string | null, name?: string | null) => (id ? `id:${id}` : name?.trim() ? `name:${sameName(name)}` : null);

/**
 * Song page credits, one line per credit in the artist's order (owner, 2026-10-31). Who played on
 * the song (musicians: singer, guitarist, a guest drummer) never get lines of their own: they fold
 * under the song's own artist's line ("Songwriter & Composer: MIZULS"), or under another act's line
 * when Studio says they played in that act. Collaborators (recording, mixing, artwork) are lines
 * of their own. A role the artist named themselves ("Cover art") reads as that role
 * (D-CREDITS-02). Linked names read as the profile's stage name. Only when the song's artist is
 * not credited at all do musicians stand on their own lines.
 */
export function creditDetails(
  credits: SongCredit[],
  artists: Pick<ArtistRecord, "id" | "stage_name">[],
  roleLabel: (role: string) => string,
  bands: Pick<BandRecord, "id" | "name">[] = [],
  /** The song's own artist or band (the release's profile); musicians fold under its line. */
  ownActId: string | null = null,
): { main: CreditLine[] } {
  const main: CreditLine[] = [];
  const acts = new Map<string, CreditLine>();
  let ownAct: CreditLine | undefined;
  const named = (c: SongCredit) => {
    const profile = creditProfile(c, artists, bands);
    return { name: profile?.name ?? creditPerson({ artist_id: c.artist_id, display_name: c.display_name }, artists, bands), href: profile?.href ?? null };
  };
  for (const c of credits) {
    if (roleOf(c) === "musician") continue;
    const { name, href } = named(c);
    if (!name) continue;
    const instrument = (c.instrument || "").trim();
    const role = roleOf(c) === "custom" ? instrument || "Credit" : [roleLabel(c.credit_role), instrument].filter(Boolean).join(" · ");
    const line: CreditLine = { key: c.id, role, name, href, members: [] };
    main.push(line);
    const key = actKey(c.artist_id, c.display_name);
    if (key && !acts.has(key)) acts.set(key, line);
    // The song's own artist, linked or typed with its stage name (first line wins).
    if (!ownAct && ownActId && href && href.endsWith(`/${ownActId}`)) ownAct = line;
  }
  // Musicians: under the act Studio names, else under the song's own artist, else their own line.
  const lines: CreditLine[] = [];
  for (const c of credits) {
    if (roleOf(c) !== "musician") {
      const line = main.find((m) => m.key === c.id);
      if (line) lines.push(line);
      continue;
    }
    const { name, href } = named(c);
    if (!name) continue;
    const plays = (c.instrument || "").trim() || "Musician";
    const act = acts.get(actKey(c.part_of_artist_id, c.part_of_name) ?? "") ?? ownAct;
    if (act) act.members.push({ key: c.id, name, plays, href });
    else lines.push({ key: c.id, role: plays, name, href, members: [] });
  }
  return { main: lines };
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

export type ReleaseHeroActions = {
  /** Play from the top: albums and EPs only; a single's one song plays from its own row. */
  play: boolean;
  /** Visitors: "Sign in" here only when the songs' rows don't already offer it. */
  signIn: boolean;
  /** The whole release's price: a button for customers, a line for visitors. */
  price: boolean;
  /** Nothing to play and nothing to buy yet. */
  notOnSale: boolean;
  /** A single shows its song's credits beside the cover instead of a second Play (owner, 2026-11-01). */
  credits: boolean;
};

/**
 * What sits beside a release's cover (owner, 2026-11-01, D-SINGLE-01): a single (one song) has no
 * Play or Sign in there, since its one row has both; it shows the song's credits instead. Buying the
 * release stays, because the row shows only a lock for a song sold with its release.
 */
export function releaseHeroActions({
  trackCount,
  signedIn,
  ownsOne,
  onSale,
}: {
  trackCount: number;
  signedIn: boolean;
  ownsOne: boolean;
  onSale: boolean;
}): ReleaseHeroActions {
  const single = trackCount === 1;
  return {
    play: signedIn && ownsOne && !single,
    signIn: !signedIn && !single,
    price: onSale,
    notOnSale: signedIn && !ownsOne && !onSale,
    credits: single,
  };
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
