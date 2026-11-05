/* Pre-sale campaigns (owner, 2026-11-06, D-PRESALE-04): the public pre-sale list, live counting,
 * and the artist's campaign numbers and share links. The API counts and sums everything; the web
 * app only sends what happened (a page opened, Pre-book pressed) and formats what comes back. */

import { apiFetch, getAccessToken, getApiBaseUrl } from "@/lib/api/client";
import type { PresalePageRecord } from "@/features/catalog/api";

export type PresalePlace = "PAGE" | "STORE" | "HOME" | "RELEASES" | "PROFILE";

/** Releases on pre-sale now, soonest first. Public; songs are never in it. */
export async function fetchPresales(filter?: { artistId?: string; bandId?: string; limit?: number }): Promise<PresalePageRecord[]> {
  const q = new URLSearchParams();
  if (filter?.artistId) q.set("artist_id", filter.artistId);
  if (filter?.bandId) q.set("band_id", filter.bandId);
  if (filter?.limit) q.set("limit", String(filter.limit));
  const qs = q.toString();
  const page = await apiFetch<{ items: PresalePageRecord[] }>(`/api/v1/presales/releases${qs ? `?${qs}` : ""}`, {
    retry: false,
    skipAuth: true,
    skipRefresh: true,
  });
  return page.items;
}

/**
 * One page open or Pre-book press for the release's live numbers. Fire and forget: `keepalive`
 * lets a press that leaves the page still arrive. Sent with the signed-in token, if any, only so
 * the server can leave out the artist's own team and staff; nothing about the visitor is kept.
 */
export function countPresale(
  releaseId: string,
  body: { kind: "view" | "prebook"; place: PresalePlace; source?: string | null; referrer?: string | null },
): void {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  const token = getAccessToken();
  try {
    void fetch(`${getApiBaseUrl()}/api/v1/presales/releases/${encodeURIComponent(releaseId)}/count`, {
      method: "POST",
      keepalive: true,
      credentials: "omit",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ kind: body.kind, place: body.place, source: body.source ?? null, referrer: body.referrer ?? null }),
    }).catch(() => undefined);
  } catch {
    /* counting never gets in a fan's way */
  }
}

export type MoneyTotal = {
  currency_code: string;
  gross_amount_minor: number;
  refunded_amount_minor: number;
  net_amount_minor: number;
};

export type CampaignView = {
  views: number;
  prebook_clicks: number;
  checkout_started: number;
  orders: number;
  free_copies: number;
  refunded_orders: number;
  buyers: number;
  /** Orders per page opened in basis points; null when nothing was opened ("Not available"). */
  conversion_bps: number | null;
  /** Null when this person may not see money (catalog staff without finance rights). */
  money: MoneyTotal[] | null;
  places: { place: PresalePlace; views: number; prebook_clicks: number }[];
  links: { code: string; label: string; views: number; prebook_clicks: number }[];
  /** host null: no site named (typed in, a saved link, an app that hides where it came from). */
  sites: { host: string | null; views: number }[];
  timeline: { day: string; views: number; prebook_clicks: number; orders: number }[];
  /** Since release and all: single songs bought on their own, a line of their own (never added in). */
  songs?: { orders: number; buyers: number; money: MoneyTotal[] | null };
};

export type CampaignMilestone = { kind: string; at: string };

export type CampaignNumbers = {
  release_id: string;
  title: string;
  release_status: string;
  release_at: string | null;
  released_at: string | null;
  had_presale: boolean;
  money_visible: boolean;
  as_of: string;
  presale: CampaignView;
  since_release: CampaignView | null;
  all: CampaignView;
  milestones: CampaignMilestone[];
};

export async function fetchCampaignNumbers(releaseId: string): Promise<CampaignNumbers> {
  return apiFetch<CampaignNumbers>(`/api/v1/studio/releases/${releaseId}/numbers`, { retry: false });
}

export type CampaignState = "DRAFT" | "IN_REVIEW" | "RETURNED" | "APPROVED" | "LIVE" | "WAITING" | "RELEASED" | "ENDED";

export type CampaignCard = {
  id: string;
  title: string;
  release_type: string;
  release_status: string;
  release_at: string | null;
  artist: string;
  artist_kind: "artist" | "band";
  artist_id: string;
  cover_url: string | null;
  state: CampaignState;
  preorders: number;
  views: number;
};

export type CampaignList = {
  items: CampaignCard[];
  can_start: { id: string; title: string; release_type: string; artist: string }[];
};

export async function fetchCampaigns(): Promise<CampaignList> {
  return apiFetch<CampaignList>("/api/v1/studio/presales", { retry: false });
}

export type ShareLink = {
  id: string;
  label: string;
  code: string;
  url: string;
  created_at: string;
  archived: boolean;
  views: number;
  prebook_clicks: number;
};

export async function fetchShareLinks(releaseId: string): Promise<ShareLink[]> {
  return apiFetch<ShareLink[]>(`/api/v1/studio/releases/${releaseId}/share-links`, { retry: false });
}

export async function addShareLink(releaseId: string, label: string): Promise<ShareLink[]> {
  return apiFetch<ShareLink[]>(`/api/v1/studio/releases/${releaseId}/share-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
}

export async function archiveShareLink(releaseId: string, linkId: string): Promise<ShareLink[]> {
  return apiFetch<ShareLink[]>(`/api/v1/studio/releases/${releaseId}/share-links/${linkId}/archive`, { method: "POST" });
}
