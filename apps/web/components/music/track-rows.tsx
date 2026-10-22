"use client";

import Link from "next/link";

import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { TrackBuyControl, type CustomerCommerce } from "@/components/music/commerce";
import { usePlayer } from "@/components/music/player";
import type { ArtistRecord, BandRecord, PlayableTrackRecord } from "@/lib/api";
import { coverUrl } from "@/lib/cover-view";
import { creditName, formatDuration, playQueue, playState } from "@/lib/music-view";
import { ownsTrack } from "@/lib/ownership";
import { cn } from "@/lib/utils";

export type TrackRowItem = {
  key: string;
  trackId: string;
  /** Falls back to the playable-catalog title. */
  title?: string | null;
  /** Small line under the title (e.g. "Saved", "Played 12 Oct"). */
  note?: React.ReactNode;
  /** Extra controls on the right (remove, add to playlist). */
  extra?: React.ReactNode;
};

/**
 * Track rows for the listening room: front-only Sky cube, title, artist, duration, and the play
 * or buy control. The playing row is marked in Sky with a word, not colour alone.
 */
export function TrackRows({
  items,
  playable,
  people,
  commerce,
  label,
}: {
  items: TrackRowItem[];
  playable: Map<string, PlayableTrackRecord>;
  people: { artists: ArtistRecord[]; bands: BandRecord[] };
  commerce: CustomerCommerce;
  label: string;
}) {
  const player = usePlayer();
  const queue = playQueue(
    items.map((item) => {
      const rec = playable.get(item.trackId);
      return { trackId: item.trackId, title: item.title || rec?.title, artist: rec ? creditName(rec, people.artists, people.bands) : null };
    }),
    playable,
    (id) => ownsTrack(commerce.entitlements, id),
  );
  return (
    <ul aria-label={label} className="border-t border-line">
      {items.map((item) => {
        const rec = playable.get(item.trackId);
        const title = item.title || rec?.title || "Track not available";
        const artist = rec ? creditName(rec, people.artists, people.bands) : null;
        const duration = formatDuration(rec?.duration_ms);
        const current = player.isCurrent(item.trackId) && (player.status === "playing" || player.status === "loading");
        const state = playState(rec);
        return (
          <li
            key={item.key}
            className={cn(
              "cr-row grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-line py-3",
              current && "bg-surface-overlay",
            )}
          >
            <div className="size-12 bg-cr-sky">
              <CoverArt
                src={coverUrl({ track: item.trackId }, 160)}
                fallback={<RoomCube front={title} side={artist ?? title} tone="sky" size="front" label="" className="size-full" />}
                className="size-full"
              />
            </div>
            <div className="min-w-0">
              <Link href={`/tracks/${item.trackId}`} className="cr-focus block truncate font-semibold text-fg hover:text-highlight">
                {title}
                {current ? <span className="ml-2 text-xs font-semibold text-highlight">Now playing</span> : null}
              </Link>
              <p className="truncate text-sm text-fg-muted">
                {[artist, duration].filter(Boolean).join(" · ") || "Artist not available"}
                {item.note ? <> · {item.note}</> : null}
              </p>
              {state.kind === "unavailable" ? <p className="text-xs text-fg-muted">{state.reason}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              {item.extra}
              {state.kind !== "unavailable" ? <TrackBuyControl track={{ id: item.trackId, title, artist }} commerce={commerce} showPlan={false} playFrom={{ queue, source: label }} /> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
