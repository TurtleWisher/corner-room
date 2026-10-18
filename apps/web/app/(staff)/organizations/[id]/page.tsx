"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, Copy } from "lucide-react";

import { useWorkspace } from "@/components/workspace-provider";
import {
  ApiError,
  createInvitation,
  fetchGrantableRoles,
  fetchInvitations,
  fetchMemberships,
  fetchOrganization,
  type GrantableRole,
  type Invitation,
  type Membership,
  type Organization,
} from "@/lib/api";
import { inviteLink, memberLabel } from "@/lib/onboarding-view";
import { invitationsForActiveOrg, membersForActiveOrg } from "@/lib/workspace-view";
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Protected, selectClasses } from "@/components/staff/kit";
import { DateTime, StatusChip } from "@/components/ds";

/** The link the invitee opens. Shown once (the API never shows the token again), with a copy button. */
function IssuedLink({ link, email }: { link: string; email: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 border border-dashed border-line p-3" role="status">
      <p className="text-sm text-fg">
        Send this link to <strong>{email}</strong>. It is shown only now; they open it, sign in or create an account with that email, and accept.
      </p>
      <div className="mt-2 flex gap-2">
        <Input readOnly value={link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          size="sm"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(link)
              .then(() => setCopied(true))
              .catch(() => undefined)
          }
        >
          {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function OrganizationDetailBody() {
  const params = useParams<{ id: string }>();
  const orgId = params.id;
  const { currentOrg, switchTo } = useWorkspace();
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Membership[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [roles, setRoles] = useState<GrantableRole[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [issued, setIssued] = useState<{ link: string; email: string } | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMembers([]);
    setInvitations([]);
    setRoles(null);
    setOrg(null);
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const row = await fetchOrganization(orgId);
        if (cancelled) return;
        setOrg(row);
        const memberPage = await fetchMemberships(orgId);
        if (cancelled) return;
        setMembers(memberPage.items);
        // Invitations and roles are for workspace admins; others simply do not see those cards.
        const [invitePage, grantable] = await Promise.all([
          fetchInvitations(orgId).catch((err) => (err instanceof ApiError && err.status === 403 ? null : Promise.reject(err))),
          fetchGrantableRoles(orgId).catch((err) => (err instanceof ApiError && err.status === 403 ? null : Promise.reject(err))),
        ]);
        if (cancelled) return;
        setInvitations(invitePage?.items ?? []);
        setRoles(grantable);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Unable to load organization");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    setInviteError(null);
    setIssued(null);
    setBusy(true);
    try {
      const sentTo = email.trim();
      const result = await createInvitation(orgId, sentTo, roleId || null);
      setEmail("");
      setIssued({ link: inviteLink(window.location.origin, result.token), email: sentTo });
      setInvitations((await fetchInvitations(orgId)).items);
    } catch (err) {
      setInviteError(
        err instanceof ApiError && err.code === "ROLE_NOT_GRANTABLE"
          ? "You can only give a role whose permissions you have yourself."
          : err instanceof ApiError && err.status === 409
            ? "There is already an open invitation for this email."
            : err instanceof ApiError
              ? err.message
              : "Unable to issue invitation",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading organization" />;
  if (error) return <ErrorState title="Not available" message={error} />;
  if (!org) return <EmptyState message="Organization not found." />;

  const visibleMembers = membersForActiveOrg(org.id, org.id, members);
  const visibleInvites = invitationsForActiveOrg(org.id, invitations);
  const roleName = (id: string | null) => roles?.find((r) => r.id === id)?.name ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{org.name}</h1>
          <p className="text-sm text-fg-muted">
            {org.type} · <StatusChip value={org.status} />
            {org.share_bps != null ? ` · share_bps ${org.share_bps} (config only)` : ""}
          </p>
        </div>
        {currentOrg?.id === org.id ? (
          <p className="text-sm text-fg-muted">Current workspace</p>
        ) : (
          <Button type="button" size="sm" onClick={() => void switchTo(org.id)}>
            Switch here
          </Button>
        )}
      </div>

      {roles !== null ? (
        <Card>
          <h2 className="font-medium">Invite staff</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Choose what they will do. You can only give roles whose permissions you have yourself. No email is sent yet (no email provider is
            set up): you get a link to send them.
          </p>
          <form onSubmit={onInvite} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem_auto]">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their-email@example.com" aria-label="Their email" required />
            <select className={selectClasses} value={roleId} onChange={(e) => setRoleId(e.target.value)} aria-label="Role" required>
              <option value="">Choose a role</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Inviting" : "Invite"}
            </Button>
          </form>
          {inviteError ? (
            <p className="mt-2 text-sm text-danger" role="alert">
              {inviteError}
            </p>
          ) : null}
          {issued ? <IssuedLink link={issued.link} email={issued.email} /> : null}
        </Card>
      ) : null}

      <Card>
        <h2 className="font-medium">Members</h2>
        {visibleMembers.length === 0 ? (
          <div className="mt-2">
            <EmptyState message="No members to show for this organization." />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--cr-line,rgba(127,127,127,0.25))] text-sm">
            {visibleMembers.map((row) => {
              const label = memberLabel(row);
              return (
                <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium text-fg">{label.primary}</span>
                    {label.secondary ? <span className="ml-2 text-fg-muted">{label.secondary}</span> : null}
                  </span>
                  <span className="flex items-center gap-2">
                    {row.role_name ? <span className="text-fg-muted">{row.role_name}</span> : null}
                    <StatusChip value={row.status} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {roles !== null ? (
        <Card>
          <h2 className="font-medium">Invitations</h2>
          {visibleInvites.length === 0 ? (
            <div className="mt-3">
              <EmptyState message="No invitations for this organization." />
            </div>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {visibleInvites.map((row) => (
                <li key={row.id} className="flex flex-wrap items-baseline gap-2">
                  <span className="text-fg">{row.email}</span>
                  {roleName(row.role_id) ? <span className="text-fg-muted">{roleName(row.role_id)}</span> : null}
                  <StatusChip value={row.status} />
                  {row.expires_at ? (
                    <span className="text-fg-muted">
                      until <DateTime value={row.expires_at} />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}

export default function OrganizationDetailPage() {
  return (
    <Protected>
      <OrganizationDetailBody />
    </Protected>
  );
}
