"use client";

import { PresaleCard } from "@/components/music/presale-card";
import { useAsync } from "@/components/use-async";
import type { PresalePageRecord } from "@/features/catalog/api";
import { fetchPresales, type PresalePlace } from "@/features/presales/api";

/**
 * "On pre-sale": releases taking pre-orders, soonest first, in the shared pre-sale card
 * (D-PRESALE-04). Nothing at all when there are none or the list can't be read, so a page never
 * shows an empty or broken shelf for something that's optional.
 */
export function PresaleShelf({
  place,
  artistId,
  bandId,
  title = "On pre-sale",
  headingId,
}: {
  place: PresalePlace;
  artistId?: string;
  bandId?: string;
  title?: string;
  headingId: string;
}) {
  const state = useAsync(
    () => fetchPresales({ artistId, bandId }).catch(() => [] as PresalePageRecord[]),
    [artistId, bandId],
  );
  if (state.status !== "ok" || state.data.length === 0) return null;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-5 flex items-center gap-3 text-xl font-bold text-fg md:text-2xl">
        {title}
        <span className="ps-badge text-xs font-semibold text-highlight">Releasing soon</span>
      </h2>
      <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {state.data.map((presale) => (
          <li key={presale.id}>
            <PresaleCard presale={presale} place={place} />
          </li>
        ))}
      </ul>
    </section>
  );
}
