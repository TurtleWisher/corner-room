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
