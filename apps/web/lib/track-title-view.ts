/**
 * A song's version after its title (owner, 2026-11-14, D-VERSION-01): "Meghe Dhaka Dhrubotara
 * (Acoustic Demo)". Only the song page and the listening room's big title use it; lists, the player
 * bar and the store keep the plain title. The version is drawn smaller and quieter than the title,
 * a note on which version this is rather than part of the name.
 */
export type TitleParts = { title: string; version: string | null };

export function titleParts(title: string, version: string | null | undefined): TitleParts {
  const v = (version ?? "").trim().replace(/^\((.*)\)$/, "$1").trim();
  if (!v) return { title, version: null };
  // The artist already wrote it into the title: don't say it twice.
  if (title.trim().toLowerCase().endsWith(`(${v.toLowerCase()})`)) return { title, version: null };
  return { title, version: v };
}

export function titleWithVersion(title: string, version: string | null | undefined): string {
  const parts = titleParts(title, version);
  return parts.version ? `${parts.title} (${parts.version})` : parts.title;
}

/** Smallest the room title shrinks to, as a share of its full size. */
export const MIN_TITLE_FIT = 0.2;

/**
 * How much to shrink the listening room's title so it stays on one line (owner, 2026-11-14): never
 * larger than its full size, never smaller than MIN_TITLE_FIT. `natural` is the line's width at full
 * size, `available` the room it has.
 */
export function titleFit(available: number, natural: number, min = MIN_TITLE_FIT): number {
  if (!(available > 0) || !(natural > 0)) return 1;
  // Text doesn't shrink in perfect proportion (glyphs snap to pixels), so leave 3% to spare.
  const fit = Math.min(1, (available * 0.97) / natural);
  return Math.max(min, Math.floor(fit * 1000) / 1000);
}
