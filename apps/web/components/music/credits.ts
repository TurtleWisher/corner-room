"use client";

import { useEffect, useState } from "react";

import { fetchArtists, fetchBands, type ArtistRecord, type BandRecord } from "@/lib/api";

export type Credits = { artists: ArtistRecord[]; bands: BandRecord[] };

/*
 * The app is never reloaded while music plays (the player sits above every page), so a list kept
 * for the whole visit went stale: an artist approved after the first page, or one failed request,
 * showed "Artist not available" until a hard reload (owner, 2026-10-29). Each page now refreshes the
 * lists, showing the last good ones meanwhile, and a failure never replaces a good list.
 */
let last: Credits | null = null;
let inFlight: Promise<Credits> | null = null;

/** Public artist and band lists for naming release and track credits; one request at a time. */
function loadCredits(): Promise<Credits> {
  if (!inFlight) {
    inFlight = Promise.all([
      fetchArtists({ skipAuth: true }).then((p) => p.items).catch(() => last?.artists ?? []),
      fetchBands({ skipAuth: true }).then((p) => p.items).catch(() => last?.bands ?? []),
    ])
      .then(([artists, bands]) => (last = { artists, bands }))
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Names fall back to "Not available" in the UI when a list fails; it never blocks the page. */
export function useCredits(): Credits {
  const [credits, setCredits] = useState<Credits>(() => last ?? { artists: [], bands: [] });
  useEffect(() => {
    let alive = true;
    void loadCredits().then((c) => alive && setCredits(c));
    return () => {
      alive = false;
    };
  }, []);
  return credits;
}

/** Test hook: forget the lists between tests. */
export function resetCreditsForTest(): void {
  last = null;
  inFlight = null;
}
