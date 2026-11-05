"use client";

/* Studio > Gifts > Music gifts (owner, 2026-11-06, D-GIFT-MUSIC-01): give released music free to
 * chosen people by email, with no payment pages. Corner Room approves each gift; people with an
 * account get the music at once, anyone else when they sign up with that address. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Gift, Plus } from "lucide-react";

import { Button, ButtonLink, Card, EmptyState, ErrorState, Skeleton } from "@/components/ds";
import { GiftTabs } from "@/components/gifts/gift-tabs";
import { GiftComposer } from "@/components/music-gifts/gift-composer";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMailOverview, type MailFile } from "@/features/artist-mail/api";
import { fetchGiftSuggestions, fetchMusicGifts } from "@/features/music-gifts/api";
import { fetchMyProfiles, fetchProfileReleases, type CatalogProfile } from "@/features/studio/api";
import { whenLine } from "@/lib/artist-mail-view";
import { worksLine } from "@/lib/gifts-view";
import { countsLine, GIFT_STATUS_LABEL } from "@/lib/music-gift-view";

function ProfileMusicGifts({ profile }: { profile: CatalogProfile }) {
  const router = useRouter();
  const kind = profile.kind as "artist" | "band";
  const list = useAsync(() => fetchMusicGifts(kind, profile.id), [kind, profile.id]);
  const [creating, setCreating] = useState(false);
  const setup = useAsync(
    async () => {
      if (!creating) return null;
      const [overview, releases, suggestions] = await Promise.all([
        fetchMailOverview({ kind, id: profile.id }),
        fetchProfileReleases(kind, profile.id),
        fetchGiftSuggestions(kind, profile.id).catch(() => []),
      ]);
      return { overview, releases, suggestions };
    },
    [creating, kind, profile.id],
  );
  const [files, setFiles] = useState<MailFile[]>([]);
  useEffect(() => {
    if (setup.status === "ok" && setup.data) setFiles(setup.data.overview.files);
  }, [setup.status, setup.data]);

  return (
    <section aria-labelledby={`music-gifts-${profile.id}`} className="mt-12 first:mt-0">
      <p className="cr-eyebrow text-highlight">{kind === "band" ? "Band" : "Artist"}</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h2 id={`music-gifts-${profile.id}`} className="text-2xl font-bold text-fg">
          {profile.display_name}
        </h2>
        {!creating ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" /> New music gift
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
            Close
          </Button>
        )}
      </div>
      {creating ? (
        <Card className="mt-4 p-5">
          {setup.status === "loading" || (setup.status === "ok" && !setup.data) ? (
            <Skeleton className="h-64 w-full" />
          ) : setup.status === "error" ? (
            <ErrorState title="Couldn't open the gift form" message={loadErrorMessage(setup.error, "your music")} action={<RetryButton onClick={setup.reload} />} />
          ) : setup.data ? (
            <GiftComposer
              profile={{ kind, id: profile.id }}
              artist={profile.display_name}
              voice={kind === "band" ? "we" : "I"}
              releases={setup.data.releases}
              files={files}
              onFiles={setFiles}
              fileMaxBytes={setup.data.overview.file_max_bytes}
              suggestions={setup.data.suggestions}
              start={null}
              onDone={(_note, id) => router.push(`/studio/gifts/music/${id}`)}
            />
          ) : null}
        </Card>
      ) : null}
      <div className="mt-4">
        {list.status === "loading" ? (
          <Skeleton className="h-24 w-full" />
        ) : list.status === "error" ? (
          <ErrorState title="Music gifts unavailable" message={loadErrorMessage(list.error, "your music gifts")} action={<RetryButton onClick={list.reload} />} />
        ) : list.data.length === 0 ? (
          <EmptyState title="No music gifts yet" body="Give a song or a release to the people who helped you: friends, radio hosts, the crew. They get it by email, with no payment." />
        ) : (
          <ul className="grid gap-3">
            {list.data.map((g) => (
              <li key={g.id}>
                <Link href={`/studio/gifts/music/${g.id}`} className="cr-focus cr-glass-card block p-4 hover:border-highlight">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-lg font-bold text-fg">{g.title}</span>
                    <span className="text-sm font-semibold text-highlight">{GIFT_STATUS_LABEL[g.status] ?? g.status}</span>
                  </span>
                  <span className="mt-1 block text-sm text-fg-muted">{g.works.length ? worksLine(g.works) : "No music chosen yet"}</span>
                  <span className="mt-1 block text-sm text-fg">
                    {countsLine(g.counts, g.status)}
                    {g.status === "SCHEDULED" && g.send_at ? ` · given ${whenLine(g.send_at)}` : ""}
                    {g.status === "SENT" && g.sent_at ? ` · given ${whenLine(g.sent_at)}` : ""}
                  </span>
                  {g.review_note ? <span className="mt-1 block text-sm text-fg">Corner Room asked for a change: {g.review_note}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function MusicGifts() {
  const profiles = useAsync(() => fetchMyProfiles(), []);
  if (profiles.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (profiles.status === "error") {
    return <ErrorState title="Music gifts unavailable" message={loadErrorMessage(profiles.error, "your profiles")} action={<RetryButton onClick={profiles.reload} />} />;
  }
  if (profiles.data.length === 0) {
    return <EmptyState title="No artist or band profile yet" body="Music gifts are for the artist and band profiles you publish for in Studio." />;
  }
  return (
    <div>
      <p className="flex max-w-2xl items-start gap-2 text-sm text-fg">
        <Gift aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
        Give your released music free to the people you choose, by email. No payment pages: once Corner Room approves the gift, people with an account own
        it at once, and anyone else gets it as soon as they sign up with that address. It never counts as money.
      </p>
      <div className="mt-8">
        {profiles.data.map((p) => (
          <ProfileMusicGifts key={`${p.kind}-${p.id}`} profile={p} />
        ))}
      </div>
    </div>
  );
}

export default function StudioMusicGiftsPage() {
  return (
    <AccountPage
      audience="artist"
      eyebrow="Studio"
      title="Gifts"
      what="your music gifts"
      actions={
        <ButtonLink href="/studio" variant="secondary">
          <ArrowLeft aria-hidden="true" /> Studio home
        </ButtonLink>
      }
    >
      <GiftTabs current="music" />
      <MusicGifts />
    </AccountPage>
  );
}
