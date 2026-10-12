"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { CircleCheck } from "lucide-react";

import { AuthCard } from "@/components/account/auth-card";
import { Button, ButtonLink, ErrorState, Field, Input } from "@/components/ds";
import { ApiError, register } from "@/lib/api";
import { friendlyError } from "@/lib/error-copy";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { pending: boolean }>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await register(email, password, name);
      setDone({ pending: result.verification_required });
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
    return (
      <AuthCard title={done.pending ? "Account created" : "Welcome to Corner Room"}>
        <p className="flex items-start gap-2 text-fg">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          {/* OD-08: verification delivery is not configured, so no email is promised. */}
          {done.pending ? "Your account is waiting for verification. You can sign in once it is active." : "Your account is ready."}
        </p>
        <ButtonLink href="/login" className="mt-6" block>
          Go to sign in
        </ButtonLink>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create an account"
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="cr-focus font-semibold text-highlight underline">
            Sign in
          </Link>
        </>
      }
    >
      {error ? (
        <div ref={errorRef} tabIndex={-1} className="mb-5 outline-none">
          <ErrorState title="Could not create the account" message={error} />
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Your name">{(c) => <Input {...c} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
        <Field label="Email">{(c) => <Input {...c} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Password" hint="At least 8 characters">
          {(c) => <Input {...c} type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        <Button type="submit" size="lg" block busy={busy}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
