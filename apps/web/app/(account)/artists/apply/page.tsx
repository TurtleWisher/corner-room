"use client";

import { FormEvent, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { ApplicationStatus } from "@/components/artists/application-status";
import { Button, ButtonLink, Card, ErrorState, Field, Input, Skeleton, Textarea } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { useAsync } from "@/components/use-async";
import { fetchMyArtistApplications, submitArtistApplication, type ApplicationRecord } from "@/features/artists/api";
import { friendlyError } from "@/lib/error-copy";
import { canApplyAgain } from "@/lib/onboarding-view";

function Apply({ onSent }: { onSent: () => void }) {
  const [stageName, setStageName] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await submitArtistApplication({ stage_name: stageName, bio: bio || undefined });
      onSent();
    } catch (err) {
      setError(friendlyError(err, "Your application could not be sent. Please try again."));
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-xl p-6">
      <p className="text-sm text-fg">
        Tell us your stage name and a little about your music. The label team reviews every application; once you are approved you
        publish your music from Studio. Applying does not set up royalties or a second sign-in.
      </p>
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

function ApplyOrStatus() {
  const { status } = useAuth();
  const mine = useAsync(
    () => (status === "authenticated" ? fetchMyArtistApplications().then((p) => p.items) : Promise.resolve([] as ApplicationRecord[])),
    [status],
  );
  if (status === "loading" || mine.status === "loading") return <Skeleton className="h-48 max-w-xl" />;
  if (status !== "authenticated") {
    return (
      <Card className="max-w-xl p-6">
        <p className="text-fg">Sign in or create an account first. Your artist profile belongs to your Corner Room account.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ButtonLink href={`/login?next=${encodeURIComponent("/artists/apply")}`}>Sign in</ButtonLink>
          <ButtonLink href={`/register?next=${encodeURIComponent("/artists/apply")}`} variant="secondary">
            Create an account
          </ButtonLink>
        </div>
      </Card>
    );
  }
  if (mine.status === "error") return <ErrorState title="Could not load your application" message={friendlyError(mine.error, "Please try again.")} />;
  const apps = mine.data;
  return (
    <div className="space-y-6">
      {apps[0] ? <ApplicationStatus app={apps[0]} /> : null}
      {canApplyAgain(apps) ? <Apply onSent={mine.reload} /> : null}
    </div>
  );
}

export default function ApplyPage() {
  return (
    <AccountPage eyebrow="Artist" title="Apply as an artist" what="the artist application">
      <ApplyOrStatus />
    </AccountPage>
  );
}
