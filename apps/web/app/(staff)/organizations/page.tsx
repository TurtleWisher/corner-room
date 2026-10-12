"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

import { Protected } from "@/components/protected";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, acceptInvitation } from "@/lib/api";

function OrganizationsBody() {
  const { organizations, currentOrg, loading, error, switchTo, reload } = useWorkspace();
  const [inviteToken, setInviteToken] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  async function onSwitch(orgId: string) {
    try {
      await switchTo(orgId);
    } catch (err) {
      // surfaced via workspace error on reload; keep local message
      throw err;
    }
  }

  async function onAccept(event: FormEvent) {
    event.preventDefault();
    setInviteError(null);
    setInviteMessage(null);
    try {
      await acceptInvitation(inviteToken.trim());
      setInviteToken("");
      setInviteMessage("Invitation accepted.");
      await reload();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : "Unable to accept invitation");
    }
  }

  if (loading) {
    return <LoadingState label="Loading organizations" />;
  }
  if (error) {
    return <ErrorState title="Organizations unavailable" message={error} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Organizations</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Organization is the workspace. Switching reloads members and invitations so prior org data
          cannot linger on this page.
        </p>
      </div>
      {organizations.length === 0 ? (
        <EmptyState message="You do not belong to an organization yet." />
      ) : (
        <ul className="space-y-3">
          {organizations.map((org) => (
            <li key={org.id}>
              <Card className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{org.name}</p>
                  <p className="text-sm text-neutral-600">
                    {org.type} · {org.status}
                    {currentOrg?.id === org.id ? " · current workspace" : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={currentOrg?.id === org.id}
                    onClick={() => void onSwitch(org.id)}
                  >
                    Switch
                  </Button>
                  <Link href={`/organizations/${org.id}`} className="text-sm underline self-center">
                    Open
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Card>
        <h2 className="text-sm font-medium">Accept invitation</h2>
        <form onSubmit={onAccept} className="mt-3 flex gap-2">
          <Input
            value={inviteToken}
            onChange={(e) => setInviteToken(e.target.value)}
            placeholder="Invitation token"
            required
          />
          <Button type="submit" size="sm">
            Accept
          </Button>
        </form>
        {inviteError ? (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {inviteError}
          </p>
        ) : null}
        {inviteMessage ? <p className="mt-2 text-sm text-neutral-600">{inviteMessage}</p> : null}
      </Card>
    </div>
  );
}

export default function OrganizationsPage() {
  return (
    <Protected>
      <OrganizationsBody />
    </Protected>
  );
}
