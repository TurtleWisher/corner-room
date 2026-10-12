"use client";

import { useState } from "react";
import { LogOut, MonitorSmartphone } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Avatar, Button, Card, DateTime, ErrorState, Skeleton, StatusChip } from "@/components/ds";
import { Dialog } from "@/components/ds/dialog";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMySessions, revokeAllSessions, revokeSession } from "@/lib/api";
import { defineStatusMap } from "@/lib/format/status";

const USER_STATUS = defineStatusMap({
  ACTIVE: { label: "Active", tone: "positive" },
  PENDING_VERIFICATION: { label: "Awaiting verification", tone: "warning" },
  SUSPENDED: { label: "Suspended", tone: "negative" },
});

/** "Chrome on Windows" from a user agent, or the raw text when it is unusual. */
function deviceName(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  return browser && os ? `${browser} on ${os}` : ua.slice(0, 60);
}

function Sessions() {
  const { logout } = useAuth();
  const sessions = useAsync(() => fetchMySessions().then((list) => list.filter((s) => s.status === "ACTIVE")), []);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (sessions.status === "loading") return <Skeleton className="h-32 w-full" />;
  if (sessions.status === "error") {
    return <ErrorState title="Devices unavailable" message={loadErrorMessage(sessions.error, "your devices")} action={<RetryButton onClick={sessions.reload} />} />;
  }
  return (
    <>
      <ul className="divide-y divide-line border-y border-line">
        {sessions.data.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-3">
              <MonitorSmartphone aria-hidden="true" className="size-5 text-highlight" />
              <div>
                <p className="font-semibold text-fg">
                  {deviceName(s.user_agent)}
                  {s.current ? <span className="ml-2 text-xs font-semibold text-highlight">This device</span> : null}
                </p>
                <p className="text-xs text-fg-muted">
                  Signed in <DateTime value={s.created_at} format="date" />
                  {s.last_used_at ? (
                    <>
                      {" · "}last used <DateTime value={s.last_used_at} format="date" />
                    </>
                  ) : null}
                </p>
              </div>
            </div>
            {s.current ? null : (
              <Button
                variant="ghost"
                size="sm"
                busy={busy === s.id}
                onClick={() => {
                  setBusy(s.id);
                  void revokeSession(s.id).then(sessions.reload).finally(() => setBusy(null));
                }}
              >
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Button variant="secondary" size="sm" className="mt-4" onClick={() => setConfirmAll(true)}>
        <LogOut aria-hidden="true" /> Sign out everywhere
      </Button>
      <Dialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title="Sign out everywhere?"
        description="You will be signed out on every device, including this one."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmAll(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              busy={busy === "all"}
              onClick={() => {
                setBusy("all");
                void revokeAllSessions()
                  .then(() => logout())
                  .finally(() => setBusy(null));
              }}
            >
              Sign out everywhere
            </Button>
          </>
        }
      />
    </>
  );
}

function Profile() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const name = user.display_name || user.email || "Your account";
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <Avatar name={name} size={64} />
          <div className="min-w-0">
            <p className="truncate text-xl font-bold text-fg">{name}</p>
            <p className="truncate text-sm text-fg-muted">{user.email}</p>
          </div>
        </div>
        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
          <dt className="text-fg-muted">Status</dt>
          <dd>
            <StatusChip value={user.status} map={USER_STATUS} />
          </dd>
          <dt className="text-fg-muted">Email</dt>
          <dd className="text-fg">{user.email_verified ? "Verified" : "Not verified yet"}</dd>
        </dl>
        <Button variant="secondary" size="sm" className="mt-6" onClick={() => void logout()}>
          <LogOut aria-hidden="true" /> Sign out
        </Button>
      </Card>
      <section aria-labelledby="devices">
        <h2 id="devices" className="mb-4 text-xl font-bold text-fg">
          Signed-in devices
        </h2>
        <Sessions />
      </section>
    </div>
  );
}

export default function AccountRoute() {
  return (
    <AccountPage eyebrow="Your account" title="Account" what="your account">
      <Profile />
    </AccountPage>
  );
}
