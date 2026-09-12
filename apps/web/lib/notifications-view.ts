import type { NotificationRecord } from "@/lib/api";

export const NOTIFICATIONS_EMPTY = "No notifications yet.";

export const DEFAULT_CHANNEL_AVAILABILITY: Record<string, string> = {
  in_app: "AVAILABLE",
  email: "STUB",
  sms: "NOT_AVAILABLE",
  push: "NOT_AVAILABLE",
};

export type ChannelKey = "in_app" | "email" | "sms" | "push";

export const CHANNEL_KEYS: ChannelKey[] = ["in_app", "email", "sms", "push"];

export function parseNotificationList(body: unknown): NotificationRecord[] {
  if (!Array.isArray(body)) {
    throw new Error("Notification list must be a JSON array");
  }
  return body as NotificationRecord[];
}

export function isUnread(row: { status: string; read_at?: string | null }): boolean {
  return row.status !== "READ";
}

export function unreadCount(rows: Array<{ status: string }>): number {
  return rows.filter(isUnread).length;
}

export function applyOptimisticRead<T extends { id: string; status: string; read_at: string | null }>(
  rows: T[],
  id: string,
  readAt: string,
): T[] {
  return rows.map((row) => (row.id === id ? { ...row, status: "READ", read_at: readAt } : row));
}

export function channelStatus(channel: ChannelKey, availability?: Record<string, string>): string {
  return (availability?.[channel] ?? DEFAULT_CHANNEL_AVAILABILITY[channel]).toUpperCase();
}

export function channelHonestyLabel(status: string): string {
  if (status === "AVAILABLE") {
    return "Available";
  }
  if (status === "STUB") {
    return "Stub / not connected";
  }
  if (status === "NOT_AVAILABLE") {
    return "Not available";
  }
  return status;
}

export function channelCanToggle(status: string): boolean {
  return status === "AVAILABLE" || status === "STUB";
}

export function channelActivateAllowed(status: string): boolean {
  void status;
  return false;
}

export function unreadAriaLabel(count: number): string {
  if (count === 0) {
    return "Notifications";
  }
  if (count === 1) {
    return "Notifications, 1 unread";
  }
  return `Notifications, ${count} unread`;
}
