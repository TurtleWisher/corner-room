/*
 * Public lists the whole app names things from (prices, artists, bands) come in pages of at most
 * 100. Reading only the first page hid everything after it: older songs showed "Not on sale yet"
 * and older artists "Artist not available" once a list grew (owner, 2026-10-30). This reads every
 * page, newest first, up to a safety limit.
 */

export type CursorPage<T> = { items: T[]; next_cursor: string | null };

/** Largest page the list endpoints serve. */
export const PAGE_SIZE = 100;

/** Every item across pages. Stops at `maxPages` so a server that keeps answering can't loop forever. */
export async function fetchAllPages<T>(fetchPage: (cursor: string | null) => Promise<CursorPage<T>>, maxPages = 50): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result: CursorPage<T> = await fetchPage(cursor);
    items.push(...result.items);
    if (!result.next_cursor || result.next_cursor === cursor) break;
    cursor = result.next_cursor;
  }
  return items;
}

/** "/api/v1/offers" + page size and cursor. */
export function pagePath(path: string, cursor: string | null): string {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) query.set("cursor", cursor);
  return `${path}?${query.toString()}`;
}
