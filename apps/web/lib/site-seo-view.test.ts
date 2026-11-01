import { describe, expect, it } from "vitest";

import { PUBLIC_PAGES, organizationJsonLd, siteUrl, sitemapEntries } from "./site-seo-view";

describe("search engines (D-SEO-01)", () => {
  it("uses the live address unless a private copy names its own", () => {
    expect(siteUrl(undefined)).toBe("https://www.cornerroom.live");
    expect(siteUrl(" ")).toBe("https://www.cornerroom.live");
    expect(siteUrl("https://staging.cornerroom.live/")).toBe("https://staging.cornerroom.live");
  });

  it("lists the public pages and each public profile, release, song and event, once", () => {
    const urls = sitemapEntries("https://x.test", {
      artists: [{ id: "a1", kind: "SOLO" }, { id: "b1", kind: "BAND" }, { id: "a1", kind: "SOLO" }],
      releases: [{ id: "r1" }],
      tracks: [{ id: "t1" }],
      events: [{ id: "e1" }],
    }).map((e) => e.url);
    expect(urls[0]).toBe("https://x.test");
    expect(urls).toContain("https://x.test/artists/a1");
    expect(urls).toContain("https://x.test/bands/b1");
    expect(urls).toContain("https://x.test/releases/r1");
    expect(urls).toContain("https://x.test/tracks/t1");
    expect(urls).toContain("https://x.test/events/e1");
    expect(urls.filter((u) => u.endsWith("/artists/a1"))).toHaveLength(1);
    expect(urls).toHaveLength(PUBLIC_PAGES.length + 5);
  });

  it("never lists account, Studio or staff pages", () => {
    const urls = sitemapEntries("https://x.test", { artists: [], releases: [], tracks: [], events: [] }).map((e) => e.url);
    for (const url of urls) expect(url).not.toMatch(/\/(account|studio|staff|login|checkout|orders|tickets|library|history|playlists)/);
  });

  it("names the site's owner with the official tile, and no invented profiles", () => {
    const org = organizationJsonLd("https://x.test");
    expect(org).toMatchObject({ "@type": "Organization", name: "Corner Room", url: "https://x.test/", logo: "https://x.test/brand/icons/corner-room-icon-512.png" });
    expect(org).not.toHaveProperty("sameAs");
  });
});
