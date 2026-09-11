"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, register } from "@/lib/api";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const result = await register(email, password, displayName);
      setMessage(
        result.verification_required
          ? "Account created and pending verification. Sign-in is available after activation. Verification delivery is not configured yet."
          : "Account created.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Register failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <h1 className="text-xl font-semibold">Create an account</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <label className="block text-sm">
          Display name
          <Input className="mt-1" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </label>
        <label className="block text-sm">
          Email
          <Input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-sm">
          Password
          <Input
            className="mt-1"
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Creating account…" : "Register"}
        </Button>
      </form>
      {message ? <p className="mt-4 text-sm text-green-700">{message}</p> : null}
      {error ? (
        <p className="mt-4 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
