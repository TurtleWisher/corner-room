/* Staff and module analytics. Split from lib/api.ts (Phase 16, Stage 5). */

import { apiFetch } from "@/lib/api/client";

function analyticsRangeQuery(from?: string | null, to?: string | null): string {
  const params = new URLSearchParams();
  if (from) {
    params.set("from", from);
  }
  if (to) {
    params.set("to", to);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export type StaffAnalyticsOverview = {
  organization_id: string;
  from?: string | null;
  from_date?: string | null;
  to?: string | null;
  metric_timezone: string;
  metric_timezone_status: string;
  tracks: {
    play_count: number;
    completed_play_count: number;
    listen_duration_ms: number;
    unique_listeners: string;
  };
  events: {
    ticket_paid_count: number;
    ticket_issued_count: number;
    ticket_checked_in_count: number;
  };
  campaigns: {
    ingested_event_count: number;
    attribution_status: string;
  };
  money: { status: string };
};

export type TrackAnalyticsRecord = {
  track_id: string;
  from?: string | null;
  from_date?: string | null;
  to?: string | null;
  metric_timezone: string;
  metric_timezone_status: string;
  play_count: number;
  completed_play_count: number;
  listen_duration_ms: number;
  unique_listeners: string;
};

export type EventAnalyticsRecord = {
  event_id: string;
  from?: string | null;
  from_date?: string | null;
  to?: string | null;
  metric_timezone: string;
  metric_timezone_status: string;
  ticket_paid_count: number;
  ticket_issued_count: number;
  ticket_checked_in_count: number;
  unique_listeners: string;
};

export type CampaignAnalyticsRecord = {
  campaign_id: string;
  from?: string | null;
  from_date?: string | null;
  to?: string | null;
  metric_timezone: string;
  metric_timezone_status: string;
  ingested_event_count: number;
  attribution_status: string;
};

export type ArtistAnalyticsRecord = {
  artist_id: string;
  from?: string | null;
  from_date?: string | null;
  to?: string | null;
  metric_timezone: string;
  metric_timezone_status: string;
  unique_listeners: string;
};

export async function fetchStaffAnalyticsOverview(
  from?: string | null,
  to?: string | null,
): Promise<StaffAnalyticsOverview> {
  return apiFetch<StaffAnalyticsOverview>(
    `/api/v1/staff/analytics/overview${analyticsRangeQuery(from, to)}`,
    { retry: false },
  );
}

export async function fetchTrackAnalytics(
  id: string,
  from?: string | null,
  to?: string | null,
): Promise<TrackAnalyticsRecord> {
  return apiFetch<TrackAnalyticsRecord>(
    `/api/v1/analytics/tracks/${id}${analyticsRangeQuery(from, to)}`,
    { retry: false },
  );
}

export async function fetchEventAnalytics(
  id: string,
  from?: string | null,
  to?: string | null,
): Promise<EventAnalyticsRecord> {
  return apiFetch<EventAnalyticsRecord>(
    `/api/v1/analytics/events/${id}${analyticsRangeQuery(from, to)}`,
    { retry: false },
  );
}

export async function fetchCampaignAnalytics(
  id: string,
  from?: string | null,
  to?: string | null,
): Promise<CampaignAnalyticsRecord> {
  return apiFetch<CampaignAnalyticsRecord>(
    `/api/v1/analytics/campaigns/${id}${analyticsRangeQuery(from, to)}`,
    { retry: false },
  );
}

export async function fetchArtistModuleAnalytics(
  id: string,
  from?: string | null,
  to?: string | null,
): Promise<ArtistAnalyticsRecord> {
  return apiFetch<ArtistAnalyticsRecord>(
    `/api/v1/analytics/artists/${id}${analyticsRangeQuery(from, to)}`,
    { retry: false },
  );
}
