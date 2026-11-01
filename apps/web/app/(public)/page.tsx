import type { Metadata } from "next";

import { HomeView } from "@/components/home/home-view";
import { organizationJsonLd, siteUrl } from "@/lib/site-seo-view";

export const metadata: Metadata = {
  title: "Corner Room",
  description: "Live events, artists and the listening room, from one corner of the city.",
};

/* Role-adaptive home (Phase 16, Stage 5). The guest view is the brand hero plus the next event;
   signed-in users also get their shortcuts. */
export default function HomePage() {
  // Who the site belongs to, for search engines (D-SEO-01). A data block: never executed.
  const org = JSON.stringify(organizationJsonLd(siteUrl())).replace(/</g, "\\u003c");
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: org }} />
      <HomeView />
    </>
  );
}
