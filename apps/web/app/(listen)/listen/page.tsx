"use client";

import { Headphones } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { ComingSoon } from "@/components/brand/coming-soon";
import { Button, ButtonLink, Card, EmptyState, Skeleton } from "@/components/ds";
import { usePlayableCatalog, useCustomerCommerce } from "@/components/music/commerce";
import { useCredits } from "@/components/music/credits";
import { ListenPage } from "@/components/music/listen-page";
import { usePlayer } from "@/components/music/player";
import { TrackRows } from "@/components/music/track-rows";
import { creditName, playQueue } from "@/lib/music-view";
import { hasCatalogAccess, ownsTrack, releaseIdsFor } from "@/lib/ownership";

/** "More music coming soon" beside the songs while the catalog is just starting (owner, 2026-10-25). */
function MoreMusicSoon() {
  return (
    <ComingSoon
      eyebrow="Listen"
      title="More music coming soon"
      body="New songs and releases from more artists are on the way. They will appear here as soon as they are out."
      className="lg:sticky lg:top-24"
    />
  );
}

/** Listening room home: what you can play now, and every other song with its price. */
export default function ListenHome() {
  const { status } = useAuth();
  const people = useCredits();
  const commerce = useCustomerCommerce();
  const catalog = usePlayableCatalog();
  const player = usePlayer();
  const access = hasCatalogAccess(commerce.entitlements);
  const playable = catalog.list.filter((t) => t.catalog_playable && t.audio_deliverable);
  const queue = playQueue(
    catalog.list.map((t) => ({ trackId: t.id, title: t.title, artist: creditName(t, people.artists, people.bands) })),
    catalog.map,
    (id) => ownsTrack(commerce.entitlements, id, releaseIdsFor(catalog.map, id)),
  );
  const firstOwned = playable.find((t) => ownsTrack(commerce.entitlements, t.id, t.release_ids ?? []));

  return (
    <ListenPage
      title="Listen"
      lede="Play what you own. Buy songs and releases from the artists to keep them."
      actions={
        firstOwned ? (
          <Button size="lg" onClick={() => void player.play({ id: firstOwned.id, title: firstOwned.title, artist: creditName(firstOwned, people.artists, people.bands) }, { queue, source: "Your music" })}>
            <Headphones aria-hidden="true" /> Play your music
          </Button>
        ) : null
      }
    >
      {status !== "authenticated" ? (
        <>
          <Card className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-lg font-bold text-fg">Sign in to listen</p>
              <p className="mt-1 text-sm text-fg-muted">Your purchases and library follow your account.</p>
            </div>
            <div className="flex gap-2">
              <ButtonLink href="/login?next=%2Flisten">Sign in</ButtonLink>
              <ButtonLink href="/releases" variant="secondary">
                Browse releases
              </ButtonLink>
            </div>
          </Card>
          {/* Every song is visible to visitors too, each with "Sign in" on its play button (owner, 2026-10-24). */}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
            {catalog.ready && catalog.list.length > 0 ? (
              <section aria-labelledby="all-tracks">
                <h2 id="all-tracks" className="mb-4 text-xl font-bold text-fg">
                  Tracks
                </h2>
                <TrackRows
                  label="Tracks"
                  items={catalog.list.map((t) => ({ key: t.id, trackId: t.id }))}
                  playable={catalog.map}
                  people={people}
                  commerce={commerce}
                />
              </section>
            ) : null}
            <MoreMusicSoon />
          </div>
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
          <section aria-labelledby="all-tracks">
            <h2 id="all-tracks" className="mb-4 text-xl font-bold text-fg">
              {access ? "Everything you can play" : "Tracks"}
            </h2>
            {!catalog.ready ? (
              <Skeleton className="h-48 w-full" />
            ) : catalog.list.length === 0 ? (
              <EmptyState title="Nothing to play yet" />
            ) : (
              <TrackRows
                label="Tracks"
                items={catalog.list.map((t) => ({ key: t.id, trackId: t.id }))}
                playable={catalog.map}
                people={people}
                commerce={commerce}
              />
            )}
          </section>
          <MoreMusicSoon />
        </div>
      )}
    </ListenPage>
  );
}
