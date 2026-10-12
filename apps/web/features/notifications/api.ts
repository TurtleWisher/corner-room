/* Notifications and channel preferences. Split from lib/api.ts (Phase 16, Stage 5). */

import { apiFetch } from "@/lib/api/client";

export type NotificationRecord = {
  id: string;
  type: string;
  status: string;
  title: string;
  body: string;
  locale: string;
  read_at: string | null;
  category?: string | null;
  organization_id?: string | null;
  correlation_id?: string | null;
  aggregate_type?: string | null;
  aggregate_id?: string | null;
};

export type NotificationPreferenceRecord = {
  notification_type: string;
  in_app: boolean;
  email: boolean;
  push: boolean;
  sms: boolean;
  channel_availability: Record<string, string>;
};

export async function fetchMyNotifications(limit = 50): Promise<NotificationRecord[]> {
  return apiFetch<NotificationRecord[]>(`/api/v1/me/notifications?limit=${limit}`, { retry: false });
}

export async function markNotificationRead(id: string): Promise<NotificationRecord> {
  return apiFetch<NotificationRecord>(`/api/v1/me/notifications/${id}/read`, {
    method: "POST",
    retry: false,
  });
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferenceRecord[]> {
  return apiFetch<NotificationPreferenceRecord[]>("/api/v1/me/notification-preferences", {
    retry: false,
  });
}

export async function putNotificationPreference(body: {
  notification_type: string;
  in_app: boolean;
  email: boolean;
  push?: boolean;
  sms?: boolean;
}): Promise<NotificationPreferenceRecord> {
  return apiFetch<NotificationPreferenceRecord>("/api/v1/me/notification-preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      notification_type: body.notification_type,
      in_app: body.in_app,
      email: body.email,
      push: body.push ?? false,
      sms: body.sms ?? false,
    }),
    retry: false,
  });
}
