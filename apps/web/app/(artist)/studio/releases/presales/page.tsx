"use client";

/* Studio > Releases > Pre-sales (owner, 2026-11-06, D-PRESALE-04): every pre-sale campaign of the
 * profiles this account runs, live ones first, and the releases that could start one. Every state
 * and number comes from the API. */

import Link from "next/link";
import { ArrowRight, Megaphone } from "lucide-react";

import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { Card, DateTime, EmptyState, ErrorState, Skeleton } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { CampaignStateChip } from "@/components/studio/campaign-shell";
import { ReleasesTabs } from "@/components/studio/releases-tabs";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchCampaigns, type CampaignCard } from "@/features/presales/api";
import { coverUrl } from "@/lib/cover-view";
import { formatCount } from "@/lib/format/count";
import { campaignHref } from "@/lib/presale-campaign-view";
import { RELEASE_TYPE_LABEL } from "@/lib/studio-view";

function CampaignRow({ c }: { c: CampaignCard }) {
  return (
    <li>
      <Link href={campaignHref(c.id)} className="cr-focus group block h-full">
        <Card className="flex h-full items-center gap-4 p-4 transition-colors group-hover:border-line-strong">
          <CoverArt
            src={coverUrl({ signed: c.cover_url }, 160)}
            fallback={<RoomCube front={c.title} side={c.artist} size="front" label="" className="size-16" />}
            className="size-16 shrink-0"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-lg font-bold text-fg">{c.title}</span>
            <span className="block truncate text-sm text-fg-muted">
              {c.artist} · {RELEASE_TYPE_LABEL[c.release_type] ?? c.release_type}
              {c.release_at ? (
                <>
                  {" "}
                  · Out <DateTime value={c.release_at} format="date" />
                </>
              ) : null}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              <CampaignStateChip state={c.state} />
              <span className="text-sm text-fg-muted">
                <span className="cr-num font-semibold text-fg">{formatCount(c.preorders)}</span> {c.preorders === 1 ? "pre-order" : "pre-orders"} ·{" "}
                <span className="cr-num font-semibold text-fg">{formatCount(c.views)}</span> page {c.views === 1 ? "open" : "opens"}
              </span>
            </span>
          </span>
          <ArrowRight aria-hidden="true" className="size-5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </Card>
      </Link>
    </li>
  );
}

function Campaigns() {
  const data = useAsync(fetchCampaigns, []);
  if (data.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Pre-sales unavailable" message={loadErrorMessage(data.error, "your pre-sales")} action={<RetryButton onClick={data.reload} />} />;
  }
  const { items, can_start } = data.data;
  return (
    <div className="grid gap-12">
      <section aria-labelledby="campaigns-title">
        <h2 id="campaigns-title" className="text-xl font-bold text-fg">
          Your pre-sales
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Sell a release before it&apos;s out, with or without its cover and audio. Each pre-sale has its own pages: live numbers, setup,
          the fans&apos; page and sharing. After release its numbers carry on under the release.
        </p>
        <div className="mt-5">
          {items.length === 0 ? (
            <EmptyState title="No pre-sales yet" body="Start one from a release below, or make a new release in Studio first." />
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {items.map((c) => (
                <CampaignRow key={c.id} c={c} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="start-title">
        <h2 id="start-title" className="flex items-center gap-2 text-xl font-bold text-fg">
          <Megaphone aria-hidden="true" className="size-5 text-highlight" /> Start a pre-sale
        </h2>
        <p className="mt-1 text-sm text-fg-muted">Any release that isn&apos;t out yet. A song on its own is pre-sold as a single.</p>
        {can_start.length === 0 ? (
          <p className="mt-4 text-sm text-fg">
            Nothing to start from yet.{" "}
            <Link href="/studio" className="cr-focus font-semibold text-link underline">
              Make a new release in Studio
            </Link>
            , then come back here.
          </p>
        ) : (
          <ul className="mt-4 border-t border-line">
            {can_start.map((r) => (
              <li key={r.id}>
                <Link
                  href={`${campaignHref(r.id)}/setup`}
                  className="cr-focus cr-row flex flex-wrap items-center justify-between gap-3 border-b border-line px-2 py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-fg">{r.title}</span>
                    <span className="text-sm text-fg-muted">
                      {r.artist} · {RELEASE_TYPE_LABEL[r.release_type] ?? r.release_type}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-highlight">
                    Set up a pre-sale <ArrowRight aria-hidden="true" className="size-4" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function StudioPresalesPage() {
  return (
    <AccountPage audience="artist" eyebrow="Studio · Releases" title="Pre-sales" what="your pre-sales">
      <ReleasesTabs />
      <Campaigns />
    </AccountPage>
  );
}
