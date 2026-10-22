"use client";

/*
 * The one sign-up form, shared by fan registration (/register) and the artist and staff join pages
 * (/studio/join, /staff/join). After the account is made and verified, the person signs in on the
 * page that suits them and comes back to `next`.
 */

import { FormEvent, useRef, useState } from "react";
import { CircleCheck } from "lucide-react";

import { AuthCard, type AuthWorld } from "@/components/account/auth-card";
import { GoogleSignInOption } from "@/components/account/google-button";
import { PasswordStrengthMeter } from "@/components/account/password-strength-meter";
import { Button, ButtonLink, ErrorState, Field, Input } from "@/components/ds";
import { ApiError, register, verifyPathFromLink, type VerificationDelivery } from "@/lib/api";
import { verifyLinkFor, withNext } from "@/lib/auth-view";
import { friendlyError } from "@/lib/error-copy";

export function SignUpForm({
  title = "Create an account",
  intro,
  next,
  signInPath = "/login",
  footer,
  google = true,
  theme = "ember",
}: {
  title?: string;
  intro?: React.ReactNode;
  /** Where the person returns after verifying and signing in. */
  next: string | null;
  /** The sign-in page that suits them (fan, artist or staff). */
  signInPath?: string;
  footer?: React.ReactNode;
  google?: boolean;
  /** Ember for fans and artists; "staff" (black, D-THEME-01) on the staff pages. */
  theme?: AuthWorld;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { pending: boolean; delivery: VerificationDelivery; verifyPath: string | null }>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const signIn = withNext(signInPath, next);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await register(email, password, name);
      const found = verifyPathFromLink(result.dev_verification_url);
      setDone({
        pending: result.verification_required,
        delivery: result.verification_delivery ?? "not_configured",
        // Verification sends them to the right sign-in page, which then returns to `next`.
        verifyPath: found ? verifyLinkFor(found, next, signInPath) : null,
      });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "An account with this email already exists. Sign in instead."
          : err instanceof ApiError && err.status === 422
            ? "Check your details: a valid email and a password of at least 8 characters."
            : friendlyError(err, "Your account could not be created. Please try again."),
      );
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    if (!done.pending) {
      return (
        <AuthCard theme={theme} title="Your account is ready">
          <p className="flex items-start gap-2 text-fg">
            <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
            Your account is ready.
          </p>
          <ButtonLink href={signIn} className="mt-6" block>
            Go to sign in
          </ButtonLink>
        </AuthCard>
      );
    }
    return (
      <AuthCard theme={theme} title={done.delivery === "not_configured" ? "Account created" : "Check your email"}>
        <p className="flex items-start gap-2 text-fg">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          {done.delivery === "not_configured"
            ? // OD-08: no email provider yet, so no email is promised.
              "Your account is created and waiting for verification. You can sign in once it is active."
            : `Your account is created. Open the link we sent to ${email} to verify it, then sign in.`}
        </p>
        {done.verifyPath ? (
          <div className="mt-6 border border-dashed border-line p-4">
            <p className="text-sm text-fg-muted">Local test server: no real email is sent. Use this link instead.</p>
            <ButtonLink href={done.verifyPath} className="mt-3" block>
              Verify now
            </ButtonLink>
          </div>
        ) : null}
        <ButtonLink href={signIn} variant={done.verifyPath ? "secondary" : "primary"} className="mt-6" block>
          Go to sign in
        </ButtonLink>
      </AuthCard>
    );
  }

  return (
    <AuthCard theme={theme} title={title} footer={footer}>
      {intro ? <div className="mb-5 text-sm text-fg">{intro}</div> : null}
      {error ? (
        <div ref={errorRef} tabIndex={-1} className="mb-5 outline-none">
          <ErrorState title="Could not create the account" message={error} />
        </div>
      ) : null}
      {google ? <GoogleSignInOption next={next} /> : null}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Your name">{(c) => <Input {...c} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
        <Field label="Email">{(c) => <Input {...c} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Password">
          {(c) => (
            <>
              <Input
                {...c}
                aria-describedby="password-strength"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <PasswordStrengthMeter id="password-strength" password={password} email={email} name={name} />
            </>
          )}
        </Field>
        <Button type="submit" size="lg" block busy={busy}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
