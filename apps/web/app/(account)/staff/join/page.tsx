"use client";

/*
 * Join the staff through an invitation link (owner, 2026-10-17: staff and admins have their own
 * join and sign-in pages; only people with the link can join). The link names the workspace and
 * role. Signed out: create an account with the invited email (or sign in on the staff page) and
 * come back. Signed in: accept, and the staff console opens in that workspace.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { LayoutGrid } from "lucide-react";

import { AuthCard } from "@/components/account/auth-card";
import { SignUpForm } from "@/components/account/sign-up-form";
import { useAuth } from "@/components/auth-provider";
import { Button, ButtonLink, ErrorState, Skeleton } from "@/components/ds";
import { useAsync } from "@/components/use-async";
import { useWorkspace } from "@/components/workspace-provider";
import { acceptInvitation, checkInvitation } from "@/features/identity/api";
import { ApiError } from "@/lib/api/client";
import { withNext } from "@/lib/auth-view";

type Invite = { organization_name: string; role_name: string | null; email_hint: string };

function Welcome({ invite }: { invite: Invite }) {
  return (
    <AuthCard theme="staff" title={`Welcome to ${invite.organization_name}`}>
      <p role="status" className="text-fg">
        You joined{invite.role_name ? ` as ${invite.role_name}` : ""}. Staff pages now open in this workspace.
      </p>
      <ButtonLink href="/staff" className="mt-6" block>
        <LayoutGrid aria-hidden="true" /> Open the staff console
      </ButtonLink>
    </AuthCard>
  );
}

function Accept({ token, invite, onJoined }: { token: string; invite: Invite; onJoined: () => void }) {
  const { user, refreshUser } = useAuth();
  const { switchTo } = useWorkspace();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const membership = await acceptInvitation(token);
      await switchTo(membership.organization_id);
      await refreshUser();
      onJoined();
      // The token has done its job: keep it out of the address bar and history.
      router.replace("/staff/join");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? `This invitation is for ${invite.email_hint}. You are signed in as ${user?.email ?? "someone else"}: sign out and sign in with the invited address.`
          : err instanceof ApiError && err.status === 409
            ? "You already belong to this workspace, or the invitation was already used."
            : err instanceof ApiError
              ? err.message
              : "The invitation couldn't be accepted.",
      );
      setBusy(false);
    }
  }

  return (
    <AuthCard theme="staff" title={`Join ${invite.organization_name}`}>
      <p className="text-fg">
        You have been invited to join the {invite.organization_name} staff{invite.role_name ? ` as ${invite.role_name}` : ""}.
      </p>
      <p className="mt-2 text-sm text-fg-muted">The invitation is for {invite.email_hint}.</p>
      {error ? (
        <div className="mt-4">
          <ErrorState title="Not joined" message={error} />
        </div>
      ) : null}
      <Button size="lg" block className="mt-6" busy={busy} onClick={() => void accept()}>
        Accept and join
      </Button>
    </AuthCard>
  );
}

function Join() {
  const token = useSearchParams().get("invite") ?? "";
  const { status } = useAuth();
  const invite = useAsync(
    () => (token ? checkInvitation(token) : Promise.reject(new ApiError({ status: 404, code: "INVITATION_INVALID" }))),
    [token],
  );
  const here = `/staff/join?invite=${encodeURIComponent(token)}`;
  // Kept here: accepting clears the token from the address, which must not lose the welcome.
  const [joined, setJoined] = useState<Invite | null>(null);
  if (joined) return <Welcome invite={joined} />;

  if (!token && status === "authenticated") {
    // After joining the token is removed from the address; a plain visit goes to the console.
    return (
      <AuthCard theme="staff" title="Staff">
        <ButtonLink href="/staff" block>
          <LayoutGrid aria-hidden="true" /> Open the staff console
        </ButtonLink>
      </AuthCard>
    );
  }
  if (invite.status === "loading" || status === "loading") {
    return (
      <AuthCard theme="staff" title="Join the staff">
        <Skeleton className="h-40 w-full" />
      </AuthCard>
    );
  }
  if (invite.status === "error") {
    return (
      <AuthCard theme="staff" title="This invitation isn't available">
        <p className="text-fg">It may have been used, withdrawn or expired. Ask your administrator for a new invitation link.</p>
        <p className="mt-4 text-sm text-fg-muted">
          Already staff?{" "}
          <Link href="/staff/sign-in" className="cr-focus font-semibold text-highlight underline">
            Staff sign-in
          </Link>
        </p>
      </AuthCard>
    );
  }
  if (status === "authenticated") return <Accept token={token} invite={invite.data} onJoined={() => setJoined(invite.data)} />;
  return (
    <SignUpForm
      title={`Join ${invite.data.organization_name}`}
      intro={
        <>
          You have been invited{invite.data.role_name ? ` as ${invite.data.role_name}` : ""}. Create your account with the invited address (
          {invite.data.email_hint}). After you verify it and sign in, you come back here to accept.
        </>
      }
      next={here}
      signInPath="/staff/sign-in"
      google={false}
      theme="staff"
      footer={
        <>
          Already have a Corner Room account?{" "}
          <Link href={withNext("/staff/sign-in", here)} className="cr-focus font-semibold text-highlight underline">
            Sign in
          </Link>
        </>
      }
    />
  );
}

export default function StaffJoinPage() {
  return (
    <Suspense fallback={null}>
      <Join />
    </Suspense>
  );
}
