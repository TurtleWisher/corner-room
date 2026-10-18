/* Tracks, releases, versions and credits. Split from lib/api.ts (Phase 16, Stage 5). */

import { type Page } from "@/features/identity/api";
import { apiFetch } from "@/lib/api/client";
import type { MediaReport } from "@/lib/media-report-view";

export type TrackRecord = {
  id: string;
  title: string;
  isrc?: string | null;
  status: string;
  primary_artist_id?: string | null;
  primary_band_id?: string | null;
  primary_org_id?: string | null;
  metadata?: Record<string, unknown> | null;
  version?: number;
  /** Released albums/EPs/singles the song is on (single-track reads, D-AUDIO-12). */
  release_ids?: string[];
};

export type ReleaseRecord = {
  id: string;
  title: string;
  release_type: string;
  status: string;
  primary_artist_id?: string | null;
  primary_band_id?: string | null;
  primary_org_id?: string | null;
  cover_asset_id?: string | null;
  release_at?: string | null;
  metadata?: Record<string, unknown> | null;
  version?: number;
};

export type ReleaseTrackRecord = {
  release_id: string;
  track_id: string;
  position: number;
};

export type CreditRecord = {
  id: string;
  track_id?: string | null;
  release_id?: string | null;
  artist_id?: string | null;
  user_id?: string | null;
  credit_role: string;
};

export type TrackVersionRecord = {
  id: string;
  track_id: string;
  version_type: string;
  media_asset_id?: string | null;
  duration_ms?: number | null;
  status: string;
  is_current: boolean;
  version: number;
  processing_detail?: string | null;
};

export async function fetchTracks(opts?: { skipAuth?: boolean }): Promise<Page<TrackRecord>> {
  return apiFetch<Page<TrackRecord>>("/api/v1/tracks", {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function fetchTrack(id: string, opts?: { skipAuth?: boolean }): Promise<TrackRecord> {
  return apiFetch<TrackRecord>(`/api/v1/tracks/${id}`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function createTrack(body: { title: string; isrc?: string }): Promise<TrackRecord> {
  return apiFetch<TrackRecord>("/api/v1/tracks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionTrack(id: string, action: string, version?: number): Promise<TrackRecord> {
  return apiFetch<TrackRecord>(`/api/v1/tracks/${id}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function createTrackVersion(id: string): Promise<TrackVersionRecord> {
  return apiFetch<TrackVersionRecord>(`/api/v1/tracks/${id}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version_type: "MASTER" }),
    retry: false,
  });
}

export async function fetchTrackVersions(id: string): Promise<{ items: TrackVersionRecord[] }> {
  return apiFetch<{ items: TrackVersionRecord[] }>(`/api/v1/tracks/${id}/versions`);
}

export async function fetchMediaReport(trackId: string, versionId: string): Promise<MediaReport> {
  return apiFetch<MediaReport>(`/api/v1/tracks/${trackId}/versions/${versionId}/media-report`);
}

export async function transitionTrackVersion(
  trackId: string,
  versionId: string,
  action: string,
  version?: number,
): Promise<TrackVersionRecord> {
  return apiFetch<TrackVersionRecord>(`/api/v1/tracks/${trackId}/versions/${versionId}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function addTrackCredit(id: string, credit_role: string, artist_id?: string): Promise<CreditRecord> {
  return apiFetch<CreditRecord>(`/api/v1/tracks/${id}/credits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credit_role, artist_id }),
    retry: false,
  });
}

export async function fetchTrackCredits(id: string, opts?: { skipAuth?: boolean }): Promise<{ items: CreditRecord[] }> {
  return apiFetch<{ items: CreditRecord[] }>(`/api/v1/tracks/${id}/credits`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function fetchReleases(opts?: { skipAuth?: boolean }): Promise<Page<ReleaseRecord>> {
  return apiFetch<Page<ReleaseRecord>>("/api/v1/releases", {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function fetchRelease(id: string, opts?: { skipAuth?: boolean }): Promise<ReleaseRecord> {
  return apiFetch<ReleaseRecord>(`/api/v1/releases/${id}`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function createRelease(body: { title: string; release_type: string }): Promise<ReleaseRecord> {
  return apiFetch<ReleaseRecord>("/api/v1/releases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionRelease(id: string, action: string, version?: number): Promise<ReleaseRecord> {
  return apiFetch<ReleaseRecord>(`/api/v1/releases/${id}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function fetchReleaseTracks(
  id: string,
  opts?: { skipAuth?: boolean },
): Promise<{ items: ReleaseTrackRecord[] }> {
  return apiFetch<{ items: ReleaseTrackRecord[] }>(`/api/v1/releases/${id}/tracks`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function addReleaseTrack(id: string, track_id: string, position: number): Promise<ReleaseTrackRecord> {
  return apiFetch<ReleaseTrackRecord>(`/api/v1/releases/${id}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track_id, position }),
    retry: false,
  });
}
