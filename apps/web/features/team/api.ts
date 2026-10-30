/* Who runs an artist profile, solo or band: one owner and managers (owner, 2026-10-30,
 * D-ARTIST-UNIFY-01). The owner picks a manager; staff approve. The API decides all of it. */

import type { ProfileKind } from "@/features/studio/api";
import { apiFetch } from "@/lib/api/client";
import type { Team, TeamMember, TeamRequest } from "@/lib/team-view";

const json = { "Content-Type": "application/json" };

export async function fetchTeam(kind: ProfileKind, id: string): Promise<Team> {
  return apiFetch<Team>(`/api/v1/studio/profiles/${kind}/${id}/team`, { retry: false });
}

/** The owner picks a manager by the email of their Corner Room account. */
export async function pickManager(kind: ProfileKind, id: string, email: string): Promise<Team> {
  return apiFetch<Team>(`/api/v1/studio/profiles/${kind}/${id}/team`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email }),
    retry: false,
  });
}

/** The owner takes a manager off or withdraws a pick; a manager leaves. */
export async function takeOffTeam(kind: ProfileKind, id: string, memberId: string): Promise<Team> {
  return apiFetch<Team>(`/api/v1/studio/profiles/${kind}/${id}/team/${memberId}`, { method: "DELETE", retry: false });
}

/** Staff: managers waiting for approval in the active workspace. */
export async function fetchTeamRequests(): Promise<TeamRequest[]> {
  return apiFetch<TeamRequest[]>("/api/v1/artist-team-requests", { retry: false });
}

export async function reviewTeamRequest(memberId: string, action: "approve" | "reject", note?: string): Promise<TeamMember> {
  return apiFetch<TeamMember>(`/api/v1/artist-team-requests/${memberId}/review`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ action, note: note || undefined }),
    retry: false,
  });
}

/** Staff: who runs a profile (a band's id works too). */
export async function fetchArtistTeam(artistId: string): Promise<Team> {
  return apiFetch<Team>(`/api/v1/artists/${artistId}/team`, { retry: false });
}

/** Staff: make an account the owner; the previous owner stays on as a manager. */
export async function setArtistOwner(artistId: string, email: string): Promise<Team> {
  return apiFetch<Team>(`/api/v1/artists/${artistId}/team/owner`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify({ email }),
    retry: false,
  });
}
