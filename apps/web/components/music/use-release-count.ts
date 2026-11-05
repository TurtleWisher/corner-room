"use client";

import { useEffect } from "react";

import { countPresale } from "@/features/presales/api";
import { firstOpenInTab, referrerSite, shareSource, takePlace } from "@/lib/presale-campaign-view";

/**
 * One page open for the release's live numbers (D-PRESALE-04), on the pre-sale page and, once it
 * is out, on the release page: once per tab, with the share link code and the referring site's
 * name only. Pass null until the page knows what it is showing (and who is signed in).
 */
export function useReleaseOpenCount(releaseId: string | null): void {
  useEffect(() => {
    if (!releaseId) return;
    const place = takePlace(releaseId);
    if (!firstOpenInTab(releaseId)) return;
    countPresale(releaseId, {
      kind: "view",
      place,
      source: shareSource(window.location.search),
      referrer: referrerSite(document.referrer),
    });
  }, [releaseId]);
}
