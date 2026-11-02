/* What the phone's lock screen and notification player show for the song that is playing
 * (Media Session). Without a title, an artist and a cover, Android shows "A site is playing media"
 * with the site's address under it (owner, 2026-11-02: "unprofessional"). Pure, so it is tested. */

import { COVER_SIZES, coverUrl } from "@/lib/cover-view";

/** Shown when the song carries no artist name, so the second line is never empty or "null". */
export const MEDIA_FALLBACK_ARTIST = "Corner Room";

export type MediaSessionInfo = {
  title: string;
  artist: string;
  album: string;
  artwork: { src: string; sizes: string }[];
};

function clean(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  return text === "null" || text === "undefined" ? "" : text;
}

/** An address the notification can fetch on its own: relative ones are made absolute on `origin`. */
function absolute(src: string, origin: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return `${origin.replace(/\/$/, "")}${src.startsWith("/") ? "" : "/"}${src}`;
}

/**
 * Title, artist, album and covers for a song. `source` is where the play came from (a release or
 * list name); it becomes the album line unless it only repeats the title. Every cover size the API
 * makes is offered, so each phone picks the one that fits.
 */
export function mediaSessionInfo(
  track: { id: string; title: string; artist?: string | null },
  source: string | null | undefined,
  origin: string,
  apiBase?: string,
): MediaSessionInfo {
  const title = clean(track.title) || "Untitled";
  const album = clean(source);
  return {
    title,
    artist: clean(track.artist) || MEDIA_FALLBACK_ARTIST,
    album: album && album !== title ? album : "",
    artwork: COVER_SIZES.map((size) => ({
      src: absolute(coverUrl({ track: track.id }, size, apiBase) ?? "", origin),
      sizes: `${size}x${size}`,
    })),
  };
}
