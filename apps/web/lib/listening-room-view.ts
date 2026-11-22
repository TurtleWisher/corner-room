/*
 * The listening room (owner direction 2026-10-14, replacing the corridor): a dedicated
 * full-screen room with a centred 3D carousel, the playing cover blurred across the whole
 * screen, and a focus view for one song whose previous and next covers slide in only when a
 * mouse nears the left or right edge. Pure helpers, so layout decisions are tested.
 */

/** Carousel offsets from the playing card: 0 is in front; ±3 are drawn only so movement animates. */
export type CarouselOffset = -3 | -2 | -1 | 0 | 1 | 2 | 3;

export type CarouselItem<T> = { item: T; queueIndex: number; offset: CarouselOffset };

/** Offsets that are seen and can be chosen (the outer pair only animates in and out). */
export function isVisibleOffset(offset: CarouselOffset): boolean {
  return Math.abs(offset) <= 2;
}

/**
 * The queue items around the playing position, each with its offset. Keyed by queue position,
 * so moving one track turns every card one place instead of re-creating it.
 */
export function carouselWindow<T>(queue: readonly T[], index: number): CarouselItem<T>[] {
  const out: CarouselItem<T>[] = [];
  for (let offset = -3; offset <= 3; offset += 1) {
    const queueIndex = index + offset;
    if (queueIndex < 0 || queueIndex >= queue.length) continue;
    out.push({ item: queue[queueIndex], queueIndex, offset: offset as CarouselOffset });
  }
  return out;
}

/**
 * Where a card sits at a distance `d` (in cards, may be fractional) from the front, for the
 * spinning carousel (owner, 2026-11-22). The same places as the stylesheet's per-offset rules,
 * blended between them so a card glides continuously: `tx` in card widths (right is +), `tz` in px,
 * `ry` in degrees, `s` scale, `o` opacity, `dim` the dark veil. Narrow rooms show one card a side.
 */
export type SlotPose = { tx: number; tz: number; ry: number; s: number; o: number; dim: number };

const POSES: readonly SlotPose[] = [
  { tx: 0, tz: 0, ry: 0, s: 1, o: 1, dim: 0 },
  { tx: 0.6, tz: -120, ry: 16, s: 0.84, o: 1, dim: 0.3 },
  { tx: 1.05, tz: -240, ry: 24, s: 0.7, o: 1, dim: 0.55 },
  { tx: 1.4, tz: -340, ry: 28, s: 0.58, o: 0, dim: 0.55 },
];

export function slotPose(d: number, wide: boolean): SlotPose {
  const a = Number.isFinite(d) ? Math.min(Math.abs(d), POSES.length - 1) : POSES.length - 1;
  const i = Math.min(Math.floor(a), POSES.length - 2);
  const f = a - i;
  const lo = POSES[i];
  const hi = POSES[i + 1];
  const mix = (k: keyof SlotPose) => lo[k] + (hi[k] - lo[k]) * f;
  const sign = d < 0 ? -1 : 1;
  // Narrow rooms: the second card a side is never seen, so it fades out between places 1 and 2.
  const o = wide ? mix("o") : a <= 1 ? 1 : Math.max(0, 2 - a);
  const r = (v: number) => Math.round(v * 1000) / 1000 || 0;
  return { tx: r(sign * mix("tx")), tz: r(mix("tz")), ry: r(-sign * mix("ry")), s: r(mix("s")), o: r(o), dim: r(mix("dim")) };
}

/** Spin speed, in cards a second, just outside the front card and at a card and a half out. */
export const SPIN_SPEED_MIN = 1.2;
export const SPIN_SPEED_MAX = 3.5;
/** How long, in ms, the carousel waits after the mouse leaves before gliding back to the playing song. */
export const SPIN_RETURN_MS = 1200;

/**
 * How fast the carousel spins for a mouse at `x` (owner, 2026-11-22: it spins through its cards
 * toward the pointer, each next one coming to the front, to the last card). Nothing while the
 * mouse is over the front card; beside it, from `SPIN_SPEED_MIN` rising to `SPIN_SPEED_MAX` a card
 * further out. In cards a second, right is + (toward the later songs).
 */
export function pointerDrive(x: number, centre: number, cardWidth: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(centre) || !(cardWidth > 0)) return 0;
  const away = (x - centre) / cardWidth;
  const beyond = Math.abs(away) - 0.45;
  if (beyond <= 0) return 0;
  const t = Math.min(1, beyond);
  return Math.sign(away) * Math.round((SPIN_SPEED_MIN + (SPIN_SPEED_MAX - SPIN_SPEED_MIN) * t * t) * 1000) / 1000;
}

/** Where the carousel is heading after `dt` seconds of spinning at `drive`, kept between the first and last card. */
export function spinTarget(target: number, drive: number, dt: number, last: number): number {
  return Math.max(0, Math.min(Math.max(0, last), target + drive * Math.max(0, dt)));
}

/** The carousel's spring: a little under critical, so it flows in and settles without a wobble. */
export const SPIN_STIFFNESS = 150;
export const SPIN_DAMPING = 21;

export type Spring = { x: number; v: number };

/**
 * One step of the spring toward `target` over `dt` seconds, in small fixed steps so a slow frame
 * never overshoots. Comes to rest exactly on the target once it is close and slow.
 */
export function springStep(state: Spring, target: number, dt: number): Spring & { rest: boolean } {
  let { x, v } = state;
  let left = Math.max(0, Math.min(dt, 1 / 20));
  while (left > 0) {
    const h = Math.min(left, 1 / 240);
    v += (-SPIN_STIFFNESS * (x - target) - SPIN_DAMPING * v) * h;
    x += v * h;
    left -= h;
  }
  const rest = Math.abs(x - target) < 0.0005 && Math.abs(v) < 0.005;
  return rest ? { x: target, v: 0, rest } : { x, v, rest };
}

/** How close to a side, in px, a mouse must come before the focus view shows that neighbour. */
export const EDGE_ZONE_PX = 140;

/** Which edge a pointer at `x` is near, in a room `width` px wide. */
export function edgeZone(x: number, width: number, zone = EDGE_ZONE_PX): "left" | "right" | null {
  if (!Number.isFinite(x) || width <= 0) return null;
  const z = Math.min(zone, width / 4);
  if (x <= z) return "left";
  if (x >= width - z) return "right";
  return null;
}

/** "Track 2 of 5" when there is a list to be in; nothing for a single track. */
export function queuePositionLabel(index: number, length: number): string | null {
  return length > 1 ? `Track ${index + 1} of ${length}` : null;
}

/** What a screen reader hears when the track changes. */
export function nowPlayingAnnouncement(title: string, artist?: string | null): string {
  return artist ? `Now playing ${title} by ${artist}` : `Now playing ${title}`;
}

/** Horizontal swipe: a deliberate, mostly sideways move of at least 48 px. */
export const SWIPE_MIN_PX = 48;

export function swipeDirection(dx: number, dy: number): "next" | "previous" | null {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? "next" : "previous";
}

/**
 * Where to go when the listener leaves the room: back to the listening-room page they came from
 * in this visit, else Listen (the room was opened straight from a link or a reload).
 */
export function leaveTarget(cameFrom: string | null): "back" | "/listen" {
  return cameFrom ? "back" : "/listen";
}

/**
 * The small line above the title: where the music came from, and the position in Up next. A single
 * named after its only song is not repeated (owner, 2026-10-27: "From Chaya Pore · Chaya Pore"); a
 * title track on a longer EP or album still says where it came from.
 */
export function roomEyebrow(
  source: string | null | undefined,
  title: string,
  position: string | null | undefined,
  queueLength = 0,
): string {
  const sameAsSong = !!source && source.trim().toLowerCase() === title.trim().toLowerCase() && queueLength <= 1;
  const from = source && !sameAsSong ? `From ${source}` : "Listening room";
  return [from, position].filter(Boolean).join(" · ");
}

/*
 * The title is the way to the song page (owner, 2026-11-01, D-ROOM-03): pointing at it breaks it
 * into charged pieces that scatter a little and settle back, humming while the pointer stays.
 */

/** One piece of the title: its text and where it drifts to (em and degrees), with its delay. */
export type TitleAtom = { text: string; space: boolean; dx: number; dy: number; turn: number; delayMs: number };

/** Plain Latin letters split one by one; other scripts (Bangla) stay whole words, because
 * splitting them would pull joined letters apart. */
const LETTERS = /^[\x20-\x7e -ɏ]*$/;

/** A fixed pseudo-random number in [-1, 1) for piece `i`, so the scatter is the same each time. */
function wobble(i: number, salt: number): number {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

export function titleAtoms(title: string): TitleAtom[] {
  const letters = LETTERS.test(title);
  const parts = letters ? Array.from(title) : title.split(/(\s+)/).filter(Boolean);
  let n = 0;
  return parts.map((text) => {
    if (/^\s+$/.test(text)) return { text: " ", space: true, dx: 0, dy: 0, turn: 0, delayMs: 0 };
    const i = n++;
    return {
      text,
      space: false,
      dx: Math.round(wobble(i, 1) * 0.12 * 1000) / 1000,
      dy: Math.round(wobble(i, 2) * 0.22 * 1000) / 1000,
      turn: Math.round(wobble(i, 3) * 14),
      delayMs: i * 28,
    };
  });
}
