"use client";

/*
 * Teasers on fan pages (owner, 2026-11-07, D-TEASER-00). A teaser is the free, permanent way to hear a
 * song for anyone who hasn't bought it, so wherever someone meets a song they can't play yet, its
 * teaser is the thing they can play. People who own the song find its teasers in a "Teasers &
 * trailers" section instead; their main play stays the full song.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { AudioLines, Pause, Play } from "lucide-react";

import { Button } from "@/components/ds";
import { usePlayer } from "@/components/music/player";
import { fetchPublicReleaseTeasers, fetchTrackTeasers, type ReleaseTeaser, type TeaserSummary } from "@/features/teasers/api";
import { teaserKey, teaserLength, teaserPath } from "@/lib/teaser-room-view";
import { cn } from "@/lib/utils";

/** Published teasers of a song, newest first; empty while loading or when there are none. */
export function useSongTeasers(trackId: string | null | undefined): TeaserSummary[] {
  const [items, setItems] = useState<TeaserSummary[]>([]);
  useEffect(() => {
    if (!trackId) return;
    let live = true;
    fetchTrackTeasers(trackId)
      .then((rows) => live && setItems(rows))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [trackId]);
  return items;
}

/** Play or pause a teaser in the site's player (no account needed, nothing reported as a song play). */
export function TeaserPlayButton({
  teaser,
  trackId,
  songTitle,
  artist,
  size = "md",
  variant = "primary",
  label,
  className,
}: {
  teaser: TeaserSummary;
  trackId: string;
  songTitle: string;
  artist?: string | null;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary" | "ghost";
  label?: string;
  className?: string;
}) {
  const player = usePlayer();
  const current = player.isCurrent(teaserKey(teaser.id));
  const playing = current && player.status === "playing";
  const text = label ?? (playing ? "Pause the teaser" : "Play the teaser");
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      busy={current && player.status === "loading"}
      onClick={() =>
        current && player.status !== "problem"
          ? player.toggle()
          : void player.playTeaser({ teaserId: teaser.id, trackId, title: songTitle, artist, label: teaser.title ?? "Teaser" })
      }
      aria-label={`${playing ? "Pause" : "Play"} the teaser of ${songTitle}`}
    >
      {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />} {text}
    </Button>
  );
}

/**
 * On the song page beside Buy, for someone who can't play the song: the newest teaser, playable here,
 * with the way into its room. Nothing when the song has no published teaser.
 */
export function SongTeaserMain({
  teasers,
  trackId,
  songTitle,
  artist,
  className,
}: {
  teasers: TeaserSummary[];
  trackId: string;
  songTitle: string;
  artist?: string | null;
  className?: string;
}) {
  const first = teasers[0];
  if (!first) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <TeaserPlayButton teaser={first} trackId={trackId} songTitle={songTitle} artist={artist} size="lg" variant="secondary" />
      <Link href={teaserPath(first.id)} className="cr-focus inline-flex items-center gap-1.5 text-sm font-semibold text-link hover:underline">
        <AudioLines aria-hidden="true" className="size-4" /> Teaser room
      </Link>
      <p className="w-full text-sm text-fg-muted">Listen to the teaser free, as often as you like.</p>
    </div>
  );
}

/** "Teasers & trailers": every published teaser of the song. */
export function SongTeasersSection({
  teasers,
  trackId,
  songTitle,
  artist,
  className,
}: {
  teasers: TeaserSummary[];
  trackId: string;
  songTitle: string;
  artist?: string | null;
  className?: string;
}) {
  if (teasers.length === 0) return null;
  return (
    <section aria-labelledby={`teasers-${trackId}`} className={cn("max-w-md", className)}>
      <h2 id={`teasers-${trackId}`} className="cr-eyebrow text-[0.6875rem] text-fg-muted">
        Teasers &amp; trailers
      </h2>
      <ul className="mt-3 grid gap-2">
        {teasers.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 border border-line p-3">
            <Link href={teaserPath(t.id)} className="cr-focus min-w-0 truncate text-sm font-semibold text-fg hover:underline">
              {t.title ?? "Teaser"}
              {teaserLength(t.duration_ms) ? <span className="cr-num ml-2 font-normal text-fg-muted">{teaserLength(t.duration_ms)}</span> : null}
            </Link>
            <TeaserPlayButton teaser={t} trackId={trackId} songTitle={songTitle} artist={artist} size="sm" variant="ghost" label="Play" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Teasers of a release's songs (release page, and the pre-sale page before release): each song's
 * teaser plays here free, for anyone. Nothing when the release has none.
 */
export function ReleaseTeasers({ releaseId, artist, className }: { releaseId: string; artist?: string | null; className?: string }) {
  const [items, setItems] = useState<ReleaseTeaser[]>([]);
  useEffect(() => {
    let live = true;
    fetchPublicReleaseTeasers(releaseId)
      .then((rows) => live && setItems(rows))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [releaseId]);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={`release-teasers-${releaseId}`} className={cn("max-w-xl", className)}>
      <h2 id={`release-teasers-${releaseId}`} className="text-xl font-bold text-fg">
        Teasers &amp; trailers
      </h2>
      <p className="mt-1 text-sm text-fg-muted">Short parts of the songs. Listen free, as often as you like.</p>
      <ul className="mt-4 grid gap-2">
        {items.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border border-line p-3">
            <Link href={teaserPath(t.id)} className="cr-focus min-w-0 text-sm font-semibold text-fg hover:underline">
              {t.track_title}
              <span className="ml-2 font-normal text-fg-muted">
                {t.title ?? "Teaser"}
                {teaserLength(t.duration_ms) ? ` · ${teaserLength(t.duration_ms)}` : ""}
              </span>
            </Link>
            <TeaserPlayButton teaser={t} trackId={t.track_id} songTitle={t.track_title} artist={artist} size="sm" variant="secondary" label="Play" />
          </li>
        ))}
      </ul>
    </section>
  );
}
