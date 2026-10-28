"use client";

import Link from "next/link";
import { Guitar } from "lucide-react";

import { FoldOut } from "@/components/music/fold-out";
import { useAsync } from "@/components/use-async";
import { fetchBandLineup } from "@/features/artists/api";
import type { ArtistRecord, CreditRecord } from "@/lib/api";
import { humanizeStatus } from "@/lib/format/status";
import { creditDetails } from "@/lib/music-view";

function Person({ name, artistId }: { name: string; artistId: string | null }) {
  return artistId ? (
    <Link href={`/artists/${artistId}`} className="cr-focus font-semibold text-fg hover:text-highlight hover:underline">
      {name}
    </Link>
  ) : (
    <span className="font-semibold text-fg">{name}</span>
  );
}

/**
 * The song's credits (owner, 2026-10-28): who made it, one line per role, then "Track credit
 * details" folded underneath with who played what (band members and credited performers).
 */
export function SongCredits({
  credits,
  artists,
  bandId,
  className,
}: {
  credits: CreditRecord[];
  artists: Pick<ArtistRecord, "id" | "stage_name">[];
  bandId?: string | null;
  className?: string;
}) {
  const lineup = useAsync(() => (bandId ? fetchBandLineup(bandId).then((p) => p.items) : Promise.resolve([])), [bandId]);
  const members = lineup.status === "ok" ? lineup.data : [];
  const { main, played } = creditDetails(credits, artists, members, (role) => humanizeStatus(role));
  return (
    <section aria-labelledby="credits-title" className={className}>
      <h2 id="credits-title" className="py-3 text-base font-bold text-fg">
        Credits
      </h2>
      {main.length === 0 ? (
        <p className="pb-3 text-sm text-fg-muted">No credits listed yet.</p>
      ) : (
        <ul className="border-t border-line">
          {main.map((c) => (
            <li key={c.key} className="flex justify-between gap-4 border-b border-line py-2.5 text-sm">
              <span className="text-fg-muted">{c.role}</span>
              <Person name={c.name} artistId={c.artistId} />
            </li>
          ))}
        </ul>
      )}
      {played.length ? (
        <FoldOut title="Track credit details" icon={Guitar} count={played.length} level="sub" className="mt-1">
          <ul className="border-t border-line">
            {played.map((p) => (
              <li key={p.key} className="flex justify-between gap-4 border-b border-line py-2.5 text-sm">
                <Person name={p.name} artistId={p.artistId} />
                <span className="text-right text-fg-muted">{p.plays}</span>
              </li>
            ))}
          </ul>
        </FoldOut>
      ) : null}
    </section>
  );
}
