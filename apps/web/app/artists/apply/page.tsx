"use client";

import { FormEvent, useState } from "react";

import { Protected } from "@/components/protected";
import { ErrorState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, submitArtistApplication } from "@/lib/api";

function ApplyBody() {
  const [stageName, setStageName] = useState("");
  const [bio, setBio] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await submitArtistApplication({ stage_name: stageName, bio: bio || undefined });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to submit application");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Artist application</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Submitting creates a performing identity. It does not create royalty shares or a second login.
        </p>
      </div>
      {error ? <ErrorState title="Application failed" message={error} /> : null}
      {done ? (
        <Card>
          <p className="text-sm">Application submitted. Staff review is a separate lifecycle command.</p>
        </Card>
      ) : (
        <Card>
          <form onSubmit={onSubmit} className="space-y-3">
            <Input
              value={stageName}
              onChange={(e) => setStageName(e.target.value)}
              placeholder="Stage name"
              required
            />
            <Input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Biography" />
            <Button type="submit" size="sm">
              Submit
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

export default function ApplyPage() {
  return (
    <Protected>
      <ApplyBody />
    </Protected>
  );
}
