"use client";

/* Staff: early pre-sales (owner, 2026-11-03, D-PRESALE-03). An artist opened a pre-sale before the
 * music is finished; staff approve just its title, artist, date and price going public, send it
 * back with a note, or later move its date (buyers are emailed). Deciding happens in the release
 * workspace (components/staff/release-decision.tsx, D-RELEASE-PLAN-01). The API checks who may decide. */

import Link from "next/link";
import { useEffect, useState } from "react";

import { DateTime, Money } from "@/components/ds";
import { Card, ErrorState, LoadingState } from "@/components/staff/kit";
import { useWorkspace } from "@/components/workspace-provider";
import { fetchPresaleQueue, type PresaleQueueItem } from "@/features/studio/api";
import { ApiError } from "@/lib/api/client";
import { friendlyError } from "@/lib/error-copy";
import { RELEASE_TYPE_LABEL } from "@/lib/studio-view";

/** The queue on Catalog releases: early pre-sales waiting for a decision in this workspace. */
export function PresaleQueue() {
  const { currentOrg } = useWorkspace();
  const [items, setItems] = useState<PresaleQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentOrg) return;
    fetchPresaleQueue()
      .then(setItems)
      .catch((err) =>
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? setItems([])
          : setError(friendlyError(err, "Pre-sales waiting for review couldn't be loaded.")),
      );
  }, [currentOrg]);

  if (!currentOrg || (items !== null && items.length === 0 && !error)) return null;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Pre-sales waiting for review</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Artists who want to take pre-orders before their music is finished. You approve only the title, artist, date and price going public;
        the release itself is reviewed in full later.
      </p>
      {error ? (
        <ErrorState message={error} />
      ) : items === null ? (
        <LoadingState />
      ) : (
        <ul className="mt-3 grid gap-2">
          {items.map((item) => (
            <li key={item.release_id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm">
              <div>
                <p className="font-semibold">
                  {item.title} <span className="font-normal text-muted-foreground">· {RELEASE_TYPE_LABEL[item.release_type] ?? item.release_type}</span>
                </p>
                <p className="text-muted-foreground">
                  {item.profile_name ?? "Unknown artist"}
                  {item.requested_release_at ? (
                    <>
                      {" "}
                      · out <DateTime value={item.requested_release_at} format="datetime" showZone />
                    </>
                  ) : null}
                  {item.price ? (
                    <>
                      {" "}
                      · <Money value={{ amount_minor: item.price.amount_minor, currency_code: item.price.currency_code }} />{" "}
                      {item.price.status === "ACCEPTED" ? "(price agreed)" : "(price not agreed yet)"}
                    </>
                  ) : null}
                </p>
              </div>
              <Link href={`/staff/catalog/releases/${item.release_id}#presale-review`} className="font-semibold underline">
                Review
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
