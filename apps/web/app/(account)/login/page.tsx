"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";

import { AuthCard } from "@/components/account/auth-card";
import { useAuth } from "@/components/auth-provider";
import { Button, ButtonLink, ErrorState, Field, Input } from "@/components/ds";
import { safeNextPath } from "@/lib/auth-view";
import { signInError } from "@/lib/error-copy";

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
  const errorRef = useRef<HTMLDivElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      router.push(nextPath());
    } catch (err) {
      setError(signInError(err));
      // Move focus to the message so screen-reader users hear why (account.md accessibility).
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
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
        </div>
      ) : null}
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
