"use client";

/*
 * Artist applications (needs artist.manage in the active workspace, e.g. Label Manager). A person
 * applies from /artists/apply; staff start the review, approve or reject, then activate the artist,
 * after which the artist publishes from Studio. Approving places the artist in this workspace's
 * label. Only what the applicant chose to share is shown: stage name and bio, never a legal name
 * or account details.
 */

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, Copy } from "lucide-react";

import { DateTime, StatusChip } from "@/components/ds";
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Protected } from "@/components/staff/kit";
import { useWorkspace } from "@/components/workspace-provider";
import {
  createJoinLink,
  disableJoinLink,
  fetchArtistApplications,
  fetchJoinLinks,
  transitionApplication,
  transitionArtist,
  type ApplicationRecord,
  type JoinLinkRecord,
} from "@/features/artists/api";
import { friendlyError } from "@/lib/error-copy";
import { applicationActions, artistJoinLink, joinLinkState } from "@/lib/onboarding-view";

const FILTERS = [
  { key: "open", label: "Waiting for a decision" },
  { key: "approved", label: "Approved" },
  { key: "closed", label: "Rejected or withdrawn" },
  { key: "all", label: "All" },
] as const;

function matches(app: ApplicationRecord, filter: (typeof FILTERS)[number]["key"]): boolean {
  if (filter === "open") return app.status === "SUBMITTED" || app.status === "UNDER_REVIEW" || (app.status === "APPROVED" && app.artist_status !== "ACTIVE");
  if (filter === "approved") return app.status === "APPROVED";
  if (filter === "closed") return app.status === "REJECTED" || app.status === "WITHDRAWN";
  return true;
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex min-w-0 flex-1 gap-2">
      <Input readOnly value={link} aria-label="Join link" onFocus={(e) => e.currentTarget.select()} />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          void navigator.clipboard
            ?.writeText(link)
            .then(() => setCopied(true))
            .catch(() => undefined)
        }
      >
        {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />} {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  );
}

/**
 * The label's artist join links (owner, 2026-10-17: one shared link, staff still review every
 * application). Anyone holding a link can create an account and apply to this label; switch a link
 * off to stop it at once, and make a new one to replace it.
 */
function JoinLinks() {
  const [links, setLinks] = useState<JoinLinkRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchJoinLinks()
      .then(setLinks)
      .catch((err) => setError(friendlyError(err, "Join links couldn't be loaded.")));
  }, []);
  useEffect(() => load(), [load]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    try {
      await createJoinLink({
        label,
        // The chosen day, to its end, in the viewer's own time.
        expires_at: endsOn ? new Date(`${endsOn}T23:59:59`).toISOString() : null,
        max_uses: limit ? Number.parseInt(limit, 10) : null,
      });
      setLabel("");
      setEndsOn("");
      setLimit("");
      load();
    } catch (err) {
      setError(friendlyError(err, "The join link couldn't be made."));
    } finally {
      setBusy(null);
    }
  }

  async function onDisable(link: JoinLinkRecord) {
    setBusy(link.id);
    setError(null);
    try {
      await disableJoinLink(link.id);
      load();
    } catch (err) {
      setError(friendlyError(err, "The link couldn't be switched off."));
    } finally {
      setBusy(null);
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <Card>
      <h2 className="font-semibold">Join links</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Share a link with artists you want to hear from. Anyone holding it can create an account and apply to this label; you still review every
        application here. Switch a link off to stop it at once.
      </p>
      <form onSubmit={onCreate} className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_10rem_8rem_auto] md:items-end">
        <label className="grid gap-1 text-sm text-fg-muted">
          Name (only staff see it)
          <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="e.g. Dhaka indie night" required />
        </label>
        <label className="grid gap-1 text-sm text-fg-muted">
          Ends on (optional)
          <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm text-fg-muted">
          Use limit (optional)
          <Input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} />
        </label>
        <Button type="submit" size="sm" disabled={busy !== null}>
          {busy === "create" ? "Making" : "Make a join link"}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {links === null && !error ? <LoadingState label="Loading join links" /> : null}
      {links !== null && links.length === 0 ? <p className="mt-3 text-sm text-fg-muted">No join links yet.</p> : null}
      <ul className="mt-3 grid gap-3">
        {(links ?? []).map((link) => {
          const state = joinLinkState(link);
          return (
            <li key={link.id} className="border-t border-[var(--cr-line,rgba(127,127,127,0.25))] pt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-fg">{link.label}</p>
                <p className="text-sm text-fg-muted">
                  {state} · used {link.uses}
                  {link.max_uses ? ` of ${link.max_uses}` : ""}
                  {link.expires_at ? (
                    <>
                      {" "}
                      · ends <DateTime value={link.expires_at} format="date" />
                    </>
                  ) : null}
                </p>
              </div>
              {link.usable ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <CopyLink link={artistJoinLink(origin, link.code)} />
                  <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void onDisable(link)}>
                    {busy === link.id ? "Switching off" : "Switch off"}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** No workspace yet (a new sign-in starts without one): choose here, the same way the chip does. */
function ChooseWorkspace() {
  const { organizations, switchTo, loading } = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  if (loading) return <LoadingState label="Loading your workspaces" />;
  if (organizations.length === 0) return <EmptyState message="You are not a member of any organization. Ask an administrator for an invitation." />;
  return (
    <Card>
      <p className="font-semibold text-fg">Choose the workspace you are acting in</p>
      <p className="mt-1 text-sm text-fg-muted">Approving places the artist in this workspace&apos;s label.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {organizations.map((org) => (
          <Button
            key={org.id}
            size="sm"
            onClick={() => void switchTo(org.id).catch((err) => setError(friendlyError(err, "That workspace couldn't be opened.")))}
          >
            {org.name}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

function Applications() {
  const { currentOrg } = useWorkspace();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("open");
  const [apps, setApps] = useState<ApplicationRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetchArtistApplications()
      .then((page) => setApps(page.items))
      .catch((err) => setError(friendlyError(err, "Applications couldn't be loaded.")));
  }, []);

  useEffect(() => {
    if (currentOrg) load();
  }, [currentOrg, load]);

  async function act(app: ApplicationRecord, action: string, target: "application" | "artist") {
    setBusy(app.id + action);
    setError(null);
    setNotice(null);
    try {
      if (target === "artist" && app.artist_id) await transitionArtist(app.artist_id, action);
      else await transitionApplication(app.id, action, app.version);
      setNotice(
        action === "activate"
          ? `${app.stage_name ?? "The artist"} is active and can publish from Studio.`
          : action === "approve"
            ? `${app.stage_name ?? "The applicant"} is approved into ${currentOrg?.name ?? "this workspace"}. Activate them when they are ready to publish.`
            : action === "reject"
              ? "The application was rejected."
              : "Review started.",
      );
      load();
    } catch (err) {
      setError(friendlyError(err, "That didn't go through."));
    } finally {
      setBusy(null);
    }
  }

  if (!currentOrg) return <ChooseWorkspace />;
  const shown = (apps ?? []).filter((a) => matches(a, filter));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Artist applications</h1>
        <p className="mt-1 text-sm text-fg-muted">
          People apply from the Artists page. Start a review, approve or reject, then activate the artist so they can publish from Studio.
        </p>
      </div>
      <JoinLinks />
      <h2 className="pt-2 text-lg font-semibold">Applications</h2>
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </Button>
        ))}
      </div>
      {notice ? (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      ) : null}
      {error ? <ErrorState title="Artist applications" message={error} /> : null}
      {apps === null && !error ? <LoadingState label="Loading applications" /> : null}
      {apps !== null && shown.length === 0 ? <EmptyState message="Nothing here." /> : null}
      <ul className="grid gap-3">
        {shown.map((app) => (
          <li key={app.id}>
            <Card>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="text-lg font-semibold text-fg">{app.stage_name ?? "Untitled application"}</p>
                <span className="flex items-center gap-2 text-sm">
                  <StatusChip value={app.status} />
                  {app.artist_status ? <span className="text-fg-muted">Artist: {app.artist_status.replaceAll("_", " ").toLowerCase()}</span> : null}
                </span>
              </div>
              {app.created_at ? (
                <p className="text-xs text-fg-muted">
                  Applied <DateTime value={app.created_at} />
                </p>
              ) : null}
              {app.bio ? <p className="mt-2 whitespace-pre-line text-sm text-fg">{app.bio}</p> : <p className="mt-2 text-sm text-fg-muted">No bio given.</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {applicationActions(app).map((a) => (
                  <Button
                    key={a.action}
                    size="sm"
                    variant={a.danger ? "outline" : "default"}
                    disabled={busy !== null}
                    onClick={() => void act(app, a.action, a.target)}
                  >
                    {a.danger ? <CircleAlert aria-hidden="true" className="size-4" /> : null}
                    {busy === app.id + a.action ? "Working" : a.label}
                  </Button>
                ))}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ArtistApplicationsPage() {
  return (
    // Access is the API's call (artist.manage in the chosen workspace); a missing workspace is not a missing permission.
    <Protected>
      <Applications />
    </Protected>
  );
}
