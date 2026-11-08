/* Trending Corner (owner, 2026-11-08, D-TRENDING-01). Staff pick the music by hand; the API decides
 * what is public (released music only) and counts sales and listens. The web app only shows it. */

import { apiFetch } from "@/lib/api/client";

export type TrendingKind = "TRACK" | "RELEASE";

export type TrendingSong = {
  id: string;
  title: string;
  duration_ms: number | null;
  /** Released releases the song is on: buying one of them owns the song. */
  release_ids: string[];
  /** Its newest published teaser, for anyone who hasn't bought it. */
  teaser_id: string | null;
  listens: number;
};

export type TrendingItem = {
  /** The pick's own id. */
  id: string;
  kind: TrendingKind;
  title: string;
  track_id: string | null;
  /** The release that gives the cover (the release itself, or the first one a song is out on). */
  release_id: string | null;
  release_title: string | null;
  release_type: string | null;
  released_at: string | null;
  has_cover: boolean;
  primary_artist_id: string | null;
  primary_band_id: string | null;
  listens: number;
  tracks: TrendingSong[];
};

/** Anyone, no account. */
export async function fetchTrending(): Promise<TrendingItem[]> {
  const page = await apiFetch<{ items: TrendingItem[] }>("/api/v1/trending", { retry: false, skipAuth: true, skipRefresh: true });
  return page.items;
}

export type StaffTrendingEntry = {
  kind: TrendingKind;
  id: string;
  title: string;
  release_type: string | null;
  release_id: string | null;
  has_cover: boolean;
  primary_artist_id: string | null;
  primary_band_id: string | null;
  /** Still released and not deleted: only these show on the home page. */
  is_out: boolean;
  listens: number;
  /** Things sold (counts, never money). */
  sold: number;
  refunded: number;
};

export type StaffTrending = {
  picks: (StaffTrendingEntry & { pick_id: string })[];
  candidates: (StaffTrendingEntry & { picked: boolean })[];
  max_picks: number;
};

const json = { "Content-Type": "application/json" };

export function fetchStaffTrending(q?: string): Promise<StaffTrending> {
  const query = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  return apiFetch<StaffTrending>(`/api/v1/staff/trending${query}`);
}

export function addTrendingPick(kind: TrendingKind, id: string): Promise<StaffTrending> {
  return apiFetch<StaffTrending>("/api/v1/staff/trending", { method: "POST", headers: json, body: JSON.stringify({ kind, id }) });
}

export function orderTrendingPicks(pickIds: string[]): Promise<StaffTrending> {
  return apiFetch<StaffTrending>("/api/v1/staff/trending/order", { method: "PUT", headers: json, body: JSON.stringify({ pick_ids: pickIds }) });
}

export function removeTrendingPick(pickId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/staff/trending/${pickId}`, { method: "DELETE" });
}
