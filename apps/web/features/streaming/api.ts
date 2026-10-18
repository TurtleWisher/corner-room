/* Playback catalog, listening sessions, library, playlists and history. Split from lib/api.ts (Phase 16, Stage 5). */

import { type Page } from "@/features/identity/api";
import { apiFetch, getApiBaseUrl } from "@/lib/api/client";

export type PlayableTrackRecord = {
  id: string;
  title: string;
  status: string;
  primary_artist_id?: string | null;
  primary_band_id?: string | null;
  catalog_playable: boolean;
  audio_deliverable: boolean;
  track_version_id?: string | null;
  duration_ms?: number | null;
  reason?: string | null;
};

export type ListeningSessionRecord = {
  id: string;
  user_id: string;
  status: string;
  version: number;
  catalog_playable?: boolean | null;
  audio_deliverable?: boolean | null;
  availability_reason?: string | null;
  track_id?: string | null;
  track_version_id?: string | null;
};

export type AudioDeliveryRecord = {
  url: string;
  expires_at: string;
  track_id: string;
  track_version_id: string;
  media_asset_id: string;
  /** The playback copy sent first; null for older demo audio served as stored. */
  codec?: string | null;
  container?: string | null;
  bitrate_kbps?: number | null;
  /** Levels the song to about -14 LUFS (D-AUDIO-08); null when it was never measured. */
  gain_db?: number | null;
  legacy_delivery?: boolean;
  /** Other verified copies of the same version, to try if the first will not decode. */
  alternates?: { codec: string; url: string }[];
};

export type LibraryRecord = {
  id: string;
  item_type: string;
  item_id: string;
  kind: string;
};

export type PlaylistRecord = {
  id: string;
  owner_user_id?: string | null;
  kind: string;
  status: string;
  title: string;
  version: number;
};

export type PlaybackEventRecord = {
  id: string;
  track_id: string;
  track_version_id: string;
  duration_ms: number;
  completed: boolean;
  started_at: string;
  eligible_hint?: boolean | null;
};

export type ArtistPlayAggregates = {
  artist_id: string;
  label: string;
  eligibility: string;
  tracks: Array<{
    track_id: string;
    title: string;
    play_count: number;
    unique_listener_count: number;
    total_duration_ms: number;
    completed_count: number;
    skip_count: number;
  }>;
};

export async function fetchPlayableCatalog(): Promise<Page<PlayableTrackRecord>> {
  return apiFetch<Page<PlayableTrackRecord>>("/api/v1/playback/catalog", { retry: false });
}

export async function openListeningSession(track_id: string): Promise<ListeningSessionRecord> {
  return apiFetch<ListeningSessionRecord>("/api/v1/playback/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track_id, device: "web" }),
    retry: false,
  });
}

export async function closeListeningSession(id: string, version?: number): Promise<ListeningSessionRecord> {
  return apiFetch<ListeningSessionRecord>(`/api/v1/playback/sessions/${id}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
    retry: false,
  });
}

/** `accept`: codecs this browser can decode, best first (lib/player-model acceptCodecs). */
export async function fetchTrackAudio(trackId: string, accept?: readonly string[]): Promise<AudioDeliveryRecord> {
  const query = accept && accept.length > 0 ? `?accept=${encodeURIComponent(accept.join(","))}` : "";
  return apiFetch<AudioDeliveryRecord>(`/api/v1/playback/tracks/${trackId}/audio${query}`, { retry: false });
}

export async function ingestPlaybackEvent(body: {
  client_event_id: string;
  track_id: string;
  session_id: string;
  duration_ms: number;
  completed: boolean;
}): Promise<PlaybackEventRecord> {
  return apiFetch<PlaybackEventRecord>("/api/v1/playback/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function fetchLibrary(): Promise<Page<LibraryRecord>> {
  return apiFetch<Page<LibraryRecord>>("/api/v1/me/library", { retry: false });
}

export async function addLibraryItem(item_id: string, kind: "LIKE" | "SAVE"): Promise<LibraryRecord> {
  return apiFetch<LibraryRecord>("/api/v1/me/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_type: "track", item_id, kind }),
    retry: false,
  });
}

export async function fetchPlaylists(): Promise<Page<PlaylistRecord>> {
  return apiFetch<Page<PlaylistRecord>>("/api/v1/playlists", { retry: false });
}

export async function createPlaylist(title: string): Promise<PlaylistRecord> {
  return apiFetch<PlaylistRecord>("/api/v1/playlists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, kind: "USER" }),
    retry: false,
  });
}

export async function fetchPlaylist(id: string): Promise<PlaylistRecord> {
  return apiFetch<PlaylistRecord>(`/api/v1/playlists/${id}`, { retry: false });
}

export async function addPlaylistItem(id: string, track_id: string, position: number): Promise<{ track_id: string }> {
  return apiFetch<{ track_id: string }>(`/api/v1/playlists/${id}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track_id, position }),
    retry: false,
  });
}

export async function fetchListeningHistory(): Promise<Page<PlaybackEventRecord>> {
  return apiFetch<Page<PlaybackEventRecord>>("/api/v1/me/listening-history", { retry: false });
}

export async function fetchArtistPlayAggregates(artistId: string): Promise<ArtistPlayAggregates> {
  return apiFetch<ArtistPlayAggregates>(`/api/v1/artists/${artistId}/play-aggregates`, { retry: false });
}

export function resolveMediaUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${getApiBaseUrl()}${path}`;
}

export type PlaylistItemRecord = { playlist_id: string; track_id: string; position: number };

export async function fetchPlaylistItems(id: string): Promise<PlaylistItemRecord[]> {
  return apiFetch<PlaylistItemRecord[]>(`/api/v1/playlists/${id}/items`, { retry: false });
}

export async function removePlaylistItem(id: string, track_id: string): Promise<void> {
  await apiFetch<null>(`/api/v1/playlists/${id}/items/${track_id}`, { method: "DELETE", retry: false });
}

export async function removeLibraryItem(item_id: string): Promise<void> {
  await apiFetch<null>(`/api/v1/me/library/${item_id}`, { method: "DELETE", retry: false });
}
