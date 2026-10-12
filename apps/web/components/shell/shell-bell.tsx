"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

import { useNotifications } from "@/components/notifications-provider";
import { unreadAriaLabel, unreadCount } from "@/lib/notifications-view";
import { cn } from "@/lib/utils";

/**
 * Notification link for the Stage 5 shells. The count covers the first page the API returns
 * (no unread-count endpoint exists), the same rule as the legacy bell.
 */
export function ShellBell({ className }: { className?: string }) {
  const { items } = useNotifications();
  const count = unreadCount(items);
  return (
    <Link
      href="/notifications"
      aria-label={unreadAriaLabel(count)}
      title="Notifications"
      className={cn("cr-focus relative inline-flex size-10 items-center justify-center text-fg hover:text-highlight", className)}
    >
      <Bell className="size-5" aria-hidden="true" />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="cr-num absolute right-0.5 top-0.5 min-w-5 bg-accent px-1 text-center text-[0.6875rem] leading-5 text-on-accent"
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}
