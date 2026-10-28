"use client";

/* Studio gifts (owner, 2026-10-28, D-CAMPAIGN-01, D-CAMPAIGN-02): each profile's gift campaigns and
 * a way to start one. Free extras for buyers; Corner Room checks every campaign before it goes live. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Gift, Plus } from "lucide-react";

import { Button, ButtonLink, Card, EmptyState, ErrorState, Skeleton } from "@/components/ds";
import { CampaignForm } from "@/components/gifts/campaign-form";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { createGiftCampaign, fetchGiftCampaigns } from "@/features/gifts/api";
import { fetchMyProfiles, type CatalogProfile } from "@/features/studio/api";
import { CAMPAIGN_STATUS_LABEL, countsLine, worksLine } from "@/lib/gifts-view";

function ProfileGifts({ profile }: { profile: CatalogProfile }) {
  const router = useRouter();
  const list = useAsync(() => fetchGiftCampaigns(profile.kind as "artist" | "band", profile.id), [profile.kind, profile.id]);
  const [creating, setCreating] = useState(false);
  return (
    <section aria-labelledby={`gifts-${profile.id}`} className="mt-12 first:mt-0">
      <p className="cr-eyebrow text-highlight">{profile.kind === "band" ? "Band" : "Artist"}</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h2 id={`gifts-${profile.id}`} className="text-2xl font-bold text-fg">
          {profile.display_name}
        </h2>
        {!creating ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" /> New gift campaign
          </Button>
        ) : null}
      </div>
      {creating ? (
        <Card className="mt-4 p-5">
          <CampaignForm
            profile={{ kind: profile.kind as "artist" | "band", id: profile.id }}
            submitLabel="Save as draft"
            onSave={async (body) => {
              const created = await createGiftCampaign(profile.kind as "artist" | "band", profile.id, body);
              router.push(`/studio/gifts/${created.id}`);
            }}
          />
        </Card>
      ) : null}
      <div className="mt-4">
        {list.status === "loading" ? (
          <Skeleton className="h-24 w-full" />
        ) : list.status === "error" ? (
          <ErrorState title="Gift campaigns unavailable" message={loadErrorMessage(list.error, "your gift campaigns")} action={<RetryButton onClick={list.reload} />} />
        ) : list.data.length === 0 ? (
          <EmptyState title="No gift campaigns yet" body="Send a gift to the people who buy your music: a poster, a sticker, anything you like." />
        ) : (
          <ul className="grid gap-3">
            {list.data.map((c) => (
              <li key={c.id}>
                <Link href={`/studio/gifts/${c.id}`} className="cr-focus cr-glass-card block p-4 hover:border-highlight">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-lg font-bold text-fg">{c.title}</span>
                    <span className="text-sm font-semibold text-highlight">{CAMPAIGN_STATUS_LABEL[c.status] ?? c.status}</span>
                  </span>
                  <span className="mt-1 block text-sm text-fg-muted">
                    {c.gift_items} · {worksLine(c.works)}
                  </span>
                  <span className="mt-1 block text-sm text-fg">{countsLine(c.counts)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Gifts() {
  const profiles = useAsync(() => fetchMyProfiles(), []);
  if (profiles.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (profiles.status === "error") {
    return <ErrorState title="Gifts unavailable" message={loadErrorMessage(profiles.error, "your profiles")} action={<RetryButton onClick={profiles.reload} />} />;
  }
  if (profiles.data.length === 0) {
    return <EmptyState title="No artist or band profile yet" body="Gift campaigns are for the artist and band profiles you publish for in Studio." />;
  }
  return (
    <div>
      <p className="flex max-w-2xl items-start gap-2 text-sm text-fg">
        <Gift aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
        A free gift for the people who buy your music. Corner Room checks each campaign, and every change to a live one, before fans see it. You can
        pause and restart it any time; purchases made while it is paused don&apos;t count.
      </p>
      <div className="mt-8">
        {profiles.data.map((p) => (
          <ProfileGifts key={`${p.kind}-${p.id}`} profile={p} />
        ))}
      </div>
    </div>
  );
}

export default function StudioGiftsPage() {
  return (
    <AccountPage
      audience="artist"
      eyebrow="Studio"
      title="Gifts"
      what="your gift campaigns"
      actions={
        <ButtonLink href="/studio" variant="secondary">
          <ArrowLeft aria-hidden="true" /> Your music
        </ButtonLink>
      }
    >
      <Gifts />
    </AccountPage>
  );
}
