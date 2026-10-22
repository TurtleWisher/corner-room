/* Artist Studio API client (AUDIO_PHASE_1_DESIGN 10.1). Catalog fields only. */

import type { ArtworkReport } from "@/features/uploads/api";
import { apiFetch } from "@/lib/api/client";

export type ProfileKind = "artist" | "band";

export type CatalogProfile = {
  kind: ProfileKind;
  id: string;
  display_name: string;
  status: string;
  can_publish: boolean;
  reason?: string | null;
};

export type Taxonomy = {
  credit_roles: { key: string; label_en: string; label_bn?: string | null; performer: boolean; allows_instrument: boolean }[];
  genres: { key: string; label_en: string; label_bn?: string | null }[];
  languages: { code: string; label_en: string; label_bn: string }[];
  release_types: string[];
};

export type ReleaseCard = {
  id: string;
  title: string;
  release_type: string;
  status: string;
  display_state: string;
  track_count: number;
  cover_asset_id?: string | null;
  /** Signed link to the accepted cover (OD-05); null without one. */
  cover_url?: string | null;
  updated_at: string;
  version: number;
};

export type StudioRelease = {
  id: string;
  title: string;
  release_type: string;
  status: string;
  release_at?: string | null;
  release_timezone: string;
  cover_asset_id?: string | null;
  language_code?: string | null;
  genre_primary?: string | null;
  genre_secondary?: string | null;
  label_name?: string | null;
  p_line?: string | null;
  c_line?: string | null;
  upc?: string | null;
  track_sales: "RELEASE_ONLY" | "TRACKS_ALLOWED";
  intake_mode: string;
  rights_declared_at?: string | null;
  version: number;
};

export type StudioCredit = {
  id?: string;
  role_key: string;
  artist_id?: string | null;
  artist_name?: string | null;
  display_name?: string | null;
  instrument?: string | null;
  position?: number;
};

export type StudioAudio = {
  version_id: string;
  status: string;
  processing_detail?: string | null;
  is_current: boolean;
  has_audio: boolean;
  duration_ms?: number | null;
};

export type StudioTrack = {
  id: string;
  position: number;
  title: string;
  version_title?: string | null;
  status: string;
  explicit: boolean;
  language_code?: string | null;
  genre_primary?: string | null;
  genre_secondary?: string | null;
  isrc?: string | null;
  version: number;
  audio: StudioAudio[];
  credits: StudioCredit[];
};

export type ReadinessItem = { code: string; ok: boolean; track_id?: string | null };

export type PriceProposal = {
  id: string;
  subject_type: "TRACK" | "RELEASE";
  subject_id: string;
  audience: "EVERYONE" | "OWNS_PART_OF_RELEASE";
  amount_minor: number;
  currency_code: string;
  note?: string | null;
  status: string;
  decision_note?: string | null;
  created_at: string;
};

export type StudioReleaseDetail = {
  release: StudioRelease;
  /** Signed link to the accepted cover at 1200 px (OD-05); null without one. */
  cover_url?: string | null;
  profile: { kind: ProfileKind; id: string; display_name: string };
  viewer_role: "owner" | "staff";
  display_state: string;
  tracks: StudioTrack[];
  readiness: { ready: boolean; items: ReadinessItem[] };
  proposals: PriceProposal[];
  intake: { mode: string; status: string; managed_reason?: string | null; artist_confirmed_at?: string | null } | null;
  history: ReviewEvent[];
};

const json = { "Content-Type": "application/json" };

export function fetchMyProfiles(): Promise<CatalogProfile[]> {
  return apiFetch<CatalogProfile[]>("/api/v1/me/catalog-profiles");
}

export function fetchTaxonomy(): Promise<Taxonomy> {
  return apiFetch<Taxonomy>("/api/v1/catalog/taxonomy");
}

export function fetchProfileReleases(kind: ProfileKind, id: string): Promise<ReleaseCard[]> {
  return apiFetch<ReleaseCard[]>(`/api/v1/studio/profiles/${kind}/${id}/releases`);
}

export function createStudioRelease(body: { profile: { kind: ProfileKind; id: string }; release_type: string; title: string }): Promise<StudioReleaseDetail> {
  return apiFetch<StudioReleaseDetail>("/api/v1/studio/releases", { method: "POST", headers: json, body: JSON.stringify(body), retry: false });
}

export function fetchStudioRelease(id: string): Promise<StudioReleaseDetail> {
  return apiFetch<StudioReleaseDetail>(`/api/v1/studio/releases/${id}`);
}

export function updateStudioRelease(id: string, body: Partial<StudioRelease> & { version?: number }): Promise<StudioReleaseDetail> {
  return apiFetch<StudioReleaseDetail>(`/api/v1/studio/releases/${id}`, { method: "PATCH", headers: json, body: JSON.stringify(body), retry: false });
}

export function addStudioTrack(releaseId: string, title: string): Promise<StudioReleaseDetail> {
  return apiFetch<StudioReleaseDetail>(`/api/v1/studio/releases/${releaseId}/tracks`, { method: "POST", headers: json, body: JSON.stringify({ title }), retry: false });
}

export function reorderStudioTracks(releaseId: string, trackIds: string[]): Promise<StudioReleaseDetail> {
  return apiFetch<StudioReleaseDetail>(`/api/v1/studio/releases/${releaseId}/tracks/order`, { method: "PUT", headers: json, body: JSON.stringify({ track_ids: trackIds }), retry: false });
}

export function removeStudioTrack(releaseId: string, trackId: string): Promise<null> {
  return apiFetch<null>(`/api/v1/studio/releases/${releaseId}/tracks/${trackId}`, { method: "DELETE", retry: false });
}

export function updateStudioTrack(trackId: string, body: Partial<StudioTrack> & { version?: number }): Promise<StudioTrack> {
  return apiFetch<StudioTrack>(`/api/v1/studio/tracks/${trackId}`, { method: "PATCH", headers: json, body: JSON.stringify(body), retry: false });
}

export function setStudioCredits(trackId: string, credits: StudioCredit[]): Promise<StudioTrack> {
  const body = credits.map((c) => ({ role_key: c.role_key, artist_id: c.artist_id || null, display_name: c.display_name || null, instrument: c.instrument || null }));
  return apiFetch<StudioTrack>(`/api/v1/studio/tracks/${trackId}/credits`, { method: "PUT", headers: json, body: JSON.stringify({ credits: body }), retry: false });
}

export function newStudioVersion(trackId: string): Promise<{ version_id: string; status: string; is_current: boolean }> {
  return apiFetch(`/api/v1/studio/tracks/${trackId}/versions`, { method: "POST", retry: false });
}

export function submitStudioRelease(id: string, rightsDeclaration: boolean): Promise<StudioReleaseDetail> {
  return apiFetch<StudioReleaseDetail>(`/api/v1/studio/releases/${id}/submit`, { method: "POST", headers: json, body: JSON.stringify({ rights_declaration: rightsDeclaration }), retry: false });
}

export function withdrawStudioRelease(id: string): Promise<StudioReleaseDetail> {
  return apiFetch<StudioReleaseDetail>(`/api/v1/studio/releases/${id}/withdraw`, { method: "POST", retry: false });
}

export function proposeStudioPrice(
  releaseId: string,
  body: { subject_type: "TRACK" | "RELEASE"; subject_id: string; audience?: string; amount_minor: number; currency_code: string; note?: string },
): Promise<PriceProposal> {
  return apiFetch<PriceProposal>(`/api/v1/studio/releases/${releaseId}/price-proposals`, { method: "POST", headers: json, body: JSON.stringify(body), retry: false });
}

/* --- Staff catalog intake (URL-06) --- */

export type StaffProfileCard = { kind: ProfileKind; id: string; display_name: string; status: string; has_owner: boolean };

export type IntakeQueueItem = ReleaseCard & { profile_name: string; intake_mode: string; preparer_count: number };

export type MediaJobRecord = {
  id: string;
  media_asset_id: string;
  kind: string;
  profile_key?: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error_code?: string | null;
  next_attempt_at: string;
  updated_at: string;
};

export function fetchStaffProfiles(q?: string): Promise<StaffProfileCard[]> {
  const query = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiFetch<StaffProfileCard[]>(`/api/v1/catalog-intake/profiles${query}`);
}

export function fetchIntakeQueue(inReview = false): Promise<IntakeQueueItem[]> {
  return apiFetch<IntakeQueueItem[]>(`/api/v1/catalog-intake/queue${inReview ? "?in_review=true" : ""}`);
}

export function setManagedMode(releaseId: string, enabled: boolean, reason?: string): Promise<{ mode: string; status: string; managed_reason?: string | null }> {
  return apiFetch(`/api/v1/catalog-intake/releases/${releaseId}/managed`, { method: "POST", headers: json, body: JSON.stringify({ enabled, reason }), retry: false });
}

export function fetchMediaJobs(status?: string): Promise<{ items: MediaJobRecord[] }> {
  return apiFetch<{ items: MediaJobRecord[] }>(`/api/v1/media-jobs${status ? `?status=${status}` : ""}`);
}

export function retryMediaJob(id: string): Promise<MediaJobRecord> {
  return apiFetch<MediaJobRecord>(`/api/v1/media-jobs/${id}/retry`, { method: "POST", retry: false });
}

export function cancelMediaJob(id: string): Promise<MediaJobRecord> {
  return apiFetch<MediaJobRecord>(`/api/v1/media-jobs/${id}/cancel`, { method: "POST", retry: false });
}
export type ReviewEvent = { action: string; note?: string | null; from_status: string; to_status: string; created_at: string };

/** `takedownKind` (takedowns only, D-AUDIO-14): STANDARD keeps buyers' access, LEGAL removes it for everyone. */
export function reviewRelease(
  releaseId: string,
  action: string,
  note?: string,
  releaseAt?: string,
  takedownKind?: "STANDARD" | "LEGAL",
): Promise<StudioRelease> {
  return apiFetch<StudioRelease>(`/api/v1/catalog-intake/releases/${releaseId}/review`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ action, note: note || null, release_at: releaseAt || null, takedown_kind: takedownKind ?? null }),
    retry: false,
  });
}
/* Sales (owners and finance staff). Money is what fans paid, before any share; the API sums it. */

export type SalesTotal = {
  currency_code: string;
  sold_count: number;
  refunded_count: number;
  gross_amount_minor: number;
  refunded_amount_minor: number;
  net_amount_minor: number;
};

export type SalesItem = SalesTotal & {
  subject_type: "TRACK" | "RELEASE";
  subject_id: string;
  title: string;
  release_type: string | null;
  last_sold_at: string;
};

export type ProfileSales = {
  profile: { kind: ProfileKind; id: string; display_name: string };
  totals: SalesTotal[];
  items: SalesItem[];
};

export type SaleLine = {
  id: string;
  subject_type: "TRACK" | "RELEASE";
  subject_id: string;
  title: string;
  release_type: string | null;
  quantity: number;
  amount_minor: number;
  refunded_amount_minor: number;
  currency_code: string;
  order_status: string;
  ordered_at: string;
};

export function fetchProfileSales(kind: ProfileKind, id: string): Promise<ProfileSales> {
  return apiFetch<ProfileSales>(`/api/v1/studio/profiles/${kind}/${id}/sales`);
}

export function fetchProfileSaleLines(kind: ProfileKind, id: string, cursor?: string | null): Promise<{ items: SaleLine[]; next_cursor: string | null }> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<{ items: SaleLine[]; next_cursor: string | null }>(`/api/v1/studio/profiles/${kind}/${id}/sales/lines${query}`);
}

/* Cover checks: the latest cover upload for a release and what the checks found (null before any). */

export type CoverReport = ArtworkReport;

export function fetchCoverReport(releaseId: string): Promise<CoverReport | null> {
  return apiFetch<CoverReport | null>(`/api/v1/studio/releases/${releaseId}/cover-report`);
}
