/* Music gifts (owner, 2026-11-06, D-GIFT-MUSIC-01): an artist gives released music free to chosen
 * people by email. The API decides who may see and do what, and gives the music; these are thin calls. */

import { apiFetch } from "@/lib/api/client";

const json = { "Content-Type": "application/json" };

export type GiftActKind = "artist" | "band";
export type MusicGiftWork = { type: "RELEASE" | "TRACK"; id: string; title?: string };
export type MusicGiftStatus = "DRAFT" | "IN_REVIEW" | "SCHEDULED" | "SENT";
/** WAITING: not given yet. GIVEN: owns it now. WAITING_ACCOUNT: emailed, gets it on sign-up. */
export type MusicGiftPersonStatus = "WAITING" | "GIVEN" | "WAITING_ACCOUNT" | "ALREADY_OWNED";
export type MusicGiftCounts = Record<MusicGiftPersonStatus | "TOTAL", number>;

export type MusicGift = {
  id: string;
  profile: { kind: GiftActKind; id: string; display_name: string };
  title: string;
  works: Required<MusicGiftWork>[];
  subject: string;
  body: string;
  file_ids: string[];
  send_at: string | null;
  status: MusicGiftStatus;
  review_note: string | null;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  sent_at: string | null;
  counts: MusicGiftCounts;
};

export type MusicGiftPerson = {
  id: string;
  email: string;
  name: string | null;
  note: string | null;
  status: MusicGiftPersonStatus;
  given_at: string | null;
  emailed_at: string | null;
  /** PENDING, SENT, SUPPRESSED (stopped the act's emails) or FAILED; null before it is given. */
  email_status: "PENDING" | "SENT" | "SUPPRESSED" | "FAILED" | null;
  clicks: number;
};

export type MusicGiftDetail = MusicGift & {
  viewer_role: "owner" | "staff";
  files: { id: string; name: string; kind: "FILE" | "LINK" }[];
  people: MusicGiftPerson[];
};

export type MusicGiftReview = MusicGift & {
  files: { id: string; name: string; kind: "FILE" | "LINK" }[];
  people: { email: string; name: string | null; note: string | null }[];
};

export type PersonInput = { email: string; name?: string | null; note?: string | null };

export type MusicGiftInput = {
  title?: string;
  works?: MusicGiftWork[];
  subject?: string;
  body?: string;
  file_ids?: string[];
  send_at?: string | null;
  /** Replaces the list. */
  people?: PersonInput[];
  /** Adds the act's buyers by reference; their address stays on the server. */
  buyer_refs?: string[];
};

export type GiftSuggestion = { ref: string; name: string | null; label: string };

const send = (body: MusicGiftInput) => JSON.stringify({ ...body, works: body.works?.map(({ type, id }) => ({ type, id })) });

export function fetchMusicGifts(kind: GiftActKind, id: string): Promise<MusicGift[]> {
  return apiFetch<MusicGift[]>(`/api/v1/studio/profiles/${kind}/${id}/music-gifts`);
}

export function fetchGiftSuggestions(kind: GiftActKind, id: string): Promise<GiftSuggestion[]> {
  return apiFetch<GiftSuggestion[]>(`/api/v1/studio/profiles/${kind}/${id}/music-gifts/people`);
}

export function createMusicGift(kind: GiftActKind, id: string, body: MusicGiftInput): Promise<MusicGiftDetail> {
  return apiFetch<MusicGiftDetail>(`/api/v1/studio/profiles/${kind}/${id}/music-gifts`, { method: "POST", headers: json, body: send(body), retry: false });
}

export function fetchMusicGift(id: string): Promise<MusicGiftDetail> {
  return apiFetch<MusicGiftDetail>(`/api/v1/studio/music-gifts/${id}`, { retry: false });
}

export function updateMusicGift(id: string, body: MusicGiftInput): Promise<MusicGiftDetail> {
  return apiFetch<MusicGiftDetail>(`/api/v1/studio/music-gifts/${id}`, { method: "PATCH", headers: json, body: send(body), retry: false });
}

export function discardMusicGift(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/studio/music-gifts/${id}`, { method: "DELETE", retry: false });
}

function act(id: string, action: "submit" | "withdraw" | "copy"): Promise<MusicGiftDetail> {
  return apiFetch<MusicGiftDetail>(`/api/v1/studio/music-gifts/${id}/${action}`, { method: "POST", retry: false });
}

export const submitMusicGift = (id: string) => act(id, "submit");
export const withdrawMusicGift = (id: string) => act(id, "withdraw");
export const copyMusicGift = (id: string) => act(id, "copy");

/** The gift's email, as the first person on the list gets it, to your own address. */
export function sendMusicGiftTest(id: string): Promise<{ sent_to: string }> {
  return apiFetch<{ sent_to: string }>(`/api/v1/studio/music-gifts/${id}/test`, { method: "POST", retry: false });
}

/** Staff: music gifts waiting for review in the active workspace. */
export function fetchMusicGiftReviewQueue(): Promise<MusicGiftReview[]> {
  return apiFetch<MusicGiftReview[]>("/api/v1/catalog-intake/music-gifts");
}

export function reviewMusicGift(id: string, action: "approve" | "reject", note?: string): Promise<MusicGift> {
  return apiFetch<MusicGift>(`/api/v1/catalog-intake/music-gifts/${id}/review`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ action, note: note || null }),
    retry: false,
  });
}
