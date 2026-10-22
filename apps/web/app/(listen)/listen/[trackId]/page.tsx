"use client";

import { useParams, usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useAuth } from "@/components/auth-provider";
import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { Display, Eyebrow } from "@/components/brand/display";
import { ButtonLink, Skeleton } from "@/components/ds";
import { TrackBuyControl, useCustomerCommerce, usePlayableCatalog } from "@/components/music/commerce";
import { useCredits } from "@/components/music/credits";
import { ListeningRoom } from "@/components/music/listening-room";
import { usePlayer } from "@/components/music/player";
import { useAsync } from "@/components/use-async";
import { fetchTrack } from "@/lib/api";
import { coverUrl } from "@/lib/cover-view";
import { creditName, playQueue } from "@/lib/music-view";
import { ownsTrack } from "@/lib/ownership";

/**
 * The listening room for a track (kept at /listen/[trackId] so existing links still work).
 * Arriving from the player bar keeps what is playing; arriving from a link starts this track
 * with the customer's playable catalog as Up next. When Next moves on, the address follows the
 * playing track. Customers who cannot play it are offered the purchase instead.
 */
export default function ListeningRoomPage() {
  const params = useParams<{ trackId: string }>();
  // The address follows the playing track without a navigation (see below), so read it from the
  // live pathname rather than the route params captured when the page opened.
  const pathname = usePathname();
  const trackId = pathname?.match(/^\/listen\/([^/]+)$/)?.[1] ?? params.trackId;
  const { status } = useAuth();
  const people = useCredits();
  const commerce = useCustomerCommerce();
  const catalog = usePlayableCatalog();
  const player = usePlayer();
  const started = useRef<string | null>(null);
  const shown = useRef<string | null>(player.track?.id ?? null);
  const track = useAsync(() => fetchTrack(trackId, { skipAuth: status !== "authenticated" }), [trackId, status]);
  const title = track.status === "ok" ? track.data.title : "";
  const artist = track.status === "ok" ? creditName(track.data, people.artists, people.bands) : null;
  const owns = commerce.ready && ownsTrack(commerce.entitlements, trackId);
  const current = player.track?.id === trackId;

  // One effect, so the order is fixed: first notice that the player moved on inside the room
  // (Next, Previous, a corridor pick, the end of a track) and keep the address on the playing
  // track; only otherwise start the track this address names. The address changes by a plain
  // history update, not a navigation, so the room is not rebuilt and the corridor can slide.
  const playingId = player.track?.id ?? null;
  useEffect(() => {
    if (playingId && playingId !== trackId && shown.current === trackId) {
      started.current = playingId;
      shown.current = playingId;
      window.history.replaceState(null, "", `/listen/${playingId}`);
      return;
    }
    if (playingId) shown.current = playingId;
    if (current || started.current === trackId || !owns || !title || !catalog.ready) return;
    started.current = trackId;
    const queue = playQueue(
      catalog.list.map((t) => ({ trackId: t.id, title: t.title, artist: creditName(t, people.artists, people.bands) })),
      catalog.map,
      (id) => ownsTrack(commerce.entitlements, id),
    );
    void player.play({ id: trackId, title, artist }, { queue, source: "Your music" });
  }, [playingId, current, owns, title, artist, trackId, catalog, commerce.entitlements, people, player]);

  // Between the player moving on and the address catching up (one render), keep the room up:
  // swapping it out would rebuild it and lose the corridor's slide and the announcement.
  const following = current || (playingId !== null && shown.current === trackId);

  return (
    <main id="main" data-theme="sky" className="cr-scope">
      {following ? (
        <ListeningRoom />
      ) : (
        <ListeningRoom
          fallback={
            track.status === "loading" || (owns && title) ? (
              <div className="grid w-full max-w-4xl items-center gap-10 md:grid-cols-[minmax(0,20rem)_1fr]">
                <Skeleton className="aspect-square w-full" />
                <div className="space-y-4">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-14 w-3/4" />
                  <h1 id="room-title" className="sr-only">
                    Opening the listening room
                  </h1>
                </div>
              </div>
            ) : (
              <div className="grid w-full max-w-4xl items-center gap-10 md:grid-cols-[minmax(0,20rem)_1fr]">
                <CoverArt
                  src={coverUrl({ track: trackId }, 1200)}
                  fallback={<RoomCube front={title || "Track"} side={artist ?? (title || "Track")} tone="sky" label="" className="w-full" />}
                  className="w-full"
                />
                <div>
                  <Eyebrow>{artist ?? "Artist not available"}</Eyebrow>
                  <Display as="h1" id="room-title" size="md" className="mt-3">
                    {title || "Track"}
                  </Display>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <TrackBuyControl track={{ id: trackId, title, artist }} commerce={commerce} size="lg" />
                    <ButtonLink href={`/tracks/${trackId}`} variant="secondary" size="lg">
                      Track page
                    </ButtonLink>
                  </div>
                </div>
              </div>
            )
          }
        />
      )}
    </main>
  );
}
