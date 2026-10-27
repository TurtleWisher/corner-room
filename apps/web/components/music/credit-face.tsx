"use client";

import Link from "next/link";

import { Avatar } from "@/components/ds";
import type { Credits } from "@/components/music/credits";
import { coverUrl } from "@/lib/cover-view";
import { creditHref, creditName, creditPicture } from "@/lib/music-view";

/**
 * The primary artist or band, with their picture beside the name (owner, 2026-10-27: artists are
 * recognised by their picture as well as their name, on every page). The monogram shows when there
 * is no picture yet.
 */
export function CreditFace({
  record,
  people,
  size = 32,
}: {
  record: { primary_artist_id?: string | null; primary_band_id?: string | null };
  people: Credits;
  size?: number;
}) {
  const name = creditName(record, people.artists, people.bands);
  const href = creditHref(record);
  if (!name || !href) return <span className="text-fg-muted">Artist not available</span>;
  const picture = creditPicture(record, people.artists, people.bands);
  return (
    <Link href={href} className="cr-focus inline-flex items-center gap-2 font-semibold hover:text-highlight">
      <Avatar name={name} size={size} src={picture ? coverUrl(picture, 160) : null} className="rounded-full" />
      <span>{name}</span>
    </Link>
  );
}
