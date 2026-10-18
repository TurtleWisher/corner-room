"use client";

import { useState } from "react";
import { LogOut, MonitorSmartphone, Pencil } from "lucide-react";

import { DeliveryAddressForm } from "@/components/account/delivery-address-form";
import { useAuth } from "@/components/auth-provider";
import { Avatar, Button, Card, DateTime, ErrorState, Skeleton, StatusChip } from "@/components/ds";
import { Dialog } from "@/components/ds/dialog";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMyDeliveryAddress, type DeliveryAddress } from "@/features/identity/api";
import { addressLines } from "@/lib/address-view";
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

const SESSIONS_FOLDED = 5;

function Sessions() {
  const { logout } = useAuth();
  const sessions = useAsync(() => fetchMySessions().then((list) => list.filter((s) => s.status === "ACTIVE")), []);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  if (sessions.status === "loading") return <Skeleton className="h-32 w-full" />;
  if (sessions.status === "error") {
    return <ErrorState title="Devices unavailable" message={loadErrorMessage(sessions.error, "your devices")} action={<RetryButton onClick={sessions.reload} />} />;
  }
  // This device first, then the most recent; long lists fold so the page stays calm.
  const ordered = [...sessions.data].sort(
    (a, b) => Number(b.current) - Number(a.current) || String(b.last_used_at ?? b.created_at).localeCompare(String(a.last_used_at ?? a.created_at)),
  );
  const shown = showAll ? ordered : ordered.slice(0, SESSIONS_FOLDED);
  const hidden = ordered.length - shown.length;
  return (
    <>
      <ul className="divide-y divide-line">
        {shown.map((s) => (
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
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {hidden > 0 || showAll ? (
          <Button variant="ghost" size="sm" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${ordered.length} devices`}
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setConfirmAll(true)}>
          <LogOut aria-hidden="true" /> Sign out everywhere
        </Button>
      </div>
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

/** D-ADDR-01: the Bangladesh address for gifts, editable any time. */
function DeliveryAddressPanel() {
  const loaded = useAsync(fetchMyDeliveryAddress, []);
  const [address, setAddress] = useState<DeliveryAddress | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const current = address !== undefined ? address : loaded.status === "ok" ? loaded.data : undefined;

  if (loaded.status === "loading" && current === undefined) return <Skeleton className="h-24 w-full" />;
  if (loaded.status === "error" && current === undefined) {
    return <ErrorState message={loadErrorMessage(loaded.error, "your delivery address")} action={<RetryButton onClick={loaded.reload} />} />;
  }
  if (current === null || editing) {
    return (
      <DeliveryAddressForm
        initial={current ?? null}
        onSaved={(next) => {
          setAddress(next);
          setEditing(false);
          setSaved(true);
        }}
        onCancel={current ? () => setEditing(false) : undefined}
      />
    );
  }
  if (!current) return null;
  return (
    <div>
      <address className="not-italic text-sm text-fg">
        {addressLines(current).map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </address>
      {saved ? (
        <p role="status" className="mt-3 text-sm text-success">
          Address saved.
        </p>
      ) : null}
      <p className="mt-3 text-xs text-fg-muted">Used for gifts. You confirm it again before every payment.</p>
      <Button
        variant="secondary"
        size="sm"
        className="mt-4"
        onClick={() => {
          setSaved(false);
          setEditing(true);
        }}
      >
        <Pencil aria-hidden="true" /> Change address
      </Button>
    </div>
  );
}

function Profile() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const name = user.display_name || user.email || "Your account";
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-8">
      <Card className="p-6 lg:sticky lg:top-28">
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
      <div className="space-y-6">
        <Card as="section" aria-labelledby="delivery" className="p-6">
          <h2 id="delivery" className="mb-2 text-xl font-bold text-fg">
            Delivery address
          </h2>
          <DeliveryAddressPanel />
        </Card>
        <Card as="section" aria-labelledby="devices" className="p-6">
          <h2 id="devices" className="mb-2 text-xl font-bold text-fg">
            Signed-in devices
          </h2>
          <Sessions />
        </Card>
      </div>
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
