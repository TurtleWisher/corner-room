"use client";

/* Studio > Releases (owner, 2026-11-06, D-PRESALE-04): every release of every profile this account
 * runs, with its state; released music links to its numbers. Pre-sales have their own list. */

import { ButtonLink, Card, ErrorState, Skeleton } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { ProfileReleases, loadStudio } from "@/components/studio/profile-releases";
import { ReleasesTabs } from "@/components/studio/releases-tabs";
import { loadErrorMessage, useAsync } from "@/components/use-async";

function Releases() {
  const data = useAsync(loadStudio, []);
  if (data.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Releases unavailable" message={loadErrorMessage(data.error, "your releases")} action={<RetryButton onClick={data.reload} />} />;
  }
  if (data.data.length === 0) {
    return (
      <Card className="max-w-xl p-6">
        <p className="text-lg font-bold text-fg">No artist or band profile yet</p>
        <p className="mt-2 text-sm text-fg">Releases appear here once Corner Room approves your artist profile.</p>
        <ButtonLink href="/artists/apply" variant="secondary" className="mt-4">
          Apply as an artist
        </ButtonLink>
      </Card>
    );
  }
  return (
    <div>
      {data.data.map((item) => (
        <ProfileReleases key={`${item.profile.kind}-${item.profile.id}`} item={item} primary={data.data.length === 1} numbers />
      ))}
    </div>
  );
}

export default function StudioReleasesPage() {
  return (
    <AccountPage audience="artist" eyebrow="Studio" title="Releases" what="your releases">
      <ReleasesTabs />
      <Releases />
    </AccountPage>
  );
}
