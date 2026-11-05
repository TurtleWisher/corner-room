"use client";

/* A profile's releases in Studio, with their authoritative state (URL-05). Shared by Studio home and
 * the Releases area (owner, 2026-11-06, D-PRESALE-04), where released music also links to its
 * numbers. */

import Link from "next/link";
import { ChartLine, CircleAlert, Plus } from "lucide-react";

import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { ButtonLink, EmptyState, ErrorState, Skeleton } from "@/components/ds";
import { fetchMyProfiles, fetchProfileReleases, type CatalogProfile, type ReleaseCard } from "@/features/studio/api";
import { coverUrl } from "@/lib/cover-view";
import { friendlyError } from "@/lib/error-copy";
import { releaseNumbersHref } from "@/lib/presale-campaign-view";
import { RELEASE_TYPE_LABEL, displayStateLabel, displayStateTone, profileReasonText } from "@/lib/studio-view";

const TONE = { neutral: "text-fg-muted", progress: "text-fg", good: "text-success", attention: "text-danger" } as const;

export type ProfileWithReleases = { profile: CatalogProfile; releases: ReleaseCard[] | null; error: string | null };

export async function loadStudio(): Promise<ProfileWithReleases[]> {
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

export function StateLabel({ state }: { state: string }) {
  const tone = displayStateTone(state);
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${TONE[tone]}`}>
      {tone === "attention" ? <CircleAlert aria-hidden="true" className="size-4" /> : null}
      {displayStateLabel(state)}
    </span>
  );
}

export function ProfileReleases({ item, primary, numbers = false }: { item: ProfileWithReleases; primary: boolean; numbers?: boolean }) {
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
              <li key={r.id} className="flex items-center gap-2 border-b border-line">
                <Link
                  href={`/studio/releases/${r.id}`}
                  className="cr-focus cr-row flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2 px-2 py-3"
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
                {numbers && r.status === "RELEASED" ? (
                  <ButtonLink href={releaseNumbersHref(r.id)} variant="ghost" size="sm" aria-label={`Numbers for ${r.title}`}>
                    <ChartLine aria-hidden="true" /> Numbers
                  </ButtonLink>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

