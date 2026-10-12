"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { Protected } from "@/components/protected";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  createInvitation,
  fetchInvitations,
  fetchMemberships,
  fetchOrganization,
  type Invitation,
  type Membership,
  type Organization,
} from "@/lib/api";
import { invitationsForActiveOrg, membersForActiveOrg } from "@/lib/workspace-view";

function OrganizationDetailBody() {
  const params = useParams<{ id: string }>();
  const orgId = params.id;
  const { currentOrg, switchTo } = useWorkspace();
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Membership[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMembers([]);
    setInvitations([]);
    setOrg(null);
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const row = await fetchOrganization(orgId);
        if (cancelled) {
          return;
        }
        setOrg(row);
        const memberPage = await fetchMemberships(orgId);
        if (cancelled) {
          return;
        }
        setMembers(memberPage.items);
        try {
          const invitePage = await fetchInvitations(orgId);
          if (!cancelled) {
            setInvitations(invitePage.items);
          }
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 403) && !cancelled) {
            throw err;
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load organization");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    setInviteError(null);
    setIssuedToken(null);
    try {
      const issued = await createInvitation(orgId, email);
      setEmail("");
      setIssuedToken(issued.token);
      const invitePage = await fetchInvitations(orgId);
      setInvitations(invitePage.items);
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : "Unable to issue invitation");
    }
  }

  if (loading) {
    return <LoadingState label="Loading organization" />;
  }
  if (error) {
    return <ErrorState title="Not available" message={error} />;
  }
  if (!org) {
    return <EmptyState message="Organization not found." />;
  }

  const visibleMembers = membersForActiveOrg(org.id, org.id, members);
  const visibleInvites = invitationsForActiveOrg(org.id, invitations);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{org.name}</h1>
          <p className="text-sm text-neutral-600">
            {org.type} · {org.status}
            {org.share_bps != null ? ` · share_bps ${org.share_bps} (config only)` : ""}
          </p>
        </div>
        {currentOrg?.id === org.id ? (
          <p className="text-sm text-neutral-600">Current workspace</p>
        ) : (
          <Button type="button" size="sm" onClick={() => void switchTo(org.id)}>
            Switch here
          </Button>
        )}
      </div>
      <Card>
        <h2 className="font-medium">Members</h2>
        {visibleMembers.length === 0 ? (
          <div className="mt-2">
            <EmptyState message="No members to show for this organization." />
          </div>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {visibleMembers.map((row) => (
              <li key={row.id}>
                {row.user_id} · {row.status}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2 className="font-medium">Invitations</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Tokens are shown once. Email delivery is not configured.
        </p>
        <form onSubmit={onInvite} className="mt-3 flex gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="invitee@example.com"
            required
          />
          <Button type="submit" size="sm">
            Invite
          </Button>
        </form>
        {inviteError ? (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {inviteError}
          </p>
        ) : null}
        {issuedToken ? (
          <p className="mt-2 break-all text-sm">Token (copy now): {issuedToken}</p>
        ) : null}
        {visibleInvites.length === 0 ? (
          <div className="mt-3">
            <EmptyState message="No invitations for this organization." />
          </div>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {visibleInvites.map((row) => (
              <li key={row.id}>
                {row.email} · {row.status}
              </li>
            ))}
          </ul>
        )}
      </Card>
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
