"use client";

import { FormEvent, useState } from "react";
import { CircleCheck } from "lucide-react";

import { Button, Card, ErrorState, Field, Input, Textarea } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { submitArtistApplication } from "@/lib/api";
import { friendlyError } from "@/lib/error-copy";

function Apply() {
  const [stageName, setStageName] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await submitArtistApplication({ stage_name: stageName, bio: bio || undefined });
      setDone(true);
    } catch (err) {
      setError(friendlyError(err, "Your application could not be sent. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card className="max-w-xl p-6" role="status">
        <p className="flex items-center gap-2 text-lg font-bold text-fg">
          <CircleCheck aria-hidden="true" className="size-6 text-success" /> Application sent
        </p>
        <p className="mt-2 text-sm text-fg">The label team will review it. Your artist profile goes live once it is approved.</p>
      </Card>
    );
  }
  return (
    <Card className="max-w-xl p-6">
      <p className="text-sm text-fg">Tell us your stage name and a little about your music. Applying does not set up royalties or a second sign-in.</p>
      {error ? (
        <div className="mt-4">
          <ErrorState title="Could not send" message={error} />
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <Field label="Stage name">{(c) => <Input {...c} value={stageName} onChange={(e) => setStageName(e.target.value)} maxLength={200} required />}</Field>
        <Field label="About you" hint="Optional">
          {(c) => <Textarea {...c} rows={5} value={bio} onChange={(e) => setBio(e.target.value)} />}
        </Field>
        <Button type="submit" size="lg" busy={busy}>
          Send application
        </Button>
      </form>
    </Card>
  );
}

export default function ApplyPage() {
  return (
    <AccountPage eyebrow="Artist" title="Apply as an artist" what="the artist application">
      <Apply />
    </AccountPage>
  );
}
