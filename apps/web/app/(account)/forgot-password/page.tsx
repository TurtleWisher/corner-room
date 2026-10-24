"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { MailCheck } from "lucide-react";

import { AuthCard } from "@/components/account/auth-card";
import { Button, ErrorState, Field, Input } from "@/components/ds";
import { requestPasswordReset } from "@/lib/api";
import { authWorldFor, signInPageFrom } from "@/lib/auth-view";
import { friendlyError } from "@/lib/error-copy";

/**
 * Ask for a password reset link (owner approved the URL, 2026-10-25). The answer never says
 * whether the address has an account. `?signin=` keeps the artist or staff page's world.
 */
export default function ForgotPasswordPage() {
  const [signIn, setSignIn] = useState("/login");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSignIn(signInPageFrom(new URLSearchParams(window.location.search).get("signin"))), []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setSentTo(email);
    } catch (err) {
      setError(friendlyError(err, "The link could not be sent. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  const backToSignIn = (
    <Link href={signIn} className="cr-focus font-semibold text-highlight underline">
      Back to sign in
    </Link>
  );

  if (sentTo) {
    return (
      <AuthCard theme={authWorldFor(signIn)} title="Check your email" footer={backToSignIn}>
        <p role="status" className="flex items-start gap-2 text-fg">
          <MailCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          <span>
            If {sentTo} has a Corner Room account, a link to choose a new password is on its way. It works once and
            only for a short time. Check your spam folder if it doesn&apos;t arrive.
          </span>
        </p>
        <Button variant="secondary" className="mt-6" block onClick={() => setSentTo(null)}>
          Use a different email
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard theme={authWorldFor(signIn)} title="Forgot your password?" footer={backToSignIn}>
      <p className="mb-5 text-sm text-fg">Enter the email you sign in with. We&apos;ll send you a link to choose a new password.</p>
      {error ? (
        <div className="mb-5">
          <ErrorState title="Could not send the link" message={error} />
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email">
          {(c) => <Input {...c} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}
        </Field>
        <Button type="submit" size="lg" block busy={busy}>
          Send the link
        </Button>
      </form>
    </AuthCard>
  );
}
