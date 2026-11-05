"use client";

/* Studio home (URL-05): the artist and band profiles this account publishes for, and their
 * releases with their authoritative state. Artist Studio guide 7.1: one prominent action, and a
 * "pick up where you left off" prompt only when a release really waits on the artist.
 * Owner, 2026-10-30: a friendlier home. A welcome with the profile names, quiet shortcuts to every
 * Studio place, and an honest count of releases; nothing that was here is removed. */

import Link from "next/link";
import { ArrowRight, ChartLine, ChartNoAxesColumn, Coins, Gift, Megaphone, UserRoundPen, type LucideIcon } from "lucide-react";

import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { ButtonLink, Card, ErrorState, Skeleton } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { ProfileReleases, StateLabel, loadStudio, type ProfileWithReleases } from "@/components/studio/profile-releases";
import type { CatalogProfile, ReleaseCard } from "@/features/studio/api";
import { coverUrl } from "@/lib/cover-view";
import { releaseToContinue, releasesGlance } from "@/lib/studio-view";

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

type Shortcut = { href: string; label: string; body: string; icon: LucideIcon };

/** Quiet tiles to every Studio place (only real routes; plays only for artist profiles). */
function shortcutsFor(profiles: CatalogProfile[]): Shortcut[] {
  const tiles: Shortcut[] = [
    { href: "/studio/sales", label: "Sales and buyers", body: "What sold, and the names of who bought it.", icon: ChartNoAxesColumn },
    { href: "/studio/releases/presales", label: "Pre-sales", body: "Sell before release day, with live numbers.", icon: Megaphone },
    { href: "/studio/gifts", label: "Gifts", body: "Thank your buyers with a gift.", icon: Gift },
    { href: "/studio/profile", label: "Profile", body: "Your picture, bio and what fans see.", icon: UserRoundPen },
    { href: "/royalties", label: "Royalties", body: "Your earnings statements.", icon: Coins },
  ];
  const artist = profiles.find((p) => p.kind === "artist");
  if (artist) tiles.push({ href: `/artists/${artist.id}/analytics`, label: "Plays", body: `How often fans play ${artist.display_name}.`, icon: ChartLine });
  return tiles;
}

function Welcome({ items }: { items: ProfileWithReleases[] }) {
  const names = items.map((i) => i.profile.display_name).join(" · ");
  const releases = items.flatMap((i) => i.releases ?? []);
  const loaded = items.every((i) => i.releases !== null);
  return (
    <section aria-labelledby="studio-welcome" className="mb-12">
      <p className="cr-eyebrow text-highlight">Welcome back</p>
      <h2 id="studio-welcome" className="mt-1 break-words text-3xl font-bold text-fg">
        {names}
      </h2>
      {loaded ? <p className="mt-1 text-fg-muted">{releasesGlance(releases)}</p> : null}
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shortcutsFor(items.map((i) => i.profile)).map((t) => (
          <li key={t.href}>
            <Link href={t.href} className="cr-focus group block h-full">
              <Card className="flex h-full items-start gap-3 p-4 transition-colors group-hover:border-line-strong">
                <t.icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-highlight" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1 font-semibold text-fg">
                    {t.label} <ArrowRight aria-hidden="true" className="size-4 opacity-60 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                  </span>
                  <span className="mt-0.5 block text-sm text-fg-muted">{t.body}</span>
                </span>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
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
      <Welcome items={data.data} />
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
