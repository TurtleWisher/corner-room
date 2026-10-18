"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { useWorkspace } from "@/components/workspace-provider";
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Protected } from "@/components/staff/kit";
import { StatusChip } from "@/components/ds";

/** An invitation link (or just its token) pasted by the invitee: the token either way. */
function tokenFrom(text: string): string {
  const trimmed = text.trim();
  try {
    return new URL(trimmed).searchParams.get("invite") ?? trimmed;
  } catch {
    return trimmed;
  }
}

function OrganizationsBody() {
  const { organizations, currentOrg, loading, error, switchTo } = useWorkspace();
  const router = useRouter();
  const [pasted, setPasted] = useState("");

  function onPaste(event: FormEvent) {
    event.preventDefault();
    router.push(`/staff/join?invite=${encodeURIComponent(tokenFrom(pasted))}`);
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
        <h1 className="text-xl font-semibold">Workspaces</h1>
        <p className="mt-1 text-sm text-fg-muted">
          A workspace is an organization you work in. Staff pages show and change data for the workspace you are in.
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
                  <p className="text-sm text-fg-muted">
                    {org.type} · <StatusChip value={org.status} />
                    {currentOrg?.id === org.id ? " · current workspace" : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={currentOrg?.id === org.id} onClick={() => void switchTo(org.id)}>
                    Switch
                  </Button>
                  <Link href={`/organizations/${org.id}`} className="self-center text-sm underline">
                    Open
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Card>
        <h2 className="text-sm font-medium">Have an invitation link?</h2>
        <p className="mt-1 text-sm text-fg-muted">Open it, or paste it here.</p>
        <form onSubmit={onPaste} className="mt-3 flex gap-2">
          <Input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Invitation link" aria-label="Invitation link" required />
          <Button type="submit" size="sm">
            Open
          </Button>
        </form>
      </Card>
    </div>
  );
}

function OrganizationsPageInner() {
  const invite = useSearchParams().get("invite");
  const router = useRouter();
  // Invitations have their own page now (/staff/join); older links still land there.
  useEffect(() => {
    if (invite) router.replace(`/staff/join?invite=${encodeURIComponent(invite)}`);
  }, [invite, router]);
  if (invite) return <LoadingState label="Opening your invitation" />;
  return (
    <Protected>
      <OrganizationsBody />
    </Protected>
  );
}

export default function OrganizationsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading" />}>
      <OrganizationsPageInner />
    </Suspense>
  );
}
