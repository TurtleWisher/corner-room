"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

import { useNotifications } from "@/components/notifications-provider";
import { unreadAriaLabel, unreadCount } from "@/lib/notifications-view";

export function NotificationBell() {
  const { items } = useNotifications();
  const count = unreadCount(items);

  return (
    <Link
      href="/notifications"
      className="relative inline-flex items-center gap-1 rounded-md px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2"
      aria-label={unreadAriaLabel(count)}
    >
      <Bell className="h-4 w-4" aria-hidden="true" />
      {count > 0 ? (
        <span className="rounded-full bg-neutral-900 px-1.5 text-xs font-medium text-white">
          {count} unread
        </span>
      ) : (
        <span className="sr-only">No unread notifications</span>
      )}
    </Link>
  );
}
