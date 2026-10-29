import { describe, expect, it, vi } from "vitest";

import { fetchAllPages, pagePath } from "./all-pages";

describe("fetchAllPages", () => {
  it("reads every page, not just the first", async () => {
    const pages: Record<string, { items: number[]; next_cursor: string | null }> = {
      first: { items: [1, 2], next_cursor: "b" },
      b: { items: [3], next_cursor: "c" },
      c: { items: [4], next_cursor: null },
    };
    const fetchPage = vi.fn(async (cursor: string | null) => pages[cursor ?? "first"]);
    expect(await fetchAllPages(fetchPage)).toEqual([1, 2, 3, 4]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("stops when the server repeats a cursor or at the page limit", async () => {
    expect(await fetchAllPages(async () => ({ items: [1], next_cursor: "same" }))).toEqual([1, 1]);
    let n = 0;
    expect(await fetchAllPages(async () => ({ items: [n], next_cursor: String(++n) }), 3)).toEqual([0, 1, 2]);
  });

  it("builds the page path with the largest page size", () => {
    expect(pagePath("/api/v1/offers", null)).toBe("/api/v1/offers?limit=100");
    expect(pagePath("/api/v1/offers", "a b")).toBe("/api/v1/offers?limit=100&cursor=a+b");
  });
});
