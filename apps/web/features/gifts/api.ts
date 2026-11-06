/* Gift campaigns (owner, 2026-10-28, D-CAMPAIGN-01, D-CAMPAIGN-02). The API decides who may see and
 * do what; these are thin calls. */

import { apiFetch } from "@/lib/api/client";

const json = { "Content-Type": "application/json" };

export type GiftWork = { type: "RELEASE" | "TRACK"; id: string; title?: string };
export type GiftCampaignStatus = "DRAFT" | "IN_REVIEW" | "ACTIVE" | "PAUSED" | "ENDED";
/** Collectible tracking (owner, 2026-11-06, D-CAMPAIGN-03). YET_TO_SEND is "not prepared yet". */
export type GiftRecipientStatus = "YET_TO_SEND" | "PREPARED" | "DISPATCHED" | "RECEIVED" | "RETURNED" | "MISSING";
/** One count per status, TOTAL, and SCHEDULED (prepared with a dispatch time; inside PREPARED). */
export type GiftCounts = Record<GiftRecipientStatus, number> & { TOTAL: number; SCHEDULED: number };

export type GiftCampaign = {
  id: string;
  profile: { kind: "artist" | "band"; id: string; display_name: string };
  title: string;
  gift_items: string;
  description?: string | null;
  /** ARTIST: the band or artist posts the gifts. CORNER_ROOM: Corner Room's team does. */
  sender: "ARTIST" | "CORNER_ROOM";
  include_presale: boolean;
  counts_from?: string | null;
  works: Required<GiftWork>[];
  status: GiftCampaignStatus;
  /** A change to a live campaign, waiting for staff. */
  pending?: Record<string, unknown> | null;
  review_note?: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  counts: GiftCounts;
};

export type GiftRecipient = {
  id: string;
  status: GiftRecipientStatus;
  has_account: boolean;
  prepared_at?: string | null;
  /** A prepared gift set to leave at this time. */
  dispatch_at?: string | null;
  dispatched_at?: string | null;
  /** When it was received, returned or marked missing. */
  outcome_at?: string | null;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type GiftCampaignDetail = GiftCampaign & {
  viewer_role: "owner" | "staff";
  /** Whether this viewer may update the gifts (staff always; the artist when they send them). */
  can_dispatch: boolean;
  shows_contact: boolean;
  /** Where each status may go next (from the API; the page never hard-codes it). */
  transitions: Partial<Record<GiftRecipientStatus, GiftRecipientStatus[]>>;
  recipients: GiftRecipient[];
  /** After an update: how many moved, and how many couldn't make that move. */
  moved?: number | null;
  skipped?: number | null;
};

export type GiftCampaignInput = {
  title?: string;
  gift_items?: string;
  description?: string | null;
  sender?: "ARTIST" | "CORNER_ROOM";
  include_presale?: boolean;
  counts_from?: string | null;
  works?: GiftWork[];
};

export type PublicGift = { id: string; title: string; gift_items: string; description?: string | null; artist: string };

export function fetchGiftCampaigns(kind: "artist" | "band", id: string): Promise<GiftCampaign[]> {
  return apiFetch<GiftCampaign[]>(`/api/v1/studio/profiles/${kind}/${id}/gift-campaigns`);
}

export function createGiftCampaign(kind: "artist" | "band", id: string, body: GiftCampaignInput): Promise<GiftCampaignDetail> {
  return apiFetch<GiftCampaignDetail>(`/api/v1/studio/profiles/${kind}/${id}/gift-campaigns`, {
    method: "POST",
    headers: json,
    body: JSON.stringify(body),
    retry: false,
  });
}

export function fetchGiftCampaign(id: string): Promise<GiftCampaignDetail> {
  return apiFetch<GiftCampaignDetail>(`/api/v1/studio/gift-campaigns/${id}`, { retry: false });
}

export function updateGiftCampaign(id: string, body: GiftCampaignInput): Promise<GiftCampaignDetail> {
  return apiFetch<GiftCampaignDetail>(`/api/v1/studio/gift-campaigns/${id}`, { method: "PATCH", headers: json, body: JSON.stringify(body), retry: false });
}

function act(id: string, action: "submit" | "withdraw" | "pause" | "resume"): Promise<GiftCampaignDetail> {
  return apiFetch<GiftCampaignDetail>(`/api/v1/studio/gift-campaigns/${id}/${action}`, { method: "POST", retry: false });
}

export const submitGiftCampaign = (id: string) => act(id, "submit");
export const withdrawGiftCampaign = (id: string) => act(id, "withdraw");
export const pauseGiftCampaign = (id: string) => act(id, "pause");
export const resumeGiftCampaign = (id: string) => act(id, "resume");

export type GiftMove = {
  to: GiftRecipientStatus;
  /** Chosen gifts, or `every` gift in one status (for example all not prepared yet). */
  recipient_ids?: string[];
  every?: GiftRecipientStatus;
  /** Dispatch at this time (ISO, with its zone) instead of now. */
  dispatch_at?: string;
};

/** Collectible tracking: dispatching tells each buyer it is on its way; returned and missing tell them too. */
export function trackGifts(id: string, move: GiftMove): Promise<GiftCampaignDetail> {
  return apiFetch<GiftCampaignDetail>(`/api/v1/studio/gift-campaigns/${id}/recipients/transition`, {
    method: "POST",
    headers: json,
    body: JSON.stringify(move),
    retry: false,
  });
}

/** Collectible campaigns covering a release, with how far their gifts have got. */
export function fetchReleaseCollectibles(releaseId: string): Promise<GiftCampaign[]> {
  return apiFetch<GiftCampaign[]>(`/api/v1/studio/releases/${releaseId}/collectibles`);
}

/** Staff: campaigns, or changes to live ones, waiting in the active workspace. */
export function fetchGiftReviewQueue(): Promise<GiftCampaign[]> {
  return apiFetch<GiftCampaign[]>("/api/v1/catalog-intake/gift-campaigns");
}

export function reviewGiftCampaign(id: string, action: "approve" | "reject", note?: string): Promise<GiftCampaign> {
  return apiFetch<GiftCampaign>(`/api/v1/catalog-intake/gift-campaigns/${id}/review`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ action, note: note || null }),
    retry: false,
  });
}

/** Live gift campaigns for a release or song (public). */
export function fetchPublicGifts(params: { releaseId?: string; trackId?: string }): Promise<PublicGift[]> {
  const q = params.releaseId ? `release_id=${params.releaseId}` : `track_id=${params.trackId}`;
  return apiFetch<PublicGift[]>(`/api/v1/gift-campaigns?${q}`, { skipAuth: true, skipRefresh: true, retry: false });
}
