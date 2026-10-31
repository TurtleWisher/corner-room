/*
 * Putting a song's credits in order by dragging (owner, 2026-10-31, D-CREDITS-04). A new order of
 * the same credits goes live with no staff review; the API checks that nothing else changed.
 * Pure helpers: whether only the order changed, where a dragged credit lands, and the move itself.
 */

import type { StudioCredit } from "@/features/studio/api";

function creditKey(c: StudioCredit): string {
  const text = (v?: string | null) => (v ?? "").trim() || null;
  return JSON.stringify([c.role_key, c.artist_id || null, text(c.display_name), text(c.instrument), c.part_of_artist_id || null, c.part_of_artist_id ? null : text(c.part_of_name)]);
}

/** True when `rows` are exactly the live credits, listed in another order. */
export function onlyCreditOrderChanged(rows: StudioCredit[], live: StudioCredit[]): boolean {
  const a = rows.map(creditKey);
  const b = live.map(creditKey);
  if (a.length !== b.length || a.every((k, i) => k === b[i])) return false;
  return [...a].sort().join("\n") === [...b].sort().join("\n");
}

/** The list with the item at `from` moved to `to` (others shift up or down). */
export function moveTo<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Where a dragged row lands: the number of other rows whose middle is above the pointer. */
export function dropIndex(middles: number[], from: number, pointerY: number): number {
  return middles.filter((mid, i) => i !== from && mid < pointerY).length;
}

/**
 * How far another row slides to make room while one is dragged from `from` towards `to`; `size`
 * is the dragged row's height plus the gap. Rows stay in place in the page until the drop.
 */
export function makeRoom(index: number, from: number, to: number, size: number): number {
  if (index === from) return 0;
  if (from < to && index > from && index <= to) return -size;
  if (from > to && index >= to && index < from) return size;
  return 0;
}
