"use client";

import { TrendingCorner } from "@/components/home/trending-corner";
import type { TrendingItem, TrendingSong } from "@/features/trending/api";

/* SAMPLE CONTENT: made-up titles and counts, no covers, so the board needs no API data. */
function song(id: string, title: string, listens: number): TrendingSong {
  return { id, title, duration_ms: 210_000, release_ids: [], teaser_id: null, listens };
}

function pick(id: string, title: string, kind: "TRACK" | "RELEASE", songs: TrendingSong[]): TrendingItem {
  return {
    id,
    kind,
    title,
    track_id: kind === "TRACK" ? songs[0].id : null,
    release_id: null,
    release_title: kind === "RELEASE" ? title : null,
    release_type: kind === "RELEASE" ? "ALBUM" : null,
    released_at: "2026-10-01T00:00:00Z",
    has_cover: false,
    primary_artist_id: null,
    primary_band_id: null,
    // An album's or EP's listens are its songs' together, as the API counts them.
    listens: songs.reduce((sum, s) => sum + s.listens, 0),
    tracks: songs,
  };
}

const ITEMS: TrendingItem[] = [
  pick("s1", "Sample Album", "RELEASE", [song("t1", "One", 9), song("t2", "Two", 5), song("t3", "Three", 4)]),
  pick("s2", "Sample Single", "TRACK", [song("t4", "Sample Single", 753)]),
  pick("s3", "Sample EP", "RELEASE", [song("t5", "Four", 1_204_000), song("t6", "Five", 46_500)]),
  pick("s4", "Quiet Song", "TRACK", [song("t7", "Quiet Song", 0)]),
];

export function TrendingBoard() {
  return (
    <main id="main" data-theme="ember" data-module="home" className="cr-scope min-h-screen bg-[var(--cr-bg)] px-4 py-10 md:px-10">
      <p className="mb-6 text-sm text-fg-muted">Sample content. Trending Corner with the front disc&rsquo;s listens in millions.</p>
      <TrendingCorner items={ITEMS} />
    </main>
  );
}
