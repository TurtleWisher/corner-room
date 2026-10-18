"use client";

/* Start a release (URL-05): choose the type and title; the draft saves on the server at once. */

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

import { Button, Card, ErrorState, Field, Input } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { createStudioRelease, type ProfileKind } from "@/features/studio/api";
import { friendlyError } from "@/lib/error-copy";
import { RELEASE_TYPE_LABEL } from "@/lib/studio-view";

const TYPES = ["SINGLE", "EP", "ALBUM", "COMPILATION", "LIVE"] as const;
const HINT: Record<string, string> = {
  SINGLE: "One song. Fans can always buy it on its own.",
  EP: "A short collection, usually 3 to 6 songs.",
  ALBUM: "A full collection of songs.",
  COMPILATION: "Songs gathered from other releases.",
  LIVE: "A recording of a live performance.",
};

function NewRelease() {
  const params = useSearchParams();
  const router = useRouter();
  const kind = params.get("kind") as ProfileKind | null;
  const id = params.get("id");
  const [type, setType] = useState<(typeof TYPES)[number]>("SINGLE");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!kind || !id || (kind !== "artist" && kind !== "band")) {
    return <ErrorState title="Choose a profile first" message="Start a release from your Studio page." />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createStudioRelease({ profile: { kind: kind!, id: id! }, release_type: type, title });
      router.push(`/studio/releases/${created.release.id}`);
    } catch (err) {
      setError(friendlyError(err, "The release couldn't be started."));
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-2xl p-6">
      <form onSubmit={onSubmit} className="space-y-6">
        <fieldset>
          <legend className="text-sm font-semibold text-fg">What are you releasing?</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {TYPES.map((t) => (
              <label key={t} className={`cr-focus-within flex cursor-pointer items-start gap-3 border p-3 ${type === t ? "border-highlight" : "border-line"}`}>
                <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} className="mt-1" />
                <span>
                  <span className="block font-semibold text-fg">{RELEASE_TYPE_LABEL[t]}</span>
                  <span className="text-sm text-fg-muted">{HINT[t]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Release title">{(c) => <Input {...c} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required />}</Field>
        {error ? <ErrorState title="Couldn't start the release" message={error} /> : null}
        <Button type="submit" size="lg" busy={busy}>
          Start the draft
        </Button>
      </form>
    </Card>
  );
}

export default function NewReleasePage() {
  return (
    <AccountPage audience="artist" eyebrow="Studio" title="New release" what="your Studio">
      <Suspense fallback={null}>
        <NewRelease />
      </Suspense>
    </AccountPage>
  );
}
