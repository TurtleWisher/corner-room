/* Gift campaigns (owner, 2026-10-28, D-CAMPAIGN-01, D-CAMPAIGN-02). The API decides who may see and
 * do what; these are thin calls. */

import { apiFetch } from "@/lib/api/client";

const json = { "Content-Type": "application/json" };

export type GiftWork = { type: "RELEASE" | "TRACK"; id: string; title?: string };
export type GiftCampaignStatus = "DRAFT" | "IN_REVIEW" | "ACTIVE" | "PAUSED" | "ENDED";
/** Collectible tracking (owner, 2026-11-06, D-CAMPAIGN-03). YET_TO_SEND is "not prepared yet". */
export type GiftRecipientStatus = "YET_TO_SEND" | "PREPARED" | "DISPATCHED" | "RECEIVED" | "RETURNED" | "MISSING";
/** One count per status, TOTAL, and SCHEDULED (prepared with a dispatch time; inside PREPARED). */
/** WAITING: people the act added by hand, waiting for staff (not in TOTAL), D-CAMPAIGN-04. */
export type GiftCounts = Record<GiftRecipientStatus, number> & { TOTAL: number; SCHEDULED: number; WAITING?: number };

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
  /** The act's own status emails waiting for staff (D-CAMPAIGN-05). */
  emails_waiting?: number;
};

export type GiftRecipient = {
  id: string;
  status: GiftRecipientStatus;
  /** BUYER (found on Corner Room or the pre-sale list) or ADDED (typed in or from a sheet). */
  source?: "BUYER" | "ADDED";
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
  /** D-CAMPAIGN-04: whether people can be added now, whether this viewer approves the act's
   * additions, and the additions still waiting for staff. */
  can_add?: boolean;
  can_review?: boolean;
  waiting?: GiftRecipient[];
  /** After an update: how many moved, and how many couldn't make that move. After adding people:
   * how many were added, and how many were already in the campaign. */
  moved?: number | null;
  skipped?: number | null;
  added?: number | null;
};

/** Someone who bought outside Corner Room (D-CAMPAIGN-04): an email or a phone each. */
export type GiftPersonInput = { name: string | null; email: string | null; phone: string | null; address: string | null };

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

/** Add people by hand or from a sheet (staff: at once; the act's: waiting for staff). */
export function addGiftPeople(id: string, people: GiftPersonInput[]): Promise<GiftCampaignDetail> {
  return apiFetch<GiftCampaignDetail>(`/api/v1/studio/gift-campaigns/${id}/recipients`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ people }),
    retry: false,
  });
}

/** Staff approve the act's additions, or turn them away. */
export function reviewGiftPeople(id: string, recipientIds: string[], action: "approve" | "reject"): Promise<GiftCampaignDetail> {
  return apiFetch<GiftCampaignDetail>(`/api/v1/studio/gift-campaigns/${id}/recipients/review`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ recipient_ids: recipientIds, action }),
    retry: false,
  });
}

/** Take back someone added by hand by mistake. */
export function removeGiftPerson(id: string, recipientId: string): Promise<GiftCampaignDetail> {
  return apiFetch<GiftCampaignDetail>(`/api/v1/studio/gift-campaigns/${id}/recipients/${recipientId}`, { method: "DELETE", retry: false });
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

// --- the act's own collectible status emails (D-CAMPAIGN-05) ------------------------------------

export type StatusMailStatus = "DISPATCHED" | "RETURNED" | "MISSING";
export type StatusMailState = "DRAFT" | "IN_REVIEW" | "APPROVED" | "RETURNED";

export type StatusMail = {
  status: StatusMailStatus;
  /** Corner Room's wording: what sends while the act has no approved words of its own. */
  default_subject: string;
  default_body: string;
  subject: string | null;
  body: string | null;
  /** Null: the act hasn't written its own. */
  state: StatusMailState | null;
  review_note: string | null;
  /** The act's approved words are the ones sending. */
  live: boolean;
  live_subject: string | null;
  live_body: string | null;
  sent_count: number;
  submitted_at: string | null;
  approved_at: string | null;
  can_review: boolean;
};

export type StatusMails = {
  campaign: { id: string; title: string; gift_items: string; status: GiftCampaignStatus };
  artist: string;
  music: string;
  viewer_role: "owner" | "staff";
  fill_ins: string[];
  items: StatusMail[];
};

const mailsPath = (id: string) => `/api/v1/studio/gift-campaigns/${id}/status-emails`;

export function fetchStatusMails(id: string): Promise<StatusMails> {
  return apiFetch<StatusMails>(mailsPath(id), { retry: false });
}

export function saveStatusMail(id: string, status: StatusMailStatus, body: { subject: string; body: string }): Promise<StatusMails> {
  return apiFetch<StatusMails>(`${mailsPath(id)}/${status}`, { method: "PUT", headers: json, body: JSON.stringify(body), retry: false });
}

export function submitStatusMail(id: string, status: StatusMailStatus): Promise<StatusMails> {
  return apiFetch<StatusMails>(`${mailsPath(id)}/${status}/submit`, { method: "POST", retry: false });
}

export function reviewStatusMail(id: string, status: StatusMailStatus, action: "approve" | "reject", note?: string): Promise<StatusMails> {
  return apiFetch<StatusMails>(`${mailsPath(id)}/${status}/review`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ action, note: note || null }),
    retry: false,
  });
}

export function resetStatusMail(id: string, status: StatusMailStatus): Promise<StatusMails> {
  return apiFetch<StatusMails>(`${mailsPath(id)}/${status}`, { method: "DELETE", retry: false });
}
