import type { MetadataRoute } from "next";

import { siteUrl, sitemapEntries, type PublicLists } from "@/lib/site-seo-view";

/*
 * The public pages for search engines (owner, 2026-11-01, D-SEO-01): the fixed pages, plus each
 * public artist, band, release, song and event as a guest sees them (one page of each list, read at
 * most once an hour). If the API cannot be reached the fixed pages are still listed.
 */
export const dynamic = "force-dynamic";

async function guestList<T>(path: string, base: string): Promise<T[]> {
  try {
    const res = await fetch(`${base}${path}${path.includes("?") ? "&" : "?"}limit=100`, {
      headers: { accept: "application/json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const page = (await res.json()) as { items?: T[] };
    return Array.isArray(page.items) ? page.items : [];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = siteUrl();
  // On the server the API answers on the site's own address (NEXT_PUBLIC_API_URL is empty there).
  const base = (process.env.NEXT_PUBLIC_API_URL || site).replace(/\/+$/, "");
  const [artists, releases, tracks, events] = await Promise.all([
    guestList<PublicLists["artists"][number]>("/api/v1/artists", base),
    guestList<{ id: string }>("/api/v1/releases", base),
    guestList<{ id: string }>("/api/v1/tracks", base),
    guestList<{ id: string }>("/api/v1/events", base),
  ]);
  return sitemapEntries(site, { artists, releases, tracks, events });
}
