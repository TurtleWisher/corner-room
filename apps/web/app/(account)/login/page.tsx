"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

import { AuthCard } from "@/components/account/auth-card";
import { GoogleSignInOption } from "@/components/account/google-button";
import { useAuth } from "@/components/auth-provider";
import { Button, ButtonLink, ErrorState, Field, Input } from "@/components/ds";
import { ApiError, requestVerification, verifyPathFromLink } from "@/lib/api";
import { safeNextPath } from "@/lib/auth-view";
import { friendlyError, googleSignInError, signInError } from "@/lib/error-copy";

function nextPath(): string {
  return typeof window === "undefined" ? "/account" : safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

export default function LoginPage() {
  const router = useRouter();
  const { status, user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [resend, setResend] = useState<null | { busy: boolean; message?: string; verifyPath?: string | null }>(null);
  const [next, setNext] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // Back from "Continue with Google" with a refusal: show why, then drop the code from the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(params.get("next"));
    const googleError = googleSignInError(params.get("google_error"));
    if (!googleError) return;
    setError(googleError);
    params.delete("google_error");
    const rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
    requestAnimationFrame(() => errorRef.current?.focus());
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setUnverified(false);
    setResend(null);
    setBusy(true);
    try {
      await login(email, password);
      router.push(nextPath());
    } catch (err) {
      setError(signInError(err));
      setUnverified(err instanceof ApiError && err.code === "ACCOUNT_NOT_ACTIVE");
      // Move focus to the message so screen-reader users hear why (account.md accessibility).
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    setResend({ busy: true });
    try {
      const result = await requestVerification(email);
      const verifyPath = verifyPathFromLink(result.dev_verification_url);
      setResend({
        busy: false,
        verifyPath,
        message:
          result.verification_delivery === "not_configured"
            ? // OD-08: no email provider yet, so nothing can be sent.
              "Verification emails are not available yet. Contact support to activate your account."
            : verifyPath
              ? "Local test server: no real email is sent. Use the link below."
              : `If ${email} is waiting for verification, a new link is on its way.`,
      });
    } catch (err) {
      setResend({ busy: false, message: friendlyError(err, "The link could not be sent. Please try again.") });
    }
  }

  if (status === "authenticated" && user) {
    return (
      <AuthCard title="You are signed in">
        <p className="text-fg">Signed in as {user.display_name || user.email}.</p>
        <ButtonLink href={nextPath()} className="mt-6" block>
          Continue
        </ButtonLink>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Sign in"
      footer={
        <>
          New to Corner Room?{" "}
          <Link href="/register" className="cr-focus font-semibold text-highlight underline">
            Create an account
          </Link>
        </>
      }
    >
      {error ? (
        <div ref={errorRef} tabIndex={-1} className="mb-5 outline-none">
          <ErrorState title="Could not sign in" message={error} />
          {unverified ? (
            <div className="mt-3 space-y-3">
              {resend?.message ? (
                <p role="status" className="text-sm text-fg">
                  {resend.message}
                </p>
              ) : (
                <Button variant="secondary" block busy={resend?.busy} onClick={onResend}>
                  Send the verification link again
                </Button>
              )}
              {resend?.verifyPath ? (
                <ButtonLink href={resend.verifyPath} block>
                  Verify now
                </ButtonLink>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <GoogleSignInOption next={next} />
      <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
        <Field label="Email">
          {(c) => <Input {...c} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}
        </Field>
        <Field label="Password">
          {(c) => <Input {...c} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        <Button type="submit" size="lg" block busy={busy}>
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
