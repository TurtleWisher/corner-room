"use client";

/* Studio home (URL-05): the artist and band profiles this account publishes for, and their
 * releases with their authoritative state. Artist Studio guide 7.1: one prominent action, and a
 * "pick up where you left off" prompt only when a release really waits on the artist. */

import Link from "next/link";
import { ArrowRight, ChartNoAxesColumn, CircleAlert, Plus } from "lucide-react";

import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { ButtonLink, Card, EmptyState, ErrorState, Skeleton } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMyProfiles, fetchProfileReleases, type CatalogProfile, type ReleaseCard } from "@/features/studio/api";
import { coverUrl } from "@/lib/cover-view";
import { friendlyError } from "@/lib/error-copy";
import { RELEASE_TYPE_LABEL, displayStateLabel, displayStateTone, profileReasonText, releaseToContinue } from "@/lib/studio-view";

const TONE = { neutral: "text-fg-muted", progress: "text-fg", good: "text-success", attention: "text-danger" } as const;

type ProfileWithReleases = { profile: CatalogProfile; releases: ReleaseCard[] | null; error: string | null };

async function loadStudio(): Promise<ProfileWithReleases[]> {
  const profiles = await fetchMyProfiles();
  return Promise.all(
    profiles.map(async (profile) => {
      try {
        return { profile, releases: await fetchProfileReleases(profile.kind, profile.id), error: null };
      } catch (err) {
        return { profile, releases: null, error: friendlyError(err, "Releases couldn't be loaded.") };
      }
    }),
  );
}

function StateLabel({ state }: { state: string }) {
  const tone = displayStateTone(state);
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${TONE[tone]}`}>
      {tone === "attention" ? <CircleAlert aria-hidden="true" className="size-4" /> : null}
      {displayStateLabel(state)}
    </span>
  );
}

function ContinueCard({ release, profileName }: { release: ReleaseCard; profileName: string }) {
  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-4 p-5">
      <CoverArt
        src={coverUrl({ signed: release.cover_url })}
        fallback={<RoomCube front={release.title} side={profileName} size="front" label="" className="size-16" />}
        className="size-16 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg-muted">Pick up where you left off</p>
        <p className="mt-1 truncate text-lg font-bold text-fg">{release.title}</p>
        <StateLabel state={release.display_state} />
      </div>
      <ButtonLink href={`/studio/releases/${release.id}`}>
        Continue <ArrowRight aria-hidden="true" />
      </ButtonLink>
    </Card>
  );
}

function ProfileReleases({ item, primary }: { item: ProfileWithReleases; primary: boolean }) {
  const { profile, releases, error } = item;
  const reason = profileReasonText(profile.reason);
  return (
    <section aria-labelledby={`p-${profile.id}`} className="mt-12 first:mt-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="cr-eyebrow text-highlight">{profile.kind === "band" ? "Band" : "Artist"}</p>
          <h2 id={`p-${profile.id}`} className="mt-1 break-words text-2xl font-bold text-fg">
            {profile.display_name}
          </h2>
        </div>
        {profile.can_publish ? (
          <ButtonLink href={`/studio/releases/new?kind=${profile.kind}&id=${profile.id}`} variant={primary ? "primary" : "secondary"}>
            <Plus aria-hidden="true" /> New release
          </ButtonLink>
        ) : null}
      </div>
      {reason ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {reason}
        </p>
      ) : null}
      <div className="mt-4">
        {error ? (
          <ErrorState title="Couldn't load releases" message={error} />
        ) : releases === null ? (
          <Skeleton className="h-24 w-full" />
        ) : releases.length === 0 ? (
          <EmptyState
            title="No releases yet"
            body={profile.can_publish ? "Start a single, EP or album. Your draft saves as you go." : "Releases appear here once the profile can publish."}
          />
        ) : (
          <ul className="border-t border-line">
            {releases.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/studio/releases/${r.id}`}
                  className="cr-focus cr-row flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-2 py-3"
                >
                  {/* The accepted cover, or the Room Cube from the real title and profile. */}
                  <CoverArt
                    src={coverUrl({ signed: r.cover_url })}
                    fallback={<RoomCube front={r.title} side={profile.display_name} size="front" label="" className="size-12" />}
                    className="size-12 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-fg">{r.title}</span>
                    <span className="text-sm text-fg-muted">
                      {RELEASE_TYPE_LABEL[r.release_type] ?? r.release_type} · {r.track_count} {r.track_count === 1 ? "track" : "tracks"}
                    </span>
                  </span>
                  <StateLabel state={r.display_state} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Studio() {
  const data = useAsync(loadStudio, []);

  if (data.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Studio unavailable" message={loadErrorMessage(data.error, "your Studio")} action={<RetryButton onClick={data.reload} />} />;
  }
  if (data.data.length === 0) {
    return (
      <Card className="max-w-xl p-6">
        <p className="text-lg font-bold text-fg">No artist or band profile yet</p>
        <p className="mt-2 text-sm text-fg">
          Studio is for artists and band admins. Apply as an artist; once Corner Room approves you, your profile appears here.
        </p>
        <ButtonLink href="/artists/apply" variant="secondary" className="mt-4">
          Apply as an artist
        </ButtonLink>
      </Card>
    );
  }

  const owners = new Map(data.data.flatMap((p) => (p.releases ?? []).map((r) => [r.id, p.profile.display_name] as const)));
  const next = releaseToContinue(data.data.flatMap((p) => p.releases ?? []));
  // One loud action per page: continuing a release, or else starting one when there is a single profile.
  const primaryNew = next === null && data.data.length === 1;
  return (
    <div>
      {next ? (
        <div className="mb-12">
          <ContinueCard release={next} profileName={owners.get(next.id) ?? next.title} />
        </div>
      ) : null}
      {data.data.map((item) => (
        <ProfileReleases key={`${item.profile.kind}-${item.profile.id}`} item={item} primary={primaryNew} />
      ))}
    </div>
  );
}

export default function StudioPage() {
  return (
    <AccountPage
      audience="artist"
      eyebrow="Studio"
      title="Your music"
      what="your Studio"
      actions={
        <ButtonLink href="/studio/sales" variant="secondary">
          <ChartNoAxesColumn aria-hidden="true" /> Sales
        </ButtonLink>
      }
    >
      <Studio />
    </AccountPage>
  );
}
