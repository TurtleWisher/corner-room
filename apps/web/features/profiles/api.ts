/* Artists and band admins change their public profile; staff approve it first (owner, 2026-10-23). */

import type { ProfileKind } from "@/features/studio/api";
import type { ArtworkReport } from "@/features/uploads/api";
import { apiFetch } from "@/lib/api/client";
import type { ChangeRequest } from "@/lib/profile-view";

export type PublicProfile = {
  kind: ProfileKind;
  id: string;
  status: string;
  stage_name: string;
  bio: string | null;
  /** Signed link to the picture the public sees now. */
  portrait_url: string | null;
};

export type StudioProfile = {
  profile: PublicProfile;
  pending: ChangeRequest | null;
  last_decision: ChangeRequest | null;
  picture_report: ArtworkReport | null;
};

export type ReviewItem = { request: ChangeRequest; profile: PublicProfile };

export async function fetchStudioProfile(kind: ProfileKind, id: string): Promise<StudioProfile> {
  return apiFetch<StudioProfile>(`/api/v1/studio/profiles/${kind}/${id}/profile`, { retry: false });
}

/** Leave a field out to keep it; `bio: null` clears it. */
export async function saveProfileChange(
  kind: ProfileKind,
  id: string,
  body: { stage_name?: string; bio?: string | null; remove_portrait?: boolean },
): Promise<StudioProfile> {
  return apiFetch<StudioProfile>(`/api/v1/studio/profiles/${kind}/${id}/profile-changes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function fetchProfileReviewQueue(): Promise<ReviewItem[]> {
  return apiFetch<ReviewItem[]>("/api/v1/profile-changes", { retry: false });
}

export async function transitionProfileChange(id: string, to: "APPROVED" | "REJECTED" | "WITHDRAWN", note?: string): Promise<ReviewItem> {
  return apiFetch<ReviewItem>(`/api/v1/profile-changes/${id}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, note: note || undefined }),
    retry: false,
  });
}
