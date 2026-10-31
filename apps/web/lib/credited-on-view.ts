/*
 * "Credited on" on an artist's or band's page (owner, 2026-10-31, D-CREDITS-06): released songs by
 * other artists they worked on, kept apart from their own releases. Pure helpers: the role filter
 * above the list and where the song's own artist links.
 */

import type { CreditedSong } from "@/features/artists/api";

/** The roles they have across these songs, most frequent first, for the filter above the list. */
export function creditedRoles(songs: Pick<CreditedSong, "roles">[]): { role: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of songs) for (const r of new Set(s.roles)) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()].map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));
}

/** The songs for one role, or all of them. */
export function songsFor<T extends Pick<CreditedSong, "roles">>(songs: T[], role: string | null): T[] {
  return role ? songs.filter((s) => s.roles.includes(role)) : songs;
}

/** The page of the song's own artist or band (every band is an artist, D-ARTIST-UNIFY-01). */
export function byHref(song: Pick<CreditedSong, "by_id" | "by_kind">): string | null {
  if (!song.by_id) return null;
  return song.by_kind === "BAND" ? `/bands/${song.by_id}` : `/artists/${song.by_id}`;
}
