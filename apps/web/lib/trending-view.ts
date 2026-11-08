/* Trending Corner (owner, 2026-11-08, D-TRENDING-01): the maths behind the home page's turning
 * carousel of discs and the words of its mini player. Pure functions, so every pose and decision is
 * tested; the component only writes the numbers onto elements (transform and opacity only). */

import type { EntitlementRecord, OfferRecord } from "@/lib/api";
import type { TrendingItem } from "@/features/trending/api";
import { releaseTypeLabel } from "@/lib/music-view";
import { offerForRelease, releaseBuyLabel, trackBuyState } from "@/lib/ownership";

/** How long the front disc rests before the carousel turns by itself. */
export const AUTO_TURN_MS = 5200;
/** A press has to move this far to count as a drag (otherwise it is a click). */
export const DRAG_THRESHOLD_PX = 6;
/** Discs further than this from the front are not drawn. */
export const VISIBLE_REACH = 2.6;

/** `i` mod `n`, never negative. */
export function mod(i: number, n: number): number {
  return n <= 0 ? 0 : ((i % n) + n) % n;
}

/**
 * Where item `i` sits relative to the front, in item steps, for a carousel at position `pos`.
 * With three or more items the ring loops, so the answer is the shortest way round,
 * in [-n/2, n/2). With one or two there is no loop: the plain difference.
 */
export function offsetOf(i: number, pos: number, n: number): number {
  const d = i - pos;
  if (n < 3) return d;
  return mod(d + n / 2, n) - n / 2;
}

/** The item in front for a position (nearest whole step), as an index. */
export function frontIndex(pos: number, n: number): number {
  return n < 3 ? Math.min(Math.max(Math.round(pos), 0), Math.max(n - 1, 0)) : mod(Math.round(pos), n);
}

/** The position that brings item `i` to the front from `pos` the shortest way. */
export function positionFor(i: number, pos: number, n: number): number {
  if (n < 3) return i;
  return pos + offsetOf(i, pos, n);
}

/**
 * Where to land after a drag: the nearest step, carried on a little by the flick's speed
 * (steps per second), never past the ends when the ring doesn't loop.
 */
export function landingFor(pos: number, velocity: number, n: number): number {
  const carried = Math.round(pos + Math.max(-2, Math.min(2, velocity * 0.22)));
  return n < 3 ? Math.min(Math.max(carried, 0), Math.max(n - 1, 0)) : carried;
}

/** One disc's pose. Every value is written as transform or opacity, nothing that lays out or paints. */
export type DiscPose = {
  x: number;
  z: number;
  rotateY: number;
  scale: number;
  opacity: number;
  /** How much the disc is dimmed (0 front, up to 0.62 at the back). */
  shade: number;
  /** The words under the disc. */
  label: number;
  /** Where the light's reflection sits on the disc, in degrees: it slides as the disc turns. */
  light: number;
};

/**
 * Discs stand side by side at an angle, overlapping like records in a rack: the front one flat and
 * nearest, each further one turned more, set back and tucked closer. `step` is the front gap in px.
 */
export function discPose(d: number, n: number, step: number): DiscPose {
  const a = Math.abs(d);
  const s = Math.sign(d);
  const near = Math.min(a, 1);
  const x = s * (near * step + Math.max(a - 1, 0) * step * 0.62);
  const z = -a * 150 - near * 40;
  const rotateY = -s * near * 40 - s * Math.max(Math.min(a - 1, 1), 0) * 8;
  const scale = 1 - Math.min(a, 2.5) * 0.07;
  // Fade out toward the reach, and on small loops before crossing behind (where the ring wraps).
  const reach = Math.min(VISIBLE_REACH, n >= 3 ? n / 2 : VISIBLE_REACH);
  const edge = n >= 3 ? reach - 0.15 : reach;
  const opacity = clamp01((edge - a) / 0.6);
  const shade = Math.min(a * 0.32, 0.62);
  const label = clamp01(1.6 - a);
  const light = -d * 38;
  return { x, z, rotateY, scale, opacity, shade, label, light };
}

/** The transform string for a pose (rounded, so styles don't churn on sub-pixel noise). */
export function poseTransform(p: DiscPose): string {
  return `translate3d(${p.x.toFixed(1)}px, 0, ${p.z.toFixed(1)}px) rotateY(${p.rotateY.toFixed(2)}deg) scale(${p.scale.toFixed(4)})`;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Fast start, long gentle landing: a picked disc rushes to the front and settles. */
export function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - clamp01(t), 5);
}

/** The carousel's own turn: eases in and out. */
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export type TurnKind = "auto" | "pick" | "drag" | "step";

/** How long a turn of `distance` steps takes. A pick spins fast, however far. */
export function turnDuration(distance: number, kind: TurnKind): number {
  const a = Math.abs(distance);
  if (a === 0) return 0;
  if (kind === "auto") return 1100;
  if (kind === "pick") return Math.min(1150, 620 + a * 70);
  if (kind === "drag") return Math.min(900, 360 + a * 140);
  return Math.min(900, 520 + a * 120);
}

/**
 * A picked disc comes to the front with a fast spin: on a ring of four or more, once round the whole
 * ring on the way (the "very fast" turn the owner asked for), otherwise the short way.
 */
export function pickTravel(i: number, pos: number, n: number): number {
  const short = positionFor(i, pos, n) - pos;
  if (n < 4 || Math.abs(short) < 0.5) return short;
  return short + Math.sign(short) * n;
}

/** How fast the discs spin while the carousel travels (1 at rest). */
export function spinBoost(speedStepsPerSecond: number): number {
  return 1 + Math.min(Math.abs(speedStepsPerSecond) * 2.4, 14);
}

// --- the mini player ----------------------------------------------------------------------------

/** "Song" for a song picked alone, else the release's own type ("Single", "EP", "Album"...). */
export function kindLabel(item: Pick<TrendingItem, "kind" | "release_type">): string {
  if (item.kind === "TRACK") return "Song";
  return releaseTypeLabel(item.release_type);
}

/** The picks' order with one moved up (-1) or down (+1); unchanged at the ends. */
export function movePick(ids: readonly string[], index: number, delta: -1 | 1): string[] {
  const next = [...ids];
  const to = index + delta;
  if (index < 0 || index >= next.length || to < 0 || to >= next.length) return next;
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Where the title goes: the song page, or the release page. */
export function itemHref(item: Pick<TrendingItem, "kind" | "track_id" | "release_id">): string {
  if (item.kind === "TRACK" && item.track_id) return `/tracks/${item.track_id}`;
  return item.release_id ? `/releases/${item.release_id}` : "/releases";
}

/** Total length of what the item plays, or null when any length is unknown. */
export function itemDurationMs(item: Pick<TrendingItem, "tracks">): number | null {
  if (item.tracks.length === 0) return null;
  let total = 0;
  for (const t of item.tracks) {
    if (t.duration_ms == null) return null;
    total += t.duration_ms;
  }
  return total;
}

export type TrendingAccess =
  /** Bought (or may listen): plays the whole song or release in the normal player. */
  | { kind: "play" }
  /** Not bought: plays the song's published teaser; `buy` is the price beside it, if on sale. */
  | { kind: "teaser"; teaserId: string; trackId: string; buy: TrendingBuy | null; signIn: boolean }
  /** Not bought and no teaser: only the way to buy it (or sign in to). */
  | { kind: "buy"; buy: TrendingBuy | null; signIn: boolean };

export type TrendingBuy = { offer: OfferRecord; label: string };

/** What the person owns and what is on sale (from useCustomerCommerce). */
export type TrendingCommerce = { entitlements: EntitlementRecord[]; offers: OfferRecord[]; streamable?: ReadonlySet<string> };

/**
 * What the mini player can do for this person. The API still checks every play and checkout; this
 * only mirrors what they own. Signed-out visitors can always hear a teaser (no account needed).
 */
export function trendingAccess(item: TrendingItem, commerce: TrendingCommerce, signedIn: boolean): TrendingAccess {
  const songs = item.tracks;
  const owned =
    signedIn &&
    songs.length > 0 &&
    songs.some((t) => trackBuyState(commerce.entitlements, commerce.offers, t.id, t.release_ids, commerce.streamable).kind === "owned");
  if (owned) return { kind: "play" };
  const buy = buyFor(item, commerce);
  const teased = songs.find((t) => t.teaser_id);
  if (teased?.teaser_id) return { kind: "teaser", teaserId: teased.teaser_id, trackId: teased.id, buy, signIn: !signedIn };
  return { kind: "buy", buy, signIn: !signedIn };
}

function buyFor(item: TrendingItem, commerce: TrendingCommerce): TrendingBuy | null {
  const trackIds = item.tracks.map((t) => t.id);
  if (item.kind === "TRACK" && item.track_id) {
    const own = trackBuyState(commerce.entitlements, commerce.offers, item.track_id, item.tracks[0]?.release_ids ?? []);
    if (own.kind === "buy") return { offer: own.offer, label: "Buy the song" };
  }
  const releaseIds = item.kind === "RELEASE" && item.release_id ? [item.release_id] : (item.tracks[0]?.release_ids ?? []);
  for (const rid of releaseIds) {
    const offer = offerForRelease(commerce.entitlements, commerce.offers, rid, trackIds);
    if (offer) return { offer, label: releaseBuyLabel(offer.release_type ?? item.release_type, offer) };
  }
  return null;
}
