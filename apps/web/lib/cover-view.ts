/* Where a music cover image comes from (OD-05, owner 2026-10-23: the official cover always shows
 * when there is one; the letter cube is the fallback when there is none or it fails to load).
 * The API decides which cover, and whether there is one; these only build the addresses. */

import { getApiBaseUrl } from "@/lib/api/client";

/** Web sizes the API makes from each accepted cover (square, px). */
export const COVER_SIZES = [160, 480, 1200] as const;
export type CoverSize = (typeof COVER_SIZES)[number];

export type CoverSource =
  | { release: string; hasCover?: boolean }
  | { track: string }
  /** An event's official poster (OD-06), public once the event is published. */
  | { event: string; hasCover?: boolean }
  /** A signed link from a Studio or staff response (unreleased covers have no public address). */
  | { signed: string | null | undefined };

/** The image address for a cover, or null when it is already known there is none. */
export function coverUrl(source: CoverSource, size: CoverSize = 480, base: string = getApiBaseUrl()): string | null {
  if ("signed" in source) return source.signed ? `${base}${source.signed}` : null;
  if ("release" in source) return source.hasCover === false ? null : `${base}/api/v1/covers/releases/${source.release}/${size}`;
  if ("event" in source) return source.hasCover === false ? null : `${base}/api/v1/covers/events/${source.event}/${size}`;
  return `${base}/api/v1/covers/tracks/${source.track}/${size}`;
}

/** The cover for a store offer: its release or its song; plans and catalog passes have none. */
export function offerCoverSource(productType: string | null | undefined, subjectId: string | null | undefined): CoverSource | null {
  if (!subjectId) return null;
  if (productType === "RELEASE") return { release: subjectId };
  if (productType === "TRACK") return { track: subjectId };
  return null;
}

/** coverUrl for a source that may be missing. */
export function maybeCoverUrl(source: CoverSource | null, size: CoverSize = 480): string | null {
  return source ? coverUrl(source, size) : null;
}
