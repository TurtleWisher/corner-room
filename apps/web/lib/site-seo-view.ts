/*
 * What search engines are told about the site (owner, 2026-11-01, D-SEO-01): its address, the
 * public pages in the sitemap and who the site belongs to. Account, Studio and staff pages are never
 * listed. Pure, so it is tested; app/robots.ts, app/sitemap.ts and the home page use it.
 */

/** The public address. NEXT_PUBLIC_SITE_URL can point a private copy elsewhere. */
export function siteUrl(env: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): string {
  return (env?.trim() || "https://www.cornerroom.live").replace(/\/+$/, "");
}

/** Public pages anyone can open, signed in or not. */
export const PUBLIC_PAGES = ["/", "/events", "/listen", "/artists", "/releases", "/tracks", "/store", "/terms", "/privacy", "/refunds"] as const;

export type PublicLists = {
  artists: readonly { id: string; kind?: "SOLO" | "BAND" | null }[];
  releases: readonly { id: string }[];
  tracks: readonly { id: string }[];
  events: readonly { id: string }[];
};

export type SitemapEntry = { url: string; changeFrequency: "daily" | "weekly" | "monthly"; priority: number };

/** The sitemap: the public pages, then each public artist, band, release, song and event page. */
export function sitemapEntries(site: string, lists: PublicLists): SitemapEntry[] {
  const out: SitemapEntry[] = PUBLIC_PAGES.map((path) => ({
    url: `${site}${path === "/" ? "" : path}`,
    changeFrequency: path === "/" || path === "/events" ? "daily" : ["/terms", "/privacy", "/refunds"].includes(path) ? "monthly" : "weekly",
    priority: path === "/" ? 1 : 0.7,
  }));
  const add = (path: string, changeFrequency: SitemapEntry["changeFrequency"]) => out.push({ url: `${site}${path}`, changeFrequency, priority: 0.5 });
  for (const a of lists.artists) add(a.kind === "BAND" ? `/bands/${a.id}` : `/artists/${a.id}`, "weekly");
  for (const r of lists.releases) add(`/releases/${r.id}`, "weekly");
  for (const t of lists.tracks) add(`/tracks/${t.id}`, "weekly");
  for (const e of lists.events) add(`/events/${e.id}`, "daily");
  const seen = new Set<string>();
  return out.filter((e) => !seen.has(e.url) && Boolean(seen.add(e.url)));
}

/**
 * Who the site belongs to, for search engines (schema.org Organization). `sameAs` lists only
 * profiles the owner has confirmed; none yet.
 */
export function organizationJsonLd(site: string, sameAs: readonly string[] = []): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Corner Room",
    url: `${site}/`,
    logo: `${site}/brand/icons/corner-room-icon-512.png`,
    ...(sameAs.length ? { sameAs } : {}),
  };
}
