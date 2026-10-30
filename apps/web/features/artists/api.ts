/* Artists, bands, applications, members and event lineup. Split from lib/api.ts (Phase 16, Stage 5). */

import { type Page } from "@/features/identity/api";
import { fetchAllPages, pagePath } from "@/lib/api/all-pages";
import { apiFetch } from "@/lib/api/client";

export type ArtistRecord = {
  id: string;
  /** Every band is an artist too (owner, 2026-10-30, D-ARTIST-UNIFY-01); a band's page is /bands/{id}. */
  kind?: "SOLO" | "BAND";
  stage_name: string;
  legal_name?: string | null;
  bio: string | null;
  status: string;
  primary_org_id?: string | null;
  claimed_user_id?: string | null;
  portrait_asset_id?: string | null;
  metadata?: Record<string, unknown> | null;
  version?: number;
};

export type BandRecord = {
  id: string;
  name: string;
  bio: string | null;
  status: string;
  primary_org_id?: string | null;
  portrait_asset_id?: string | null;
  metadata?: Record<string, unknown> | null;
  version?: number;
};

export type ApplicationRecord = {
  id: string;
  user_id: string;
  artist_id: string | null;
  status: string;
  version?: number;
  stage_name?: string | null;
  bio?: string | null;
  /** The artist profile's own state: ACTIVE means the artist can publish from Studio. */
  artist_status?: string | null;
  created_at?: string | null;
  /** Applied as a solo artist or a band; and the band it became, if any (D-BAND-01). */
  profile_kind?: "SOLO" | "BAND";
  moved_to_band_id?: string | null;
};

export type BandMemberRecord = {
  id: string;
  band_id: string;
  user_id: string | null;
  artist_id: string | null;
  role_label: string | null;
  /** The name shown in the band's lineup (D-LINEUP-01). */
  display_name?: string | null;
  status: string;
  /** A band admin manages the band in Studio (D-BAND-01). */
  is_admin?: boolean;
};

export type LineupRecord = {
  id: string;
  event_id: string;
  artist_id: string | null;
  band_id: string | null;
  billing_order: number;
  status: string;
  contract_id: string | null;
  version?: number;
};

/**
 * Every artist the viewer may see, across all pages. Solo artists unless asked otherwise: bands are
 * artists too (D-ARTIST-UNIFY-01), and `kind: "ALL"` lists both in one go.
 */
export async function fetchArtists(opts?: { skipAuth?: boolean; kind?: "SOLO" | "BAND" | "ALL" }): Promise<Page<ArtistRecord>> {
  const kind = opts?.kind ?? "SOLO";
  const base = kind === "ALL" ? "/api/v1/artists" : `/api/v1/artists?kind=${kind}`;
  const items = await fetchAllPages((cursor) =>
    apiFetch<Page<ArtistRecord>>(pagePath(base, cursor), { retry: false, skipAuth: opts?.skipAuth, skipRefresh: opts?.skipAuth }),
  );
  return { items, next_cursor: null };
}

export async function fetchArtist(id: string, opts?: { skipAuth?: boolean }): Promise<ArtistRecord> {
  return apiFetch<ArtistRecord>(`/api/v1/artists/${id}`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function createArtist(body: {
  stage_name: string;
  bio?: string;
  legal_name?: string;
}): Promise<ArtistRecord> {
  return apiFetch<ArtistRecord>("/api/v1/artists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function updateArtist(
  id: string,
  body: Partial<{ stage_name: string; bio: string | null; version: number }>,
): Promise<ArtistRecord> {
  return apiFetch<ArtistRecord>(`/api/v1/artists/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionArtist(id: string, action: string, version?: number): Promise<ArtistRecord> {
  return apiFetch<ArtistRecord>(`/api/v1/artists/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

/** Staff: turn a solo artist profile into a band profile (D-BAND-01). */
export async function moveArtistToBand(artistId: string): Promise<{ band_id: string; name: string }> {
  return apiFetch<{ band_id: string; name: string }>(`/api/v1/artists/${artistId}/move-to-band`, { method: "POST", retry: false });
}

/** Staff: make a band member an admin (manages the band in Studio), or not. */
export async function setBandMemberAdmin(bandId: string, memberId: string, isAdmin: boolean): Promise<BandMemberRecord> {
  return apiFetch<BandMemberRecord>(`/api/v1/bands/${bandId}/members/${memberId}/admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_admin: isAdmin }),
    retry: false,
  });
}

export async function submitArtistApplication(body: {
  stage_name: string;
  bio?: string;
  /** From a label's join link: the application goes to that label. */
  join_code?: string;
  /** A solo artist or a band (owner, 2026-10-27). */
  profile_kind?: "SOLO" | "BAND";
}): Promise<ApplicationRecord> {
  return apiFetch<ApplicationRecord>("/api/v1/artist-applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

/** A label's shared link for artists to join (owner, 2026-10-17). */
export type JoinLinkRecord = {
  id: string;
  code: string;
  label: string;
  status: string;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  /** Active, not ended and not full. */
  usable: boolean;
  created_at: string;
  disabled_at: string | null;
};

export async function fetchJoinLinks(): Promise<JoinLinkRecord[]> {
  return apiFetch<JoinLinkRecord[]>("/api/v1/artist-join-links", { retry: false });
}

export async function createJoinLink(body: { label: string; expires_at?: string | null; max_uses?: number | null }): Promise<JoinLinkRecord> {
  return apiFetch<JoinLinkRecord>("/api/v1/artist-join-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function disableJoinLink(id: string): Promise<JoinLinkRecord> {
  return apiFetch<JoinLinkRecord>(`/api/v1/artist-join-links/${id}/disable`, { method: "POST", retry: false });
}

/** Public: which label a join link is for. 404 JOIN_LINK_INVALID when it is off, ended or full. */
export async function checkJoinCode(code: string): Promise<{ organization_name: string }> {
  return apiFetch<{ organization_name: string }>("/api/v1/artist-join-links/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    retry: false,
    skipAuth: true,
  });
}

/** The signed-in person's own applications, newest first. */
export async function fetchMyArtistApplications(): Promise<Page<ApplicationRecord>> {
  return apiFetch<Page<ApplicationRecord>>("/api/v1/artist-applications?mine=true", { retry: false });
}

export async function fetchArtistApplications(): Promise<Page<ApplicationRecord>> {
  return apiFetch<Page<ApplicationRecord>>("/api/v1/artist-applications", { retry: false });
}

export async function transitionApplication(id: string, action: string, version?: number): Promise<ApplicationRecord> {
  return apiFetch<ApplicationRecord>(`/api/v1/artist-applications/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export type FollowSummary = { followers: number; following: boolean };

/** Followers of an artist or band, and whether you follow (owner, 2026-10-27). Public. */
export async function fetchFollowSummary(kind: "artist" | "band", id: string, opts?: { skipAuth?: boolean }): Promise<FollowSummary> {
  const base = kind === "artist" ? `/api/v1/artists/${id}` : `/api/v1/bands/${id}`;
  return apiFetch<FollowSummary>(`${base}/followers/summary`, { retry: false, skipAuth: opts?.skipAuth, skipRefresh: opts?.skipAuth });
}

export async function followBand(id: string): Promise<{ status: string }> {
  return apiFetch(`/api/v1/bands/${id}/follow`, { method: "POST", retry: false });
}

export async function unfollowBand(id: string): Promise<{ status: string }> {
  return apiFetch(`/api/v1/bands/${id}/follow`, { method: "DELETE", retry: false });
}

export async function followArtist(id: string): Promise<{ status: string }> {
  return apiFetch(`/api/v1/artists/${id}/follow`, { method: "POST", retry: false });
}

export async function unfollowArtist(id: string): Promise<{ status: string }> {
  return apiFetch(`/api/v1/artists/${id}/follow`, { method: "DELETE", retry: false });
}

/** Every band the viewer may see, across all pages. */
export async function fetchBands(opts?: { skipAuth?: boolean }): Promise<Page<BandRecord>> {
  const items = await fetchAllPages((cursor) =>
    apiFetch<Page<BandRecord>>(pagePath("/api/v1/bands", cursor), { retry: false, skipAuth: opts?.skipAuth, skipRefresh: opts?.skipAuth }),
  );
  return { items, next_cursor: null };
}

export async function fetchBand(id: string, opts?: { skipAuth?: boolean }): Promise<BandRecord> {
  return apiFetch<BandRecord>(`/api/v1/bands/${id}`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function createBand(body: { name: string; bio?: string }): Promise<BandRecord> {
  return apiFetch<BandRecord>("/api/v1/bands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function updateBand(
  id: string,
  body: Partial<{ name: string; bio: string | null; version: number }>,
): Promise<BandRecord> {
  return apiFetch<BandRecord>(`/api/v1/bands/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionBand(id: string, action: string, version?: number): Promise<BandRecord> {
  return apiFetch<BandRecord>(`/api/v1/bands/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function fetchBandMembers(id: string): Promise<{ items: BandMemberRecord[] }> {
  return apiFetch<{ items: BandMemberRecord[] }>(`/api/v1/bands/${id}/members`, { retry: false });
}

export async function inviteBandMember(id: string, user_id: string, role_label?: string): Promise<BandMemberRecord> {
  return apiFetch<BandMemberRecord>(`/api/v1/bands/${id}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id, role_label }),
    retry: false,
  });
}

/** A member listed by name only: no account, attribution only (D-LINEUP-01). */
export async function addNamedBandMember(id: string, display_name: string, role_label?: string): Promise<BandMemberRecord> {
  return apiFetch<BandMemberRecord>(`/api/v1/bands/${id}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name, role_label: role_label || null }),
    retry: false,
  });
}

export async function updateBandMember(
  bandId: string,
  memberId: string,
  details: { display_name?: string | null; role_label?: string | null },
): Promise<BandMemberRecord> {
  return apiFetch<BandMemberRecord>(`/api/v1/bands/${bandId}/members/${memberId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(details),
    retry: false,
  });
}

export type BandLineupMember = {
  id: string;
  name: string;
  role_label?: string | null;
  artist_id?: string | null;
  portrait_asset_id?: string | null;
};

/** The band's current members as fans see them (D-LINEUP-01). Public. */
export async function fetchBandLineup(id: string): Promise<{ items: BandLineupMember[] }> {
  return apiFetch<{ items: BandLineupMember[] }>(`/api/v1/bands/${id}/lineup`, { retry: false, skipAuth: true, skipRefresh: true });
}

export async function transitionBandMember(
  bandId: string,
  memberId: string,
  action: string,
): Promise<BandMemberRecord> {
  return apiFetch<BandMemberRecord>(`/api/v1/bands/${bandId}/members/${memberId}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    retry: false,
  });
}

export async function fetchEventLineup(eventId: string, opts?: { skipAuth?: boolean }): Promise<{ items: LineupRecord[] }> {
  return apiFetch<{ items: LineupRecord[] }>(`/api/v1/events/${eventId}/lineup`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function inviteEventLineup(
  eventId: string,
  body: { artist_id?: string; band_id?: string; billing_order?: number },
): Promise<LineupRecord> {
  return apiFetch<LineupRecord>(`/api/v1/events/${eventId}/lineup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionEventLineup(
  eventId: string,
  lineupId: string,
  action: string,
  version?: number,
): Promise<LineupRecord> {
  return apiFetch<LineupRecord>(`/api/v1/events/${eventId}/lineup/${lineupId}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}
