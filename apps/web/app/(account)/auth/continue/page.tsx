"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthCard } from "@/components/account/auth-card";
import { useAuth } from "@/components/auth-provider";
import { ButtonLink, ErrorState, Skeleton } from "@/components/ds";
import { safeNextPath } from "@/lib/auth-view";

/*
 * Landing spot after "Continue with Google". The API has already set the usual refresh cookie;
 * AuthProvider restores the session from it on load (POST /auth/refresh), exactly as after a
 * page reload. Nothing about Google is handled here and no token is in the URL.
 */
export default function ContinuePage() {
  const router = useRouter();
  const { status } = useAuth();
  const [next, setNext] = useState("/account");

  useEffect(() => {
    setNext(safeNextPath(new URLSearchParams(window.location.search).get("next")));
  }, []);

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  if (status === "anonymous" || status === "expired") {
    return (
      <AuthCard title="Sign-in did not finish">
        <ErrorState title="You are not signed in" message="Your Google sign-in could not be completed. Please try again." />
        <ButtonLink href={`/login?next=${encodeURIComponent(next)}`} className="mt-6" block>
          Back to sign in
        </ButtonLink>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Signing you in">
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">Signing you in</span>
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-11 w-full" />
      </div>
    </AuthCard>
  );
}
