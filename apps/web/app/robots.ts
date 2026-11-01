import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-seo-view";

/* Crawlers may read everything public and find the pages in the sitemap (owner, 2026-11-01, D-SEO-01). */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${siteUrl()}/sitemap.xml` };
}
