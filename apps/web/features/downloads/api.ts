/* Buyer downloads (AUDIO Phase 8, D-AUDIO-06). The API decides who may download what. */

import { apiFetch } from "@/lib/api/client";

export type DownloadFormat = "flac" | "mp3";

export type DownloadOptionRecord = {
  format: DownloadFormat;
  label: string;
  /** False while the copy is still being made (a song from before downloads existed). */
  available: boolean;
  byte_size: number | null;
  sample_rate_hz: number | null;
  bit_depth: number | null;
  bitrate_kbps: number | null;
};

export type DownloadGrantRecord = {
  /** Short-lived, download-only link; every request with it is checked again. */
  url: string;
  expires_at: string;
  filename: string;
  format: DownloadFormat;
  content_type: string;
  byte_size: number;
  /** Hex SHA-256 of the exact file, to verify what arrived. */
  sha256: string;
};

export async function fetchDownloadOptions(trackId: string): Promise<DownloadOptionRecord[]> {
  return apiFetch<DownloadOptionRecord[]>(`/api/v1/me/downloads/tracks/${trackId}`, { retry: false });
}

export async function startDownload(trackId: string, format: DownloadFormat): Promise<DownloadGrantRecord> {
  return apiFetch<DownloadGrantRecord>("/api/v1/me/downloads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track_id: trackId, format }),
    retry: false,
  });
}
