"use client";

/*
 * Join as an artist through a label's shared link (owner, 2026-10-17: "one shared link + review").
 * The link names the label. Signed out: create an account (or sign in on the artist page) and come
 * back here. Signed in: apply; the application goes to that label and its team reviews it before
 * Studio opens.
 */

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Music } from "lucide-react";

import { AuthCard } from "@/components/account/auth-card";
import { SignUpForm } from "@/components/account/sign-up-form";
import { ApplicationStatus } from "@/components/artists/application-status";
import { useAuth } from "@/components/auth-provider";
import { Button, ButtonLink, ErrorState, Field, Input, Skeleton, Textarea } from "@/components/ds";
import { useAsync } from "@/components/use-async";
import { checkJoinCode, fetchMyArtistApplications, submitArtistApplication, type ApplicationRecord } from "@/features/artists/api";
import { ApiError } from "@/lib/api/client";
import { withNext } from "@/lib/auth-view";
import { friendlyError } from "@/lib/error-copy";
import { canApplyAgain } from "@/lib/onboarding-view";

function Apply({ code, labelName, onSent }: { code: string; labelName: string; onSent: () => void }) {
  const [stageName, setStageName] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await submitArtistApplication({ stage_name: stageName, bio: bio || undefined, join_code: code });
      onSent();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "JOIN_LINK_INVALID"
          ? "This join link stopped working just now. Ask the label for a new one."
          : friendlyError(err, "Your application could not be sent. Please try again."),
      );
      setBusy(false);
    }
  }

  return (
    <AuthCard theme="artist-studio" title={`Join ${labelName} as an artist`}>
      <p className="mb-5 text-sm text-fg">
        Tell {labelName} your stage name and a little about your music. Their team reviews it; once you are approved you publish from Studio.
      </p>
      {error ? (
        <div className="mb-4">
          <ErrorState title="Could not send" message={error} />
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Stage name">{(c) => <Input {...c} value={stageName} onChange={(e) => setStageName(e.target.value)} maxLength={200} required />}</Field>
        <Field label="About you" hint="Optional">
          {(c) => <Textarea {...c} rows={4} value={bio} onChange={(e) => setBio(e.target.value)} />}
        </Field>
        <Button type="submit" size="lg" block busy={busy}>
          Send application
        </Button>
      </form>
    </AuthCard>
  );
}

function SignedIn({ code, labelName }: { code: string; labelName: string }) {
  const { user } = useAuth();
  const mine = useAsync(() => fetchMyArtistApplications().then((p) => p.items), [user?.id]);
  if (user?.is_artist) {
    return (
      <AuthCard theme="artist-studio" title="You are already an artist here">
        <p className="text-fg">Your artist profile is set up. Publish from Studio.</p>
        <ButtonLink href="/studio" className="mt-6" block>
          <Music aria-hidden="true" /> Open Studio
        </ButtonLink>
      </AuthCard>
    );
  }
  if (mine.status === "loading") {
    return (
      <AuthCard theme="artist-studio" title={`Join ${labelName} as an artist`}>
        <Skeleton className="h-40 w-full" />
      </AuthCard>
    );
  }
  if (mine.status === "error") {
    return (
      <AuthCard theme="artist-studio" title={`Join ${labelName} as an artist`}>
        <ErrorState title="Could not load your application" message={friendlyError(mine.error, "Please try again.")} />
      </AuthCard>
    );
  }
  const apps: ApplicationRecord[] = mine.data;
  if (!canApplyAgain(apps)) {
    return (
      <AuthCard theme="artist-studio" title="Your artist application">
        <ApplicationStatus app={apps[0]} labelName={labelName} bare />
      </AuthCard>
    );
  }
  return <Apply code={code} labelName={labelName} onSent={mine.reload} />;
}

function Join() {
  const code = useSearchParams().get("code") ?? "";
  const { status } = useAuth();
  const link = useAsync(() => (code ? checkJoinCode(code) : Promise.reject(new ApiError({ status: 404, code: "JOIN_LINK_INVALID" }))), [code]);
  const here = `/studio/join?code=${encodeURIComponent(code)}`;

  if (link.status === "loading" || status === "loading") {
    return (
      <AuthCard theme="artist-studio" title="Join as an artist">
        <Skeleton className="h-40 w-full" />
      </AuthCard>
    );
  }
  if (link.status === "error") {
    return (
      <AuthCard theme="artist-studio" title="This join link isn't active">
        <p className="text-fg">It may have been switched off, reached its limit or ended. Ask the label for a new link.</p>
        <p className="mt-4 text-sm text-fg-muted">
          Already an artist here?{" "}
          <Link href="/studio/sign-in" className="cr-focus font-semibold text-highlight underline">
            Artist sign-in
          </Link>
        </p>
      </AuthCard>
    );
  }
  const labelName = link.data.organization_name;
  if (status === "authenticated") return <SignedIn code={code} labelName={labelName} />;
  return (
    <SignUpForm
      theme="artist-studio"
      title={`Join ${labelName} as an artist`}
      intro={<>Create your Corner Room account first. After you verify it and sign in, you come back here to apply.</>}
      next={here}
      signInPath="/studio/sign-in"
      footer={
        <>
          Already have a Corner Room account?{" "}
          <Link href={withNext("/studio/sign-in", here)} className="cr-focus font-semibold text-highlight underline">
            Sign in
          </Link>
        </>
      }
    />
  );
}

export default function ArtistJoinPage() {
  return (
    <Suspense fallback={null}>
      <Join />
    </Suspense>
  );
}
