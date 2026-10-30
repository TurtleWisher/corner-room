"use client";

import Link from "next/link";
import { Guitar, Users } from "lucide-react";

import { FoldOut } from "@/components/music/fold-out";
import type { ArtistRecord, BandRecord, CreditRecord } from "@/lib/api";
import { humanizeStatus } from "@/lib/format/status";
import { creditDetails } from "@/lib/music-view";

/** A name with a Corner Room page links to it; anyone else is plain text (owner, 2026-10-31). */
function Person({ name, href }: { name: string; href: string | null }) {
  return href ? (
    <Link href={href} className="cr-focus font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:text-highlight hover:decoration-current">
      {name}
    </Link>
  ) : (
    <span className="font-semibold text-fg">{name}</span>
  );
}

/**
 * The song's credits, folded like the lyrics (owner, 2026-10-30): who made it, one line per role,
 * then "Track credits" folded underneath with who played what on this song, instrument first
 * ("Guitars", "Bass", "Vocals", "Drums"). Entered per song in Studio (D-CREDITS-02).
 */
export function SongCredits({
  credits,
  artists,
  bands = [],
  className,
}: {
  credits: CreditRecord[];
  artists: Pick<ArtistRecord, "id" | "stage_name">[];
  bands?: Pick<BandRecord, "id" | "name">[];
  className?: string;
}) {
  const { main, played } = creditDetails(credits, artists, (role) => humanizeStatus(role), bands);
  return (
    <FoldOut title="Credits" icon={Users} count={main.length || undefined} className={className}>
      {main.length === 0 ? (
        <p className="pb-3 text-sm text-fg-muted">No credits listed yet.</p>
      ) : (
        <ul className="border-t border-line">
          {main.map((c) => (
            <li key={c.key} className="flex justify-between gap-4 border-b border-line py-2.5 text-sm">
              <span className="text-fg-muted">{c.role}</span>
              <Person name={c.name} href={c.href} />
            </li>
          ))}
        </ul>
      )}
      <FoldOut title="Track credits" icon={Guitar} count={played.length || undefined} level="sub" className="mt-1">
        {played.length === 0 ? (
          <p className="text-sm text-fg-muted">Who played what on this song is not listed yet.</p>
        ) : (
          <ul className="border-t border-line">
            {played.map((p) => (
              <li key={p.key} className="flex justify-between gap-4 border-b border-line py-2.5 text-sm">
                <span className="text-fg-muted">{p.plays}</span>
                <Person name={p.name} href={p.href} />
              </li>
            ))}
          </ul>
        )}
      </FoldOut>
    </FoldOut>
  );
}
