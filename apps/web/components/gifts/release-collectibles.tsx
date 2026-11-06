"use client";

/*
 * A release's collectibles on its numbers page (owner, 2026-11-06, D-CAMPAIGN-03): every gift
 * campaign covering the release, with how many of its gifts are not prepared, prepared,
 * dispatched, received, returned and missing, and the way to the campaign's tracking page.
 */

import Link from "next/link";
import { PackageOpen } from "lucide-react";

import { Card, Skeleton } from "@/components/ds";
import { useAsync } from "@/components/use-async";
import { fetchReleaseCollectibles } from "@/features/gifts/api";
import { CAMPAIGN_STATUS_LABEL, RECIPIENT_STATUS_LABEL, RECIPIENT_STATUSES } from "@/lib/gifts-view";

export function ReleaseCollectibles({ releaseId }: { releaseId: string }) {
  const data = useAsync(() => fetchReleaseCollectibles(releaseId), [releaseId]);
  return (
    <section aria-labelledby="collectibles-title" className="mt-10 grid gap-4">
      <div>
        <h2 id="collectibles-title" className="flex items-center gap-2 text-xl font-bold text-fg">
          <PackageOpen aria-hidden="true" className="size-5 text-highlight" /> Collectibles
        </h2>
        <p className="mt-1 text-sm text-fg-muted">Gifts that come with this music, and how far each buyer&apos;s has got.</p>
      </div>
      {data.status === "loading" ? (
        <Skeleton className="h-28 w-full" />
      ) : data.status === "error" ? (
        <p className="text-sm text-fg">Collectibles aren&apos;t available right now.</p>
      ) : data.data.length === 0 ? (
        <p className="text-sm text-fg">No collectible comes with this music.</p>
      ) : (
        data.data.map((c) => (
          <Card key={c.id} className="grid gap-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-highlight">{CAMPAIGN_STATUS_LABEL[c.status] ?? c.status}</p>
                <h3 className="text-lg font-bold text-fg">{c.title}</h3>
                <p className="text-sm text-fg-muted">{c.gift_items}</p>
              </div>
              <Link href={`/studio/gifts/${c.id}`} className="cr-focus text-sm font-semibold text-link underline">
                Open collectible tracking
              </Link>
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <div>
                <dt className="text-xs text-fg-muted">Everyone</dt>
                <dd className="cr-num text-2xl font-bold text-fg">{c.counts.TOTAL}</dd>
              </div>
              {RECIPIENT_STATUSES.map((s) => (
                <div key={s}>
                  <dt className="text-xs text-fg-muted">{RECIPIENT_STATUS_LABEL[s]}</dt>
                  <dd className="cr-num text-2xl font-bold text-fg">{c.counts[s] ?? 0}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))
      )}
    </section>
  );
}
