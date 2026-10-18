"use client";

/* Studio home (URL-05): the artist and band profiles this account publishes for, and their
 * releases with their authoritative state. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleAlert, Disc3, Plus } from "lucide-react";

import { ButtonLink, Card, EmptyState, ErrorState, Skeleton } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { fetchMyProfiles, fetchProfileReleases, type CatalogProfile, type ReleaseCard } from "@/features/studio/api";
import { friendlyError } from "@/lib/error-copy";
import { RELEASE_TYPE_LABEL, displayStateLabel, displayStateTone, profileReasonText } from "@/lib/studio-view";

const TONE = { neutral: "text-fg-muted", progress: "text-fg", good: "text-success", attention: "text-danger" } as const;

function ProfileReleases({ profile }: { profile: CatalogProfile }) {
  const [releases, setReleases] = useState<ReleaseCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProfileReleases(profile.kind, profile.id)
      .then(setReleases)
      .catch((err) => setError(friendlyError(err, "Releases couldn't be loaded.")));
  }, [profile.kind, profile.id]);

  const reason = profileReasonText(profile.reason);
  return (
    <section aria-labelledby={`p-${profile.id}`} className="mt-10 first:mt-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cr-eyebrow text-highlight">{profile.kind === "band" ? "Band" : "Artist"}</p>
          <h2 id={`p-${profile.id}`} className="mt-1 text-2xl font-bold text-fg">
            {profile.display_name}
          </h2>
        </div>
        {profile.can_publish ? (
          <ButtonLink href={`/studio/releases/new?kind=${profile.kind}&id=${profile.id}`}>
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
          <EmptyState title="No releases yet" body={profile.can_publish ? "Start a single, EP or album. Your draft saves as you go." : "Releases appear here once the profile can publish."} />
        ) : (
          <ul className="border-t border-line">
            {releases.map((r) => {
              const tone = displayStateTone(r.display_state);
              return (
                <li key={r.id}>
                  <Link href={`/studio/releases/${r.id}`} className="cr-focus cr-row flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line px-2 py-4">
                    <Disc3 aria-hidden="true" className="size-5 text-highlight" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-fg">{r.title}</span>
                      <span className="text-sm text-fg-muted">
                        {RELEASE_TYPE_LABEL[r.release_type] ?? r.release_type} · {r.track_count} {r.track_count === 1 ? "track" : "tracks"}
                      </span>
                    </span>
                    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${TONE[tone]}`}>
                      {tone === "attention" ? <CircleAlert aria-hidden="true" className="size-4" /> : null}
                      {displayStateLabel(r.display_state)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function Studio() {
  const [profiles, setProfiles] = useState<CatalogProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchMyProfiles()
      .then(setProfiles)
      .catch((err) => setError(friendlyError(err, "Your profiles couldn't be loaded.")));
  }, []);

  if (error) return <ErrorState title="Studio unavailable" message={error} />;
  if (profiles === null) return <Skeleton className="h-48 w-full" />;
  if (profiles.length === 0) {
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
  return (
    <div>
      {profiles.map((p) => (
        <ProfileReleases key={`${p.kind}-${p.id}`} profile={p} />
      ))}
    </div>
  );
}

export default function StudioPage() {
  return (
    <AccountPage audience="artist" eyebrow="Studio" title="Your music" what="your Studio">
      <Studio />
    </AccountPage>
  );
}
