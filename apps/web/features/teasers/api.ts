/* Teasers (owner, 2026-11-07, D-TEASER-00 to D-TEASER-04). The API decides everything: who may edit,
 * what is public, what a listener can do next. The web app only sends what the artist chose and
 * what happened (a start, a full listen), and shows what comes back.
 *
 * Teaser audio never comes from the song's playback routes, and listening to a teaser never opens a
 * listening session or reports a play. */

import { apiFetch, getAccessToken, getApiBaseUrl } from "@/lib/api/client";

export type TeaserStatus = "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "UNPUBLISHED";
export type TeaserVersionStatus = "DRAFT" | "PROCESSING" | "READY" | "FAILED";
export type TeaserReviewStatus = "WAITING" | "APPROVED" | "RETURNED" | "WITHDRAWN";
export type TeaserAction = "process" | "submit" | "withdraw" | "unpublish" | "republish" | "delete";

export type TeaserSettings = {
  start_ms: number;
  end_ms: number;
  fade_in_ms: number;
  fade_out_ms: number;
  /** Hundredths of a dB. */
  gain_cdb: number;
};

export type TeaserVersionRecord = TeaserSettings & {
  id: string;
  number: number;
  status: TeaserVersionStatus;
  failure_code: string | null;
  duration_ms: number | null;
  review_status: TeaserReviewStatus | null;
  review_note: string | null;
  submitted_at: string | null;
  published_at: string | null;
  retired_at: string | null;
  is_live: boolean;
  created_at: string;
};

export type TeaserCounts = { starts: number; completes: number; prompt_clicks: number };

export type TeaserLimits = {
  min_ms: number;
  max_ms: number;
  fade_max_ms: number;
  gain_min_cdb: number;
  gain_max_cdb: number;
};

export type TeaserDetailRecord = {
  id: string;
  title: string | null;
  status: TeaserStatus;
  track_id: string;
  track_title: string;
  track_status: string;
  release_id: string;
  release_title: string;
  published_at: string | null;
  master: { version_id: string | null; status: string | null; duration_ms: number | null; processing_detail: string | null };
  /** Newest first. */
  versions: TeaserVersionRecord[];
  latest_version_id: string | null;
  actions: TeaserAction[];
  limits: TeaserLimits;
  counts: TeaserCounts;
};

export type TeaserRowRecord = {
  id: string;
  title: string | null;
  status: TeaserStatus;
  live_duration_ms: number | null;
  latest_status: TeaserVersionStatus | null;
  latest_review_status: TeaserReviewStatus | null;
  latest_review_note: string | null;
  counts: TeaserCounts;
};

export type ReleaseTeasersRecord = {
  release_id: string;
  release_title: string;
  release_status: string;
  songs: {
    track_id: string;
    title: string;
    track_status: string;
    master_status: string | null;
    master_duration_ms: number | null;
    teasers: TeaserRowRecord[];
  }[];
};

export type WaveformRecord = {
  status: "READY" | "PENDING" | "FAILED";
  track_version_id: string;
  /** Peak per bucket, 0 to 255. */
  points: number[];
  bucket_ms: number;
  duration_ms: number | null;
};

export type TeaserAudioRecord = {
  url: string;
  expires_at: string;
  codec: string | null;
  alternates: { codec: string; url: string }[];
  duration_ms: number | null;
  gain_db?: number | null;
};

export type NextStepKind = "OWNED" | "BUY" | "BUY_RELEASE" | "PREBOOK" | "NONE";

export type TeaserSummary = { id: string; title: string | null; duration_ms: number | null };

export type PublicTeaserRecord = {
  id: string;
  title: string | null;
  track_id: string;
  track_title: string;
  track_released: boolean;
  release_id: string;
  release_title: string;
  release_at: string | null;
  artist: string | null;
  artist_kind: "artist" | "band" | null;
  artist_id: string | null;
  /** Present once the song is out, or the artist revealed the cover early (D-TEASER-04). */
  cover_url: string | null;
  duration_ms: number | null;
  published_at: string | null;
  next_step: { kind: NextStepKind; track_id: string; release_id: string };
  other_teasers: TeaserSummary[];
};

export type TeaserQueueItem = {
  teaser_id: string;
  version_id: string;
  number: number;
  title: string | null;
  track_id: string;
  track_title: string;
  track_status: string;
  profile_name: string | null;
  start_ms: number;
  end_ms: number;
  duration_ms: number | null;
  submitted_at: string | null;
  replaces_live: boolean;
};

const json = { "Content-Type": "application/json" };

function accepting(accept?: readonly string[]): string {
  return accept && accept.length > 0 ? `?accept=${encodeURIComponent(accept.join(","))}` : "";
}

// --- Studio ---------------------------------------------------------------------------------------

export function fetchReleaseTeasers(releaseId: string): Promise<ReleaseTeasersRecord> {
  return apiFetch(`/api/v1/studio/releases/${releaseId}/teasers`, { retry: false });
}

export function createTeaser(trackId: string, title?: string | null): Promise<TeaserDetailRecord> {
  return apiFetch(`/api/v1/studio/tracks/${trackId}/teasers`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ title: title ?? null }),
  });
}

export function fetchTeaser(teaserId: string): Promise<TeaserDetailRecord> {
  return apiFetch(`/api/v1/studio/teasers/${teaserId}`, { retry: false });
}

export function renameTeaser(teaserId: string, title: string | null): Promise<TeaserDetailRecord> {
  return apiFetch(`/api/v1/studio/teasers/${teaserId}`, { method: "PATCH", headers: json, body: JSON.stringify({ title }) });
}

export function saveTeaserDraft(teaserId: string, settings: TeaserSettings): Promise<TeaserDetailRecord> {
  return apiFetch(`/api/v1/studio/teasers/${teaserId}/draft`, { method: "PUT", headers: json, body: JSON.stringify(settings) });
}

export function processTeaser(teaserId: string): Promise<TeaserDetailRecord> {
  return apiFetch(`/api/v1/studio/teasers/${teaserId}/process`, { method: "POST" });
}

export function transitionTeaser(
  teaserId: string,
  action: "submit" | "withdraw" | "unpublish" | "republish",
): Promise<TeaserDetailRecord> {
  return apiFetch(`/api/v1/studio/teasers/${teaserId}/transition`, { method: "POST", headers: json, body: JSON.stringify({ action }) });
}

export function deleteTeaser(teaserId: string): Promise<void> {
  return apiFetch(`/api/v1/studio/teasers/${teaserId}`, { method: "DELETE" });
}

export function fetchWaveform(trackId: string): Promise<WaveformRecord> {
  return apiFetch(`/api/v1/studio/tracks/${trackId}/waveform`, { retry: false });
}

/** The song's playback copy for editing (never the master). */
export function fetchStudioSongAudio(trackId: string, accept?: readonly string[]): Promise<TeaserAudioRecord> {
  return apiFetch(`/api/v1/studio/tracks/${trackId}/listen${accepting(accept)}`, { retry: false });
}

/** A made version, exactly as fans will hear it. Also used by staff reviewers. */
export function fetchStudioVersionAudio(teaserId: string, versionId: string, accept?: readonly string[]): Promise<TeaserAudioRecord> {
  return apiFetch(`/api/v1/studio/teasers/${teaserId}/versions/${versionId}/listen${accepting(accept)}`, { retry: false });
}

// --- Staff review (D-TEASER-01) ---------------------------------------------------------------------

export function fetchTeaserQueue(): Promise<TeaserQueueItem[]> {
  return apiFetch("/api/v1/catalog-intake/teasers", { retry: false });
}

export function reviewTeaser(
  teaserId: string,
  action: "approve" | "return" | "unpublish",
  note?: string | null,
): Promise<{ teaser_id: string; status: TeaserStatus }> {
  return apiFetch(`/api/v1/catalog-intake/teasers/${teaserId}/review`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ action, note: note ?? null }),
  });
}

// --- Public (no account needed, D-TEASER-02) ------------------------------------------------------

/** Sent with the signed-in token when there is one, only so the API can say "you own this song". */
export function fetchPublicTeaser(teaserId: string, opts?: { signedIn?: boolean }): Promise<PublicTeaserRecord> {
  return apiFetch(`/api/v1/teasers/${teaserId}`, {
    retry: false,
    skipAuth: !opts?.signedIn,
    skipRefresh: !opts?.signedIn,
  });
}

export async function fetchTrackTeasers(trackId: string): Promise<TeaserSummary[]> {
  const page = await apiFetch<{ items: TeaserSummary[] }>(`/api/v1/tracks/${trackId}/teasers`, {
    retry: false,
    skipAuth: true,
    skipRefresh: true,
  });
  return page.items;
}

export type ReleaseTeaser = TeaserSummary & { track_id: string; track_title: string };

/** Published teasers of a release's songs, in track order (also while it is on pre-sale). */
export async function fetchPublicReleaseTeasers(releaseId: string): Promise<ReleaseTeaser[]> {
  const page = await apiFetch<{ items: ReleaseTeaser[] }>(`/api/v1/releases/${releaseId}/teasers`, {
    retry: false,
    skipAuth: true,
    skipRefresh: true,
  });
  return page.items;
}

/** The newest published teaser per song, for rows of songs a listener can't play yet. */
export async function fetchTeasersForTracks(trackIds: readonly string[]): Promise<Record<string, string>> {
  if (trackIds.length === 0) return {};
  const out = await apiFetch<{ teasers: Record<string, string> }>("/api/v1/teasers/for-tracks", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ track_ids: trackIds.slice(0, 200) }),
    retry: false,
    skipAuth: true,
    skipRefresh: true,
  });
  return out.teasers;
}

export function fetchTeaserAudio(teaserId: string, accept?: readonly string[]): Promise<TeaserAudioRecord> {
  return apiFetch(`/api/v1/teasers/${teaserId}/audio${accepting(accept)}`, {
    retry: false,
    skipAuth: true,
    skipRefresh: true,
  });
}

/** One start, full listen or buy-suggestion press. Fire and forget; never in a listener's way. */
export function countTeaser(teaserId: string, kind: "start" | "complete" | "prompt_click"): void {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  const token = getAccessToken();
  try {
    void fetch(`${getApiBaseUrl()}/api/v1/teasers/${encodeURIComponent(teaserId)}/count`, {
      method: "POST",
      keepalive: true,
      credentials: "omit",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ kind }),
    }).catch(() => undefined);
  } catch {
    /* counting never gets in a listener's way */
  }
}
