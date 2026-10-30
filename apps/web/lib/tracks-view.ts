import type { ReleaseRecord, TrackRecord } from "@/lib/api";

/*
 * The Tracks tab (owner, 2026-10-30): singles show as songs, and the songs of an album or EP show
 * as that one album, which opens to its songs. Newest first. Pure, so it is tested.
 */

export type TracksEntry =
  | { kind: "album"; release: ReleaseRecord; trackIds: string[] }
  | { kind: "song"; track: TrackRecord; releaseIds: string[] };

const isCollection = (r: ReleaseRecord) => (r.release_type || "").toUpperCase() !== "SINGLE";
const time = (r: ReleaseRecord | undefined) => (r?.release_at ? Date.parse(r.release_at) || 0 : 0);

export function tracksEntries(tracks: readonly TrackRecord[], releases: readonly ReleaseRecord[]): TracksEntry[] {
  const released = new Map(releases.filter((r) => r.status === "RELEASED").map((r) => [r.id, r]));
  const albums = new Map<string, string[]>();
  const songs: { track: TrackRecord; releaseIds: string[]; at: number }[] = [];
  for (const track of tracks) {
    const releaseIds = (track.release_ids ?? []).filter((id) => released.has(id));
    const collections = releaseIds.filter((id) => isCollection(released.get(id)!));
    for (const id of collections) albums.set(id, [...(albums.get(id) ?? []), track.id]);
    // A song shows on its own when it is out as a single, or on no album or EP at all.
    const singles = releaseIds.filter((id) => !isCollection(released.get(id)!));
    if (singles.length > 0 || collections.length === 0) {
      songs.push({ track, releaseIds, at: Math.max(0, ...singles.map((id) => time(released.get(id)))) });
    }
  }
  const entries: { entry: TracksEntry; at: number }[] = [
    ...[...albums].map(([id, trackIds]) => ({ entry: { kind: "album", release: released.get(id)!, trackIds } as TracksEntry, at: time(released.get(id)) })),
    ...songs.map((s) => ({ entry: { kind: "song", track: s.track, releaseIds: s.releaseIds } as TracksEntry, at: s.at })),
  ];
  // Newest first; the sort is stable, so equal dates keep the API's order.
  return entries.sort((a, b) => b.at - a.at).map((e) => e.entry);
}

/** "Album · 8 songs", "EP · 1 song". */
export function collectionLabel(releaseType: string | null | undefined, songs: number): string {
  const nouns: Record<string, string> = { ALBUM: "Album", EP: "EP", LIVE: "Live album", COMPILATION: "Compilation" };
  const noun = nouns[(releaseType ?? "").toUpperCase()] ?? "Release";
  return `${noun} · ${songs} ${songs === 1 ? "song" : "songs"}`;
}
