"use client";

import Link from "next/link";
import { useState } from "react";
import { Disc3, X } from "lucide-react";

import { ButtonLink, EmptyState, ErrorState, IconButton, Skeleton } from "@/components/ds";
import { usePlayableCatalog, useCustomerCommerce } from "@/components/music/commerce";
import { useCredits } from "@/components/music/credits";
import { ListenPage } from "@/components/music/listen-page";
import { TrackRows } from "@/components/music/track-rows";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchLibrary, fetchRelease, removeLibraryItem, type LibraryRecord } from "@/lib/api";

/* Library kinds from the streaming module: PURCHASE_REF is added by the API when a track or a whole release is bought. */
const KIND: Record<string, string> = { PURCHASE_REF: "Bought", SAVE: "Saved", LIKE: "Liked" };

/** Whole releases the customer bought; every track on them plays from the release page. */
function BoughtReleases({ ids }: { ids: string[] }) {
  const releases = useAsync(() => Promise.all(ids.map((id) => fetchRelease(id).catch(() => null))), [ids.join(",")]);
  if (ids.length === 0) return null;
  return (
    <section aria-labelledby="bought-releases" className="mb-10">
      <h2 id="bought-releases" className="mb-3 text-lg font-bold text-fg">
        Releases you bought
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ids.map((id, i) => {
          const release = releases.status === "ok" ? releases.data[i] : null;
          return (
            <li key={id}>
              <Link href={`/releases/${id}`} className="cr-focus flex items-center gap-3 border border-line p-3 hover:border-highlight">
                <Disc3 aria-hidden="true" className="size-5 shrink-0 text-highlight" />
                <span className="min-w-0 truncate font-semibold text-fg">
                  {release?.title ?? (releases.status === "loading" ? "Loading" : "Release")}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Library() {
  const people = useCredits();
  const commerce = useCustomerCommerce();
  const catalog = usePlayableCatalog();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const lib = useAsync(() => fetchLibrary().then((p) => p.items), []);

  if (lib.status === "loading" || !catalog.ready) return <Skeleton className="h-48 w-full" />;
  if (lib.status === "error") {
    return <ErrorState title="Library unavailable" message={loadErrorMessage(lib.error, "your library")} action={<RetryButton onClick={lib.reload} />} />;
  }
  // One row per track: a bought track wins over a save of the same track.
  const byTrack = new Map<string, LibraryRecord>();
  for (const row of lib.data.filter((r) => r.item_type === "track" && !removed.has(r.id))) {
    const prev = byTrack.get(row.item_id);
    if (!prev || row.kind === "PURCHASE_REF") byTrack.set(row.item_id, row);
  }
  const rows = [...byTrack.values()];
  const releaseIds = [...new Set(lib.data.filter((r) => r.item_type === "release" && r.kind === "PURCHASE_REF").map((r) => r.item_id))];
  if (rows.length === 0 && releaseIds.length === 0) {
    return <EmptyState title="Your library is empty" body="Tracks you buy or save appear here." action={<ButtonLink href="/releases" size="sm">Browse releases</ButtonLink>} />;
  }
  return (
    <>
      <BoughtReleases ids={releaseIds} />
      {rows.length > 0 ? (
        <TrackRows
          label="Your library"
          playable={catalog.map}
          people={people}
          commerce={commerce}
          items={rows.map((row) => ({
            key: row.id,
            trackId: row.item_id,
            note: KIND[row.kind] ?? row.kind,
            extra:
              row.kind === "PURCHASE_REF" ? null : (
                <IconButton
                  label="Remove from library"
                  size="sm"
                  onClick={() =>
                    void removeLibraryItem(row.id)
                      .then(() => setRemoved((s) => new Set(s).add(row.id)))
                      .catch(() => undefined)
                  }
                >
                  <X aria-hidden="true" />
                </IconButton>
              ),
          }))}
        />
      ) : null}
    </>
  );
}

export default function LibraryPage() {
  return (
    <ListenPage title="Library" lede="Everything you bought or saved." what="your library">
      <Library />
    </ListenPage>
  );
}
