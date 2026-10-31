"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ChevronDown, Users } from "lucide-react";

import { FoldOut } from "@/components/music/fold-out";
import type { ArtistRecord, BandRecord, CreditRecord } from "@/lib/api";
import { humanizeStatus } from "@/lib/format/status";
import { creditDetails, type CreditLine } from "@/lib/music-view";

/** A name with a Corner Room page links to it, by its stage name; anyone else is plain text. */
function Person({ name, href }: { name: string; href: string | null }) {
  return href ? (
    <Link href={href} className="music-person cr-focus font-semibold text-fg">
      {name}
    </Link>
  ) : (
    <span className="font-semibold text-fg">{name}</span>
  );
}

/**
 * One credit. An act's line ("Songwriter & Composer: MIZULS") unfolds to show who played in it,
 * instrument first (owner, 2026-10-31, D-CREDITS-05): tap the line or the count beside the name.
 */
function CreditRow({ line, index }: { line: CreditLine; index: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const members = line.members.length;
  return (
    <li className="music-credit" style={{ "--i": index } as React.CSSProperties} data-open={open || undefined}>
      <div
        className={`music-credit-line flex items-center justify-between gap-4 py-2.5 text-sm ${members ? "cursor-pointer" : ""}`}
        onClick={(e) => {
          if (members && !(e.target as HTMLElement).closest("a, button")) setOpen((v) => !v);
        }}
      >
        <span className="text-fg-muted">{line.role}</span>
        <span className="flex min-w-0 items-center gap-2">
          <Person name={line.name} href={line.href} />
          {members ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={id}
              aria-label={`${open ? "Hide" : "Show"} who played in ${line.name} (${members})`}
              onClick={() => setOpen((v) => !v)}
              className="music-credit-toggle cr-focus"
            >
              <span className="cr-num">{members}</span>
              <ChevronDown aria-hidden="true" className="music-credit-chevron size-3.5" />
            </button>
          ) : null}
        </span>
      </div>
      {members ? (
        <div id={id} className="music-credit-members" inert={!open}>
          <div className="min-h-0 overflow-hidden">
            <ul className="music-credit-band">
              {line.members.map((m, j) => (
                <li key={m.key} className="music-credit-member flex justify-between gap-4 py-1.5 text-sm" style={{ "--j": j } as React.CSSProperties}>
                  <span className="text-fg-muted">{m.plays}</span>
                  <Person name={m.name} href={m.href} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The song's credits, folded like the lyrics (owner, 2026-10-30): one line per credit in the
 * artist's order. Collaborators (recording, mixing, artwork, a guest player) are lines of their
 * own; the people who played in an act fold under that act's line (owner, 2026-10-31).
 */
export function SongCredits({
  credits,
  artists,
  bands = [],
  defaultOpen,
  className,
}: {
  credits: CreditRecord[];
  artists: Pick<ArtistRecord, "id" | "stage_name">[];
  bands?: Pick<BandRecord, "id" | "name">[];
  defaultOpen?: boolean;
  className?: string;
}) {
  const { main } = creditDetails(credits, artists, (role) => humanizeStatus(role), bands);
  return (
    <FoldOut title="Credits" icon={Users} count={main.length || undefined} defaultOpen={defaultOpen} className={className}>
      {main.length === 0 ? (
        <p className="pb-3 text-sm text-fg-muted">No credits listed yet.</p>
      ) : (
        <ul className="music-credits border-t border-line">
          {main.map((c, i) => (
            <CreditRow key={c.key} line={c} index={i} />
          ))}
        </ul>
      )}
    </FoldOut>
  );
}
