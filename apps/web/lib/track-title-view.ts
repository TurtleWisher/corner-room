/**
 * A song's version after its title, in brackets (owner, 2026-11-14, D-VERSION-01): "Meghe Dhaka
 * Dhrubotara (Acoustic Demo)". Only the song page and the listening room's big title use it; lists,
 * the player bar and the store keep the plain title.
 */
export function titleWithVersion(title: string, version: string | null | undefined): string {
  const v = (version ?? "").trim().replace(/^\((.*)\)$/, "$1").trim();
  if (!v) return title;
  // The artist already wrote it into the title: don't say it twice.
  if (title.trim().toLowerCase().endsWith(`(${v.toLowerCase()})`)) return title;
  return `${title} (${v})`;
}
