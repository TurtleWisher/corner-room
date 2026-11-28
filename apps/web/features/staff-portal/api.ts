/* Staff portal (owner, 2026-11-28): staff accounts by email (D-STAFF-ACCOUNTS-01), staff activity,
 * the one-page overview, and each artist's royalty rate (D-ROYALTY-RATE-01). The API decides every
 * permission and works out every amount; the web app only shows what it sends. */

import { apiFetch } from "@/lib/api/client";

export type StaffLevel = "OWNER" | "ADMIN" | "STAFF";

export type StaffArea = { key: string; label: string; does: string; group: string };

export type StaffAccount = {
  user_id: string;
  name: string;
  email: string | null;
  picture_url: string | null;
  level: StaffLevel;
  areas: string[];
  status: string;
  google_linked: boolean;
  last_active_at: string | null;
  actions_7d: number;
  is_you: boolean;
  can_change: boolean;
};

export type StaffInvite = {
  id: string;
  email: string;
  level: "ADMIN" | "STAFF";
  areas: string[];
  note: string | null;
  invited_at: string;
  invited_by: string | null;
  can_cancel: boolean;
};

export type StaffAccounts = {
  accounts: StaffAccount[];
  invites: StaffInvite[];
  areas: StaffArea[];
  can_add_levels: ("ADMIN" | "STAFF")[];
};

export function fetchStaffAccounts(): Promise<StaffAccounts> {
  return apiFetch<StaffAccounts>("/api/v1/staff/accounts");
}

export function addStaffAccount(body: { email: string; level: "ADMIN" | "STAFF"; areas: string[]; note?: string }) {
  return apiFetch<{ state: "ADDED" | "WAITING"; user_id: string | null; invite_id: string | null }>("/api/v1/staff/accounts", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function changeStaffAccount(userId: string, body: { level: "ADMIN" | "STAFF"; areas: string[] }) {
  return apiFetch<{ level: string; areas: string[] }>(`/api/v1/staff/accounts/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function removeStaffAccount(userId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/staff/accounts/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

export function cancelStaffInvite(inviteId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/staff/accounts/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
}

/** Picks up a staff invite waiting under the signed-in person's verified email, at once. */
export function claimStaffInvite(): Promise<{ claimed: boolean }> {
  return apiFetch<{ claimed: boolean }>("/api/v1/me/staff-invite/claim", { method: "POST", retry: false });
}

// ----- overview and activity ----------------------------------------------------------------

export type MoneyTotal = { currency_code: string; amount_7d_minor: number; amount_30d_minor: number };

export type StaffOverview = {
  generated_at: string;
  sales?: {
    music_orders_today: number;
    music_orders_7d: number;
    music_orders_30d: number;
    ticket_orders_7d: number;
    series: { day: string; music_orders: number }[];
    /** Finance readers only. */
    money?: MoneyTotal[];
  };
  people?: { accounts: number; new_7d: number; new_24h: number };
  music?: { releases_out: number; songs_out: number; active_artists: number; listens_7d: number };
  live?: { upcoming_events: number; draft_events: number };
  royalties?: { artists_with_rate: number; sales_without_rate: number; artists_waiting_for_rate: number };
  staff?: { owners: number; admins: number; staff: number; waiting_invites: number; actions_24h: number };
};

export function fetchStaffOverview(): Promise<StaffOverview> {
  return apiFetch<StaffOverview>("/api/v1/staff/overview");
}

export type ActivityItem = {
  id: string;
  occurred_at: string;
  actor_id: string;
  actor_name: string;
  actor_picture_url: string | null;
  actor_level: StaffLevel | null;
  action: string;
  area: string;
  entity_type: string;
  entity_id: string;
  reason: string | null;
};

export type ActivityPage = { items: ActivityItem[]; next_before: string | null; areas: string[] };

export function fetchStaffActivity(params: { actor?: string; area?: string; q?: string; before?: string; limit?: number; signIns?: boolean } = {}) {
  const qs = new URLSearchParams();
  if (params.actor) qs.set("actor", params.actor);
  if (params.area) qs.set("area", params.area);
  if (params.q) qs.set("q", params.q);
  if (params.before) qs.set("before", params.before);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.signIns) qs.set("sign_ins", "true");
  const tail = qs.toString();
  return apiFetch<ActivityPage>(`/api/v1/staff/activity${tail ? `?${tail}` : ""}`);
}

export type ActivityPerson = {
  user_id: string;
  name: string;
  picture_url: string | null;
  level: StaffLevel;
  actions_today: number;
  actions_7d: number;
  actions_30d: number;
  last_active_at: string | null;
  top_areas: string[];
};

export async function fetchStaffActivityPeople(): Promise<ActivityPerson[]> {
  return (await apiFetch<{ people: ActivityPerson[] }>("/api/v1/staff/activity/people")).people;
}

// ----- royalty rates ------------------------------------------------------------------------

export type RateMoney = {
  currency_code: string;
  sales: number;
  paid_minor: number;
  refunded_minor: number;
  earned_minor: number;
  no_rate_sales: number;
  no_rate_paid_minor: number;
};

export type RateTotals = { by_currency: RateMoney[]; sales: number; no_rate_sales: number; last_sale_at: string | null };

export type ArtistRateRow = RateTotals & {
  artist_id: string;
  name: string;
  kind: string;
  status: string;
  share_bps: number | null;
  rate_since: string | null;
  rate_set_at: string | null;
  has_history: boolean;
};

export type RateSale = {
  id: string;
  kind: "TRACK" | "RELEASE";
  title: string | null;
  made_at: string;
  paid_minor: number;
  refunded_minor: number;
  currency_code: string;
  share_bps: number | null;
  earned_minor: number | null;
  how: "GIFT" | "CREDIT" | "PRESALE" | null;
};

export type RateHistory = {
  id: string;
  share_bps: number;
  effective_from: string | null;
  effective_to: string | null;
  covers_earlier: boolean;
  note: string | null;
  set_at: string;
  set_by: string | null;
  ended_by: string | null;
};

export type ArtistRateDetail = {
  artist_id: string;
  name: string;
  kind: string;
  share_bps: number | null;
  can_set: boolean;
  totals: RateTotals;
  earlier_without_rate: { sales: number; by_currency: { currency_code: string; paid_minor: number }[] };
  history: RateHistory[];
  sales: RateSale[];
};

export function fetchArtistRates(q?: string): Promise<{ items: ArtistRateRow[]; can_set: boolean }> {
  const tail = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  return apiFetch(`/api/v1/staff/royalty-rates${tail}`);
}

export function fetchArtistRate(artistId: string): Promise<ArtistRateDetail> {
  return apiFetch(`/api/v1/staff/royalty-rates/${encodeURIComponent(artistId)}`);
}

export function setArtistRate(artistId: string, body: { share_bps: number; note?: string; cover_earlier: boolean }): Promise<ArtistRateDetail> {
  return apiFetch(`/api/v1/staff/royalty-rates/${encodeURIComponent(artistId)}`, { method: "PUT", body: JSON.stringify(body) });
}

export function endArtistRate(artistId: string, note?: string): Promise<ArtistRateDetail> {
  return apiFetch(`/api/v1/staff/royalty-rates/${encodeURIComponent(artistId)}/end`, { method: "POST", body: JSON.stringify({ note }) });
}

export type MyActRate = RateTotals & {
  artist_id: string;
  name: string;
  kind: string;
  share_bps: number | null;
  rate_since: string | null;
  sales_lines: RateSale[];
};

export async function fetchMyRoyaltyRates(): Promise<MyActRate[]> {
  return (await apiFetch<{ acts: MyActRate[] }>("/api/v1/me/royalty-rates")).acts;
}
