/* Resumable uploads for audio masters and cover art (AUDIO_PHASE_1_DESIGN section 6). */

import { apiFetch } from "@/lib/api/client";

export type UploadPurpose = "AUDIO_MASTER" | "COVER_ART";
export type UploadTargetType = "track_version" | "release_cover" | "event_cover";

export type UploadIntentRecord = {
  id: string;
  media_asset_id: string;
  purpose: UploadPurpose;
  target_type: UploadTargetType;
  target_id: string;
  filename: string;
  byte_size: number;
  part_size: number;
  part_count: number;
  parts_received: number[];
  status: "OPEN" | "COMPLETING" | "COMPLETED" | "CANCELLED" | "EXPIRED";
  expires_at: string;
  mode: string;
  resumed?: boolean;
};

export type UploadCompleteRecord = {
  intent: UploadIntentRecord;
  media_asset_id: string;
  asset_status: string;
  byte_size: number;
  sha256: string;
};

export async function createUploadIntent(body: {
  purpose: UploadPurpose;
  target_type: UploadTargetType;
  target_id: string;
  filename: string;
  byte_size: number;
}): Promise<UploadIntentRecord> {
  return apiFetch<UploadIntentRecord>("/api/v1/uploads/intents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function findOpenUpload(targetType: UploadTargetType, targetId: string): Promise<UploadIntentRecord | null> {
  const query = new URLSearchParams({ target_type: targetType, target_id: targetId });
  return apiFetch<UploadIntentRecord | null>(`/api/v1/uploads/intents/open?${query}`);
}

export async function putUploadPart(
  intentId: string,
  partNumber: number,
  data: ArrayBuffer,
  sha256: string,
): Promise<{ parts_received: number[] }> {
  return apiFetch<{ parts_received: number[] }>(`/api/v1/uploads/intents/${intentId}/parts/${partNumber}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream", "X-Part-SHA256": sha256 },
    body: data,
    retry: false,
    timeoutMs: 120_000,
  });
}

export async function completeUpload(intentId: string): Promise<UploadCompleteRecord> {
  return apiFetch<UploadCompleteRecord>(`/api/v1/uploads/intents/${intentId}/complete`, {
    method: "POST",
    retry: false,
    timeoutMs: 600_000,
  });
}

export async function cancelUpload(intentId: string): Promise<UploadIntentRecord> {
  return apiFetch<UploadIntentRecord>(`/api/v1/uploads/intents/${intentId}`, { method: "DELETE", retry: false });
}

/** What the checks found for the latest artwork upload to a release or event (null before any). */
export type ArtworkReport = {
  filename: string;
  uploaded_at: string | null;
  asset_status: string | null;
  outcome: string | null;
  width_px: number | null;
  height_px: number | null;
  findings: { code: string; severity: string; measured?: string | null; limit?: string | null }[];
  is_current: boolean;
  /** Events: signed link to the poster in use. */
  cover_url?: string | null;
};
