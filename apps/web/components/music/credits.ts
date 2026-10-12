"use client";

import { useEffect, useState } from "react";

import { fetchArtists, fetchBands, type ArtistRecord, type BandRecord } from "@/lib/api";

export type Credits = { artists: ArtistRecord[]; bands: BandRecord[] };

let cache: Promise<Credits> | null = null;

/** Public artist and band lists, loaded once per page view, for naming release and track credits. */
function loadCredits(): Promise<Credits> {
  if (!cache) {
    cache = Promise.all([
      fetchArtists({ skipAuth: true }).then((p) => p.items).catch(() => [] as ArtistRecord[]),
      fetchBands({ skipAuth: true }).then((p) => p.items).catch(() => [] as BandRecord[]),
    ]).then(([artists, bands]) => ({ artists, bands }));
  }
  return cache;
}

/** Names fall back to "Not available" in the UI when a list fails; it never blocks the page. */
export function useCredits(): Credits {
  const [credits, setCredits] = useState<Credits>({ artists: [], bands: [] });
  useEffect(() => {
    let alive = true;
    void loadCredits().then((c) => alive && setCredits(c));
    return () => {
      alive = false;
    };
  }, []);
  return credits;
}
