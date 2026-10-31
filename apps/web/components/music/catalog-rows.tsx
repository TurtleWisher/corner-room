"use client";

import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { Money } from "@/components/ds";
import { canPlay, type CustomerCommerce, TrackBuyControl } from "@/components/music/commerce";
import { useAsync } from "@/components/use-async";
import { fetchPlayableCatalog, fetchReleases, fetchTracks, type ArtistRecord, type BandRecord, type PlayableTrackRecord, type ReleaseRecord } from "@/lib/api";
import { coverUrl } from "@/lib/cover-view";
import { creditName, formatDuration, playQueue } from "@/lib/music-view";
import { formatCount } from "@/lib/format/count";
import { releaseBuyState } from "@/lib/ownership";
import { collectionLabel, tracksEntries, type TracksEntry } from "@/lib/tracks-view";

/** The catalog as the Tracks and Listen tabs show it: albums and EPs as one row each, singles as songs. */
export function useCatalogEntries() {
  const { status } = useAuth();
  const signedIn = status === "authenticated";
  return useAsync(async () => {
    if (status === "loading") return null;
    const [tracks, releases, playable] = await Promise.all([
      fetchTracks({ skipAuth: true }).then((p) => p.items),
      fetchReleases({ skipAuth: true }).then((p) => p.items).catch(() => [] as ReleaseRecord[]),
      fetchPlayableCatalog({ skipAuth: !signedIn }).then((p) => p.items).catch(() => [] as PlayableTrackRecord[]),
    ]);
    return { tracks, entries: tracksEntries(tracks, releases), playable: new Map(playable.map((t) => [t.id, t])) };
  }, [status]);
}

/**
 * One row per album or EP, which opens to its songs, and one row per single with its play or buy
 * control (owner, 2026-10-30 for Tracks, 2026-11-01 for Listen). Up next is the singles in order.
 */
export function CatalogRows({
  entries,
  playable,
  people,
  commerce,
  label,
}: {
  entries: TracksEntry[];
  playable: Map<string, PlayableTrackRecord>;
  people: { artists: ArtistRecord[]; bands: BandRecord[] };
  commerce: CustomerCommerce;
  label: string;
}) {
  const songReleases = new Map(entries.flatMap((e) => (e.kind === "song" ? [[e.track.id, e.releaseIds] as const] : [])));
  const playFrom = {
    queue: playQueue(
      entries.flatMap((e) => (e.kind === "song" ? [{ trackId: e.track.id, title: e.track.title, artist: creditName(e.track, people.artists, people.bands) }] : [])),
      playable,
      (id) => canPlay(commerce, id, songReleases.get(id) ?? []),
    ),
    source: label,
  };
  return (
    <ul aria-label={label} className="cr-focus-list border-t border-line">
      {entries.map((entry) => {
        if (entry.kind === "album") {
          const r = entry.release;
          const artist = creditName(r, people.artists, people.bands);
          const what = collectionLabel(r.release_type, entry.trackIds.length);
          const buy = commerce.ready ? releaseBuyState(commerce.entitlements, commerce.offers, r.id, entry.trackIds) : null;
          return (
            <li key={`album-${r.id}`} className="border-b border-line">
              {/* The whole row opens the album and its songs (owner, 2026-10-30). */}
              <Link
                href={`/releases/${r.id}`}
                className="cr-focus cr-row group grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-4 py-3"
                aria-label={`${r.title}, ${what}${artist ? ` by ${artist}` : ""}. Open to see its songs`}
              >
                <div className="size-[4.5rem] bg-cr-sky">
                  <CoverArt
                    src={coverUrl({ release: r.id, hasCover: Boolean(r.cover_asset_id) }, 160)}
                    fallback={<RoomCube front={r.title} side={artist ?? r.title} tone="sky" size="front" label="" className="size-full" />}
                    className="size-full"
                  />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-fg group-hover:text-highlight">{r.title}</p>
                  <p className="truncate text-sm text-fg-muted">{[what, artist].filter(Boolean).join(" · ")}</p>
                </div>
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-fg-muted">
                  {buy?.kind === "owned" ? (
                    <span className="inline-flex items-center gap-1 text-fg">
                      <Check aria-hidden="true" className="size-4 text-highlight" /> Owned
                    </span>
                  ) : buy?.kind === "buy" ? (
                    <Money value={{ amount_minor: buy.offer.amount_minor, currency_code: buy.offer.currency_code }} />
                  ) : null}
                  <ChevronRight aria-hidden="true" className="size-5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          );
        }
        const t = entry.track;
        const artist = creditName(t, people.artists, people.bands);
        const rec = playable.get(t.id);
        const duration = formatDuration(rec?.duration_ms);
        const listens = typeof rec?.listens === "number" ? `${formatCount(rec.listens)} ${rec.listens === 1 ? "listen" : "listens"}` : null;
        return (
          <li key={t.id} className="cr-row grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-line py-3">
            <div className="size-[4.5rem] bg-cr-sky">
              <CoverArt
                src={coverUrl({ track: t.id }, 160)}
                fallback={<RoomCube front={t.title} side={artist ?? t.title} tone="sky" size="front" label="" className="size-full" />}
                className="size-full"
              />
            </div>
            <div className="min-w-0">
              <Link href={`/tracks/${t.id}`} className="cr-focus block truncate font-semibold text-fg hover:text-highlight">
                {t.title}
              </Link>
              <p className="truncate text-sm text-fg-muted">{["Single", artist ?? "Artist not available", duration, listens].filter(Boolean).join(" · ")}</p>
            </div>
            <TrackBuyControl track={{ id: t.id, title: t.title, artist }} commerce={commerce} playFrom={playFrom} releaseIds={entry.releaseIds} />
          </li>
        );
      })}
    </ul>
  );
}
