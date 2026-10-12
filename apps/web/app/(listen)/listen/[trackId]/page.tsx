"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { useAuth } from "@/components/auth-provider";
import { RoomCube } from "@/components/brand/room-cube";
import { Display, Eyebrow } from "@/components/brand/display";
import { ButtonLink, Skeleton } from "@/components/ds";
import { TrackBuyControl, useCustomerCommerce } from "@/components/music/commerce";
import { useCredits } from "@/components/music/credits";
import { ListenPage } from "@/components/music/listen-page";
import { usePlayer } from "@/components/music/player";
import { useAsync } from "@/components/use-async";
import { fetchTrack } from "@/lib/api";
import { creditName } from "@/lib/music-view";
import { ownsTrack } from "@/lib/ownership";
import { problemMessage } from "@/lib/player-model";

/**
 * Now playing. Starts the track in the persistent player when the customer can play it; otherwise
 * offers the purchase. Kept at /listen/[trackId] so existing links still work.
 */
export default function NowPlayingPage() {
  const { trackId } = useParams<{ trackId: string }>();
  const { status } = useAuth();
  const people = useCredits();
  const commerce = useCustomerCommerce();
  const player = usePlayer();
  const started = useRef<string | null>(null);
  const track = useAsync(() => fetchTrack(trackId, { skipAuth: status !== "authenticated" }), [trackId, status]);
  const title = track.status === "ok" ? track.data.title : "";
  const artist = track.status === "ok" ? creditName(track.data, people.artists, people.bands) : null;
  const owns = commerce.ready && ownsTrack(commerce.entitlements, trackId);

  useEffect(() => {
    if (owns && title && started.current !== trackId) {
      started.current = trackId;
      void player.play({ id: trackId, title, artist });
    }
  }, [owns, title, artist, trackId, player]);

  return (
    <ListenPage eyebrow="Now playing" title={title || "Track"} what="the player">
      {track.status === "loading" ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid items-center gap-10 md:grid-cols-[minmax(0,20rem)_1fr]">
          <RoomCube front={title || "Track"} side={artist ?? (title || "Track")} tone="sky" label="" className="w-full" />
          <div>
            <Eyebrow>{artist ?? "Artist not available"}</Eyebrow>
            <Display as="h2" size="md" className="mt-3">
              {title || "Track"}
            </Display>
            {player.isCurrent(trackId) && player.status === "problem" && player.problem ? (
              <p role="status" className="mt-4 text-sm text-fg">
                {problemMessage(player.problem)}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-3">
              <TrackBuyControl track={{ id: trackId, title, artist }} commerce={commerce} size="lg" />
              <ButtonLink href={`/tracks/${trackId}`} variant="secondary" size="lg">
                Track page
              </ButtonLink>
            </div>
          </div>
        </div>
      )}
    </ListenPage>
  );
}
