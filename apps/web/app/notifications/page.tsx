"use client";

import { FormEvent, useEffect, useState } from "react";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { useNotifications } from "@/components/notifications-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, fetchNotificationPreferences, putNotificationPreference, type NotificationPreferenceRecord } from "@/lib/api";
import {
  CHANNEL_KEYS,
  NOTIFICATIONS_EMPTY,
  channelCanToggle,
  channelHonestyLabel,
  channelStatus,
  isUnread,
} from "@/lib/notifications-view";

function ChannelMatrix({ availability }: { availability?: Record<string, string> }) {
  return (
    <ul className="space-y-2 text-sm">
      {CHANNEL_KEYS.map((channel) => {
        const status = channelStatus(channel, availability);
        const label =
          channel === "in_app"
            ? "In-app"
            : channel === "email"
              ? "Email"
              : channel === "sms"
                ? "SMS"
                : "Push";
        return (
          <li key={channel} className="flex flex-wrap items-baseline justify-between gap-2">
            <span>{label}</span>
            <span>{channelHonestyLabel(status)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function NotificationsBody() {
  const { items, loading, error, reload, markRead } = useNotifications();
  const [actionError, setActionError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferenceRecord[]>([]);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [notificationType, setNotificationType] = useState("");
  const [inApp, setInApp] = useState(true);
  const [email, setEmail] = useState(true);

  async function loadPrefs() {
    setPrefsLoading(true);
    setPrefsError(null);
    try {
      setPrefs(await fetchNotificationPreferences());
    } catch (err) {
      setPrefsError(err instanceof ApiError ? err.message : "Unable to load preferences");
    } finally {
      setPrefsLoading(false);
    }
  }

  useEffect(() => {
    void loadPrefs();
  }, []);

  async function onMarkRead(id: string) {
    setActionError(null);
    try {
      await markRead(id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Unable to mark as read");
    }
  }

  async function onSavePreference(form: FormEvent) {
    form.preventDefault();
    if (!notificationType.trim()) {
      setPrefsError("Notification type is required.");
      return;
    }
    setPrefsError(null);
    try {
      await putNotificationPreference({
        notification_type: notificationType,
        in_app: inApp,
        email,
        push: false,
        sms: false,
      });
      setNotificationType("");
      await loadPrefs();
    } catch (err) {
      setPrefsError(err instanceof ApiError ? err.message : "Unable to save preference");
    }
  }

  const availability = prefs[0]?.channel_availability;
  const emailStatus = channelStatus("email", availability);
  const inAppStatus = channelStatus("in_app", availability);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-neutral-600">Your in-app inbox. This is not a promotional blast.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void reload()}>
          Refresh
        </Button>
      </div>
      {error ? <ErrorState message={error} /> : null}
      {actionError ? <ErrorState message={actionError} /> : null}
      {loading ? <LoadingState label="Loading notifications" /> : null}
      {!loading && items.length === 0 ? <EmptyState message={NOTIFICATIONS_EMPTY} /> : null}
      <section className="space-y-3" aria-label="Notification list">
        {items.map((row) => {
          const unread = isUnread(row);
          return (
            <Card
              key={row.id}
              className={unread ? "border-neutral-900" : undefined}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className={unread ? "font-semibold" : "font-medium"}>{row.title}</p>
                  <p className="text-sm text-neutral-600">{row.body}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {unread ? "Unread" : "Read"}
                    {row.category ? ` · ${row.category}` : ""}
                  </p>
                </div>
                {unread ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => void onMarkRead(row.id)}>
                    Mark read
                  </Button>
                ) : null}
              </div>
            </Card>
          );
        })}
      </section>
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Preferences</h2>
        <p className="text-sm text-neutral-600">
          Channel availability comes from the API. SMS and push are not connected.
        </p>
        {prefsLoading ? <LoadingState label="Loading preferences" /> : null}
        {prefsError ? <ErrorState message={prefsError} /> : null}
        <Card>
          <ChannelMatrix availability={availability} />
        </Card>
        {prefs.map((pref) => (
          <Card key={pref.notification_type}>
            <p className="font-medium">{pref.notification_type}</p>
            <p className="text-sm text-neutral-600">
              In-app {pref.in_app ? "on" : "off"} · Email {pref.email ? "on" : "off"}
            </p>
          </Card>
        ))}
        <form className="space-y-3" onSubmit={(event) => void onSavePreference(event)}>
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-600">Notification type</span>
            <Input
              value={notificationType}
              onChange={(event) => setNotificationType(event.target.value)}
              placeholder="user.registered"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={inApp}
              disabled={!channelCanToggle(inAppStatus)}
              onChange={(event) => setInApp(event.target.checked)}
            />
            In-app ({channelHonestyLabel(inAppStatus)})
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={email}
              disabled={!channelCanToggle(emailStatus)}
              onChange={(event) => setEmail(event.target.checked)}
            />
            Email ({channelHonestyLabel(emailStatus)})
          </label>
          <p className="text-sm text-neutral-600">SMS: Not available. Push: Not available.</p>
          <Button type="submit">Save preference</Button>
        </form>
      </section>
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Protected>
      <NotificationsBody />
    </Protected>
  );
}
