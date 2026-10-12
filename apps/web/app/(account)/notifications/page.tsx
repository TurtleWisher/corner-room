"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { Button, EmptyState, ErrorState, Skeleton } from "@/components/ds";
import { useNotifications } from "@/components/notifications-provider";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchNotificationPreferences, putNotificationPreference, type NotificationPreferenceRecord } from "@/lib/api";
import { friendlyError } from "@/lib/error-copy";
import { humanizeStatus } from "@/lib/format/status";
import { CHANNEL_KEYS, channelCanToggle, channelHonestyLabel, channelStatus, isUnread, type ChannelKey } from "@/lib/notifications-view";
import { cn } from "@/lib/utils";

const CHANNEL: Record<ChannelKey, string> = { in_app: "In the app", email: "Email", sms: "SMS", push: "Push" };

/** "ticket.issued" -> "Ticket issued". */
function typeLabel(type: string): string {
  return humanizeStatus(type.replace(/\./g, " "));
}

function Feed() {
  const { items, loading, error, reload, markRead } = useNotifications();
  const [failed, setFailed] = useState<string | null>(null);
  if (loading && items.length === 0) return <Skeleton className="h-40 w-full" />;
  if (error) return <ErrorState title="Notifications unavailable" message={error} action={<RetryButton onClick={() => void reload()} />} />;
  if (items.length === 0) return <EmptyState title="No notifications yet" body="Updates about your tickets, purchases and plan appear here." />;
  return (
    <>
      {failed ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {failed}
        </p>
      ) : null}
      <ul className="divide-y divide-line border-y border-line">
        {items.map((n) => {
          const unread = isUnread(n);
          return (
            <li key={n.id} className="flex items-start gap-4 py-4">
              <span aria-hidden="true" className={cn("mt-1.5 size-2.5 shrink-0", unread ? "bg-accent" : "bg-transparent")} />
              <div className="min-w-0 flex-1">
                <p className={cn("text-fg", unread ? "font-bold" : "font-medium")}>
                  {unread ? <span className="sr-only">New: </span> : null}
                  {n.title}
                </p>
                {n.body ? <p className="mt-1 text-sm text-fg-muted">{n.body}</p> : null}
                <p className="mt-1 text-xs text-fg-muted">{n.category ? humanizeStatus(n.category) : typeLabel(n.type)}</p>
              </div>
              {unread ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Mark "${n.title}" as read`}
                  onClick={() => void markRead(n.id).catch((err) => setFailed(friendlyError(err, "That could not be marked as read.")))}
                >
                  <Check aria-hidden="true" /> Mark read
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Preferences() {
  const { items } = useNotifications();
  const prefs = useAsync(() => fetchNotificationPreferences(), []);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, NotificationPreferenceRecord>>({});

  if (prefs.status === "loading") return <Skeleton className="h-32 w-full" />;
  if (prefs.status === "error") {
    return <ErrorState title="Preferences unavailable" message={loadErrorMessage(prefs.error, "your preferences")} action={<RetryButton onClick={prefs.reload} />} />;
  }
  const availability = prefs.data[0]?.channel_availability;
  const saved = new Map(prefs.data.map((p) => [p.notification_type, p]));
  // Types you have received or already set; the API has no catalogue of types to offer.
  const types = [...new Set([...prefs.data.map((p) => p.notification_type), ...items.map((n) => n.type)])].sort();

  async function toggle(type: string, channel: ChannelKey, value: boolean) {
    const current = local[type] ?? saved.get(type) ?? { notification_type: type, in_app: true, email: true, push: false, sms: false, channel_availability: availability ?? {} };
    const next = { ...current, [channel]: value };
    setSaving(`${type}:${channel}`);
    setError(null);
    try {
      const out = await putNotificationPreference({ notification_type: type, in_app: next.in_app, email: next.email, push: next.push, sms: next.sms });
      setLocal((l) => ({ ...l, [type]: out }));
    } catch (err) {
      setError(friendlyError(err, "That preference could not be saved."));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <ul className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-muted">
        {CHANNEL_KEYS.map((c) => (
          <li key={c}>
            {CHANNEL[c]}: {channelHonestyLabel(channelStatus(c, availability))}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {types.length === 0 ? (
        <p className="text-sm text-fg-muted">Preferences appear here once you start receiving notifications.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-fg-muted">
              <th className="py-2 font-semibold">Notification</th>
              {(["in_app", "email"] as ChannelKey[]).map((c) => (
                <th key={c} className="py-2 text-center font-semibold">
                  {CHANNEL[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.map((type) => {
              const p = local[type] ?? saved.get(type);
              return (
                <tr key={type} className="border-b border-line">
                  <td className="py-3 text-fg">{typeLabel(type)}</td>
                  {(["in_app", "email"] as ChannelKey[]).map((c) => {
                    const status = channelStatus(c, availability);
                    const can = channelCanToggle(status);
                    const on = p ? Boolean(p[c]) : true;
                    return (
                      <td key={c} className="py-3 text-center">
                        <input
                          type="checkbox"
                          className="cr-focus size-4 accent-[var(--cr-highlight)]"
                          checked={on}
                          disabled={!can || saving === `${type}:${c}`}
                          aria-label={`${typeLabel(type)} by ${CHANNEL[c]}${can ? "" : ` (${channelHonestyLabel(status)})`}`}
                          onChange={(e) => void toggle(type, c, e.target.checked)}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <AccountPage eyebrow="Your account" title="Notifications" what="your notifications">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="feed">
          <h2 id="feed" className="mb-4 text-xl font-bold text-fg">
            Inbox
          </h2>
          <Feed />
        </section>
        <section aria-labelledby="prefs">
          <h2 id="prefs" className="mb-4 text-xl font-bold text-fg">
            How we reach you
          </h2>
          <Preferences />
        </section>
      </div>
    </AccountPage>
  );
}
