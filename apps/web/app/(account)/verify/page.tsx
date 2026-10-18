"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck } from "lucide-react";

import { AuthCard } from "@/components/account/auth-card";
import { ButtonLink, ErrorState, Skeleton } from "@/components/ds";
import { ApiError, completeVerification } from "@/lib/api";
import { signInPageFrom, withNext } from "@/lib/auth-view";
import { friendlyError } from "@/lib/error-copy";

type View = { kind: "working" } | { kind: "done" } | { kind: "error"; message: string };

/** Read the token from the `#token=` fragment, then drop it from the address bar and history. */
function takeTokenFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

export default function VerifyPage() {
  const [view, setView] = useState<View>({ kind: "working" });
  const [next, setNext] = useState<string | null>(null);
  const [signIn, setSignIn] = useState("/login");
  const started = useRef(false);

  useEffect(() => {
    // Strict Mode runs effects twice in development; a token can be used only once.
    if (started.current) return;
    started.current = true;
    // Read where to go next before the address is cleaned (the token must not stay in history).
    const query = new URLSearchParams(window.location.search);
    setNext(query.get("next"));
    setSignIn(signInPageFrom(query.get("signin")));
    const token = takeTokenFromHash();
    if (!token) {
      setView({ kind: "error", message: "This verification link is incomplete. Ask for a new one from the sign-in page." });
      return;
    }
    completeVerification(token)
      .then(() => setView({ kind: "done" }))
      .catch((err) =>
        setView({
          kind: "error",
          message:
            err instanceof ApiError && err.status === 401
              ? "This verification link has expired or was already used. Ask for a new one from the sign-in page."
              : friendlyError(err, "Your account could not be verified. Please try again."),
        }),
      );
  }, []);

  if (view.kind === "working") {
    return (
      <AuthCard title="Verifying your account">
        <div role="status" aria-live="polite" className="space-y-3">
          <span className="sr-only">Verifying your account</span>
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-11 w-full" />
        </div>
      </AuthCard>
    );
  }

  if (view.kind === "done") {
    return (
      <AuthCard title="Account verified">
        <p className="flex items-start gap-2 text-fg">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          Your account is active. You can sign in now.
        </p>
        <ButtonLink href={withNext(signIn, next)} className="mt-6" block>
          Sign in
        </ButtonLink>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Could not verify">
      <ErrorState title="Verification failed" message={view.message} />
      <ButtonLink href="/login" variant="secondary" className="mt-6" block>
        Go to sign in
      </ButtonLink>
    </AuthCard>
  );
}
