"use client";

import Link from "next/link";
import { ChevronDown, UsersRound } from "lucide-react";

import { Avatar } from "@/components/ds";
import { useAsync } from "@/components/use-async";
import { fetchBandLineup } from "@/features/artists/api";
import { coverUrl } from "@/lib/cover-view";

/**
 * The band's members, folded until opened (owner, 2026-10-27, D-LINEUP-01), on song, release and
 * band pages. Members with an artist page link to it. Nothing is drawn when no member is listed.
 */
export function BandLineup({ bandId, className }: { bandId: string; className?: string }) {
  const lineup = useAsync(() => fetchBandLineup(bandId).then((p) => p.items), [bandId]);
  if (lineup.status !== "ok" || lineup.data.length === 0) return null;
  const members = lineup.data;
  return (
    <details className={`group border-t border-line pt-4 ${className ?? ""}`}>
      <summary className="cr-focus flex cursor-pointer list-none items-center gap-2 text-xl font-bold text-fg [&::-webkit-details-marker]:hidden">
        <UsersRound aria-hidden="true" className="size-5 text-highlight" />
        Band members
        <span className="cr-num text-base font-semibold text-fg-muted">{members.length}</span>
        <ChevronDown aria-hidden="true" className="ml-auto size-5 text-fg-muted transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-3 border-t border-line">
        {members.map((m) => {
          const face = (
            <>
              <Avatar
                name={m.name}
                size={36}
                src={m.artist_id && m.portrait_asset_id ? coverUrl({ artist: m.artist_id, picture: m.portrait_asset_id }, 160) : null}
                className="rounded-full"
              />
              <span className="font-semibold">{m.name}</span>
            </>
          );
          return (
            <li key={m.id} className="flex items-center justify-between gap-4 border-b border-line py-2.5 text-sm">
              {m.artist_id ? (
                <Link href={`/artists/${m.artist_id}`} className="cr-focus inline-flex items-center gap-3 text-fg hover:text-highlight">
                  {face}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-3 text-fg">{face}</span>
              )}
              {m.role_label ? <span className="text-right text-fg-muted">{m.role_label}</span> : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
