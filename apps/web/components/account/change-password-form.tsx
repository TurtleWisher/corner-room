"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { CircleCheck } from "lucide-react";

import { PasswordStrengthMeter } from "@/components/account/password-strength-meter";
import { Button, ErrorState, Field, Input } from "@/components/ds";
import { ApiError } from "@/lib/api";
import { changePassword } from "@/features/identity/api";
import { newPasswordProblem } from "@/lib/auth-view";
import { friendlyError } from "@/lib/error-copy";

/**
 * Change the password on the Account page (the API existed with no screen; found 2026-10-25).
 * Every other device is signed out; this one stays signed in with a fresh session.
 */
export function ChangePasswordForm({ email, name }: { email?: string | null; name?: string | null }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<ReturnType<typeof newPasswordProblem>>(null);
  const [wrongCurrent, setWrongCurrent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setWrongCurrent(false);
    const found = newPasswordProblem(next, confirm);
    setProblem(found);
    if (found) return;
    setBusy(true);
    try {
      await changePassword(current, next);
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setWrongCurrent(true);
      else setError(friendlyError(err, "Your password could not be changed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p role="status" className="flex items-start gap-2 text-fg">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          Password changed. Your other devices were signed out; this one stays signed in.
        </p>
        <Button variant="secondary" size="sm" onClick={() => setDone(false)}>
          Change it again
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? <ErrorState title="Could not change the password" message={error} /> : null}
      <Field label="Current password" error={wrongCurrent ? "That is not your current password." : undefined}>
        {(c) => (
          <Input {...c} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        )}
      </Field>
      <Field label="New password" error={problem?.field === "password" ? problem.message : undefined}>
        {(c) => (
          <>
            <Input {...c} type="password" autoComplete="new-password" maxLength={128} value={next} onChange={(e) => setNext(e.target.value)} required />
            <PasswordStrengthMeter id="change-password-strength" password={next} email={email ?? undefined} name={name ?? undefined} />
          </>
        )}
      </Field>
      <Field label="Type the new password again" error={problem?.field === "confirm" ? problem.message : undefined}>
        {(c) => (
          <Input {...c} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        )}
      </Field>
      <p className="text-sm text-fg-muted">
        Signed up with Google, or forgotten it?{" "}
        <Link href="/forgot-password" className="cr-focus font-semibold text-highlight underline">
          Get a reset link by email
        </Link>
      </p>
      <Button type="submit" busy={busy}>
        Change password
      </Button>
    </form>
  );
}
