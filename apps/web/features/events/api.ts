/* Events, venues and milestones. Split from lib/api.ts (Phase 16, Stage 5). */

import { type Page } from "@/features/identity/api";
import type { ArtworkReport } from "@/features/uploads/api";
import { apiFetch } from "@/lib/api/client";

export type EventRecord = {
  id: string;
  organization_id?: string;
  venue_id: string | null;
  title: string;
  description: string | null;
  status: string;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  published_at?: string | null;
  cancelled_at?: string | null;
  postponed_at?: string | null;
  cancellation_reason?: string | null;
  postponement_reason?: string | null;
  previous_starts_at?: string | null;
  previous_ends_at?: string | null;
  version?: number;
  /** An accepted official poster is attached (OD-06); the image comes from /covers. */
  has_cover?: boolean;
  /** Public responses only: the venue's name and city when the event has an active venue (D-EV-03). */
  venue?: { name: string; city: string | null } | null;
};

export type VenueRecord = {
  id: string;
  organization_id: string;
  name: string;
  address: Record<string, unknown> | null;
  capacity: number;
  status: string;
  version: number;
};

export type MilestoneRecord = {
  id: string;
  event_id: string;
  type: string;
  occurred_at: string;
  previous_state: string | null;
  new_state: string | null;
  description: string | null;
};

export async function fetchEvents(): Promise<Page<EventRecord>> {
  return apiFetch<Page<EventRecord>>("/api/v1/events", { retry: false });
}

export async function fetchPublicEvents(cursor?: string | null): Promise<Page<EventRecord>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<Page<EventRecord>>(`/api/v1/events${query}`, { retry: false, skipAuth: true, skipRefresh: true });
}

export async function fetchEvent(id: string, opts?: { skipAuth?: boolean }): Promise<EventRecord> {
  return apiFetch<EventRecord>(`/api/v1/events/${id}`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function createEvent(body: {
  title: string;
  timezone: string;
  description?: string;
  starts_at?: string;
  ends_at?: string;
}): Promise<EventRecord> {
  return apiFetch<EventRecord>("/api/v1/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function updateEvent(
  id: string,
  body: Partial<{
    title: string;
    description: string | null;
    timezone: string;
    starts_at: string | null;
    ends_at: string | null;
    version: number;
  }>,
): Promise<EventRecord> {
  return apiFetch<EventRecord>(`/api/v1/events/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionEvent(
  id: string,
  body: {
    action: string;
    starts_at?: string;
    ends_at?: string;
    reason?: string;
    resume_status?: string;
    version?: number;
  },
): Promise<EventRecord> {
  return apiFetch<EventRecord>(`/api/v1/events/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function assignEventVenue(id: string, venue_id: string | null, version?: number): Promise<EventRecord> {
  return apiFetch<EventRecord>(`/api/v1/events/${id}/venue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ venue_id, version }),
    retry: false,
  });
}

export async function fetchMilestones(id: string): Promise<Page<MilestoneRecord>> {
  return apiFetch<Page<MilestoneRecord>>(`/api/v1/events/${id}/milestones`, { retry: false });
}

export async function fetchVenues(): Promise<Page<VenueRecord>> {
  return apiFetch<Page<VenueRecord>>("/api/v1/venues", { retry: false });
}

export async function fetchVenue(id: string): Promise<VenueRecord> {
  return apiFetch<VenueRecord>(`/api/v1/venues/${id}`, { retry: false });
}

export async function createVenue(body: {
  name: string;
  capacity?: number;
  address?: Record<string, unknown>;
}): Promise<VenueRecord> {
  return apiFetch<VenueRecord>("/api/v1/venues", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function updateVenue(
  id: string,
  body: Partial<{ name: string; capacity: number; address: Record<string, unknown> | null; version: number }>,
): Promise<VenueRecord> {
  return apiFetch<VenueRecord>(`/api/v1/venues/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionVenue(id: string, action: string, version?: number): Promise<VenueRecord> {
  return apiFetch<VenueRecord>(`/api/v1/venues/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

/** Staff: the latest poster upload and its check results, with a signed link to the poster in use (OD-06). */
export function fetchEventCoverReport(eventId: string): Promise<ArtworkReport | null> {
  return apiFetch<ArtworkReport | null>(`/api/v1/events/${eventId}/cover-report`);
}
