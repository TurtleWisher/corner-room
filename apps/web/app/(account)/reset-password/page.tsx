"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { CircleCheck } from "lucide-react";

import { AuthCard } from "@/components/account/auth-card";
import { PasswordStrengthMeter } from "@/components/account/password-strength-meter";
import { Button, ButtonLink, ErrorState, Field, Input } from "@/components/ds";
import { ApiError, resetPassword } from "@/lib/api";
import { newPasswordProblem } from "@/lib/auth-view";
import { friendlyError } from "@/lib/error-copy";

type View = { kind: "form" } | { kind: "done" } | { kind: "broken"; message: string };

const EXPIRED = "This link has expired or was already used. Ask for a new one.";

/** Read the token from the `#token=` fragment, then drop it from the address bar and history. */
function takeTokenFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

/** Choose a new password from the emailed link (owner approved the URL, 2026-10-25). */
export default function ResetPasswordPage() {
  const token = useRef<string | null>(null);
  const [view, setView] = useState<View>({ kind: "form" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<ReturnType<typeof newPasswordProblem>>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Strict Mode runs effects twice in development: keep the first token read.
    if (token.current === null) token.current = takeTokenFromHash() ?? "";
    if (!token.current) setView({ kind: "broken", message: "This link is incomplete. Ask for a new one." });
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const found = newPasswordProblem(password, confirm);
    setProblem(found);
    if (found) return;
    setBusy(true);
    try {
      await resetPassword(token.current ?? "", password);
      setView({ kind: "done" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setView({ kind: "broken", message: EXPIRED });
      else setError(friendlyError(err, "Your password could not be changed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  if (view.kind === "done") {
    return (
      <AuthCard title="Password changed">
        <p role="status" className="flex items-start gap-2 text-fg">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          Your new password is saved. For your safety you are signed out on every device.
        </p>
        <ButtonLink href="/login" className="mt-6" block>
          Sign in
        </ButtonLink>
      </AuthCard>
    );
  }

  if (view.kind === "broken") {
    return (
      <AuthCard title="Could not use this link">
        <ErrorState title="Reset link not valid" message={view.message} />
        <ButtonLink href="/forgot-password" className="mt-6" block>
          Get a new link
        </ButtonLink>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      {error ? (
        <div className="mb-5">
          <ErrorState title="Could not change the password" message={error} />
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="New password" error={problem?.field === "password" ? problem.message : undefined}>
          {(c) => (
            <>
              <Input
                {...c}
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <PasswordStrengthMeter id="new-password-strength" password={password} />
            </>
          )}
        </Field>
        <Field label="Type it again" error={problem?.field === "confirm" ? problem.message : undefined}>
          {(c) => (
            <Input {...c} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          )}
        </Field>
        <Button type="submit" size="lg" block busy={busy}>
          Save the new password
        </Button>
      </form>
    </AuthCard>
  );
}
